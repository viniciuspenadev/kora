import "server-only"

import { supabaseAdmin } from "@/lib/supabase"
import { getProvider } from "@/lib/providers"
import { evolutionSentAt } from "@/lib/channels/external-reply"
import type { EvolutionMessageData } from "@/types/chat"

type GroupInstance = {
  id: string
  tenant_id: string
  provider?: string | null
  evolution_url?: string | null
  evolution_key?: string | null
  instance_name?: string | null
}

type GroupContent = {
  contentType: string
  content: string | null
  mediaMimeType: string | null
  mediaFileName: string | null
  extraMetadata?: Record<string, unknown>
}

export const isEvolutionGroupJid = (value: unknown): boolean =>
  typeof value === "string" && /^\d+(?:-\d+)?@g\.us$/.test(value)

const participantJid = (value: unknown): string | null =>
  typeof value === "string" && /^\d+@(s\.whatsapp\.net|lid)$/.test(value) ? value : null

async function findOrCreateGroup(instance: GroupInstance, groupJid: string): Promise<string> {
  const base = supabaseAdmin.from("chat_conversations")
  const { data: existing, error: findError } = await base.select("id,group_live_enabled")
    .eq("tenant_id", instance.tenant_id).eq("instance_id", instance.id)
    .eq("is_group", true).eq("group_jid", groupJid)
    .in("status", ["open", "pending", "snoozed"])
    .maybeSingle()
  if (findError) throw findError
  if (existing) {
    if (!existing.group_live_enabled) {
      const { error } = await base.update({ group_live_enabled: true, updated_at: new Date().toISOString() })
        .eq("tenant_id", instance.tenant_id).eq("id", existing.id)
      if (error) throw error
    }
    return existing.id
  }

  // Um grupo pode chegar antes do evento GROUPS_UPSERT. A mensagem cria o fio;
  // metadados são enriquecimento e nunca bloqueiam a captura.
  let name: string | null = null
  try {
    const info = await getProvider(instance).fetchGroupMetadata(groupJid)
    name = info?.id === groupJid ? info.subject?.trim().slice(0, 160) || null : null
  } catch { /* sem metadados, mantém o grupo e sua mensagem */ }

  const { data: created, error } = await base.insert({
    tenant_id: instance.tenant_id,
    instance_id: instance.id,
    contact_id: null,
    is_group: true,
    group_jid: groupJid,
    group_name: name,
    group_live_enabled: true,
    group_access_mode: "management",
    channel: "whatsapp",
    status: "open",
    pipeline_id: null,
    stage_id: null,
  }).select("id").single()
  if (created) return created.id
  if (error?.code !== "23505") throw error ?? new Error("Grupo não criado")
  // Dois webhooks simultâneos do primeiro grupo: a chave única decide.
  const { data: winner, error: retryError } = await base.select("id")
    .eq("tenant_id", instance.tenant_id).eq("instance_id", instance.id)
    .eq("is_group", true).eq("group_jid", groupJid)
    .in("status", ["open", "pending", "snoozed"])
    .maybeSingle()
  if (retryError || !winner) throw retryError ?? new Error("Grupo não localizado após disputa")
  return winner.id
}

/** Ramo isolado: participante de grupo nunca vira contato nem destinatário 1:1. */
export async function recordEvolutionGroupMessage(
  instance: GroupInstance,
  msg: EvolutionMessageData,
  extracted: GroupContent,
): Promise<void> {
  const groupJid = msg.key?.remoteJid
  if (!isEvolutionGroupJid(groupJid) || !msg.key.id || msg.message?.protocolMessage) return
  const conversationId = await findOrCreateGroup(instance, groupJid)
  const fromMe = msg.key.fromMe === true
  const senderJid = participantJid(msg.key.participant ?? msg.participant)
  const pushName = typeof msg.pushName === "string" ? msg.pushName.trim().slice(0, 120) : ""
  const eventAt = evolutionSentAt(msg.messageTimestamp) ?? new Date().toISOString()
  const metadata: Record<string, unknown> = {
    ...(extracted.extraMetadata ?? {}),
    ...(pushName && !fromMe ? { group_push_name: pushName } : {}),
    ...(fromMe ? { via_celular: true } : {}),
    ...(["image", "audio", "video", "document", "sticker"].includes(extracted.contentType)
      ? { group_media_pending: true } : {}),
  }
  const { error: insertError } = await supabaseAdmin.from("chat_messages").insert({
    tenant_id: instance.tenant_id,
    conversation_id: conversationId,
    sender_type: fromMe ? "agent" : "contact",
    sender_id: null,
    group_participant_jid: senderJid,
    content_type: extracted.contentType,
    content: extracted.content,
    media_url: null,
    media_mime_type: extracted.mediaMimeType,
    media_file_name: extracted.mediaFileName,
    whatsapp_msg_id: msg.key.id,
    status: fromMe ? "sent" : "delivered",
    is_private_note: false,
    metadata,
    created_at: eventAt,
  })
  if (insertError?.code === "23505") return
  if (insertError) throw insertError

  const label = fromMe ? "Celular" : pushName || "Participante"
  const body = extracted.content?.trim() || (extracted.contentType === "text" ? "Mensagem" : `📎 ${extracted.contentType}`)
  const preview = `${label}: ${body}`.slice(0, 100)
  const now = new Date().toISOString()
  const { error: bumpError } = await supabaseAdmin.from("chat_conversations").update({
    last_message_at: eventAt,
    last_message_preview: preview,
    last_message_dir: fromMe ? "out_phone" : "in",
    updated_at: now,
  }).eq("tenant_id", instance.tenant_id).eq("id", conversationId)
    .or(`last_message_at.is.null,last_message_at.lte.${eventAt}`)
  if (bumpError) throw bumpError
  if (!fromMe) {
    const { error: inboundError } = await supabaseAdmin.from("chat_conversations")
      .update({ last_inbound_at: eventAt, updated_at: now })
      .eq("tenant_id", instance.tenant_id).eq("id", conversationId)
      .or(`last_inbound_at.is.null,last_inbound_at.lte.${eventAt}`)
    if (inboundError) throw inboundError
  }
}
