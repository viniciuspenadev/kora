"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import { getProvider, type WhatsAppProvider } from "@/lib/providers"
import { validateMediaFile } from "@/lib/chat/media-validation"
import { rateLimit } from "@/lib/rate-limit"
import { findOrReopenConversation } from "@/lib/conversation-dedup"

// ── Helpers ─────────────────────────────────────────────────

/**
 * Provider da instância ESPECÍFICA de uma conversa (multi-instância).
 * Envio sempre sai pela instância dona da conversa (conv.instance_id).
 */
async function getProviderForInstance(instanceId: string, tenantId: string): Promise<WhatsAppProvider> {
  const { data } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("*")
    .eq("id", instanceId)
    .eq("tenant_id", tenantId)
    .maybeSingle()
  if (!data) throw new Error("Instância da conversa não encontrada.")
  return getProvider(data)
}

/**
 * Provider "default" do tenant — só pra operações de config/conexão que ainda
 * não escolhem instância (UI multi-instância vem na Fase M2). Pega a 1ª (mais
 * antiga) pra NÃO quebrar quando o tenant tem 2+ instâncias.
 */
async function getInstanceProvider(tenantId: string): Promise<WhatsAppProvider> {
  const { data } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!data) throw new Error("WhatsApp não configurado. Acesse Configurações → WhatsApp.")

  return getProvider(data)
}

// ── Configuração ────────────────────────────────────────────

export async function saveWhatsAppConfig(formData: {
  evolution_url:   string
  evolution_key:   string
  instance_name:   string
  webhook_url?:    string
}) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")
  if (!["owner", "admin"].includes(session.user.role)) throw new Error("Sem permissão")

  const tenantId = session.user.tenantId

  const { data: existing } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("provider", "baileys")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existing) {
    await supabaseAdmin
      .from("whatsapp_instances")
      .update({
        evolution_url:  formData.evolution_url.replace(/\/$/, ""),
        evolution_key:  formData.evolution_key,
        instance_name:  formData.instance_name,
        webhook_url:    formData.webhook_url || null,
        updated_at:     new Date().toISOString(),
      })
      .eq("id", existing.id)
  } else {
    await supabaseAdmin
      .from("whatsapp_instances")
      .insert({
        tenant_id:      tenantId,
        evolution_url:  formData.evolution_url.replace(/\/$/, ""),
        evolution_key:  formData.evolution_key,
        instance_name:  formData.instance_name,
        webhook_url:    formData.webhook_url || null,
        status:         "disconnected",
      })
  }

  revalidatePath("/configuracoes/whatsapp")
  return { success: true }
}

export async function connectWhatsApp() {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  const provider = await getInstanceProvider(session.user.tenantId)
  const now      = new Date().toISOString()

  try {
    const statusResult = await provider.getStatus()
    if (statusResult.state === "open") {
      await supabaseAdmin
        .from("whatsapp_instances")
        .update({
          status:             "connected",
          user_disconnected:  false,
          reconnect_attempts: 0,
          last_heartbeat_at:  now,
          last_error:         null,
          updated_at:         now,
        })
        .eq("tenant_id", session.user.tenantId)

      return { status: "connected" as const, qrCode: null }
    }
  } catch {
    try {
      await provider.createInstance()
    } catch {
      // Ignora se já existe
    }
  }

  try {
    const qr = await provider.getQrCode()

    await supabaseAdmin
      .from("whatsapp_instances")
      .update({
        status:             "qr_pending",
        user_disconnected:  false,
        reconnect_attempts: 0,
        last_heartbeat_at:  now,
        last_error:         null,
        updated_at:         now,
      })
      .eq("tenant_id", session.user.tenantId)

    return {
      status: "qr_pending" as const,
      qrCode: qr.base64 ?? null,
      pairingCode: qr.pairingCode ?? null,
    }
  } catch (err) {
    throw new Error(`Erro ao gerar QR Code: ${(err as Error).message}`)
  }
}

export async function checkConnectionStatus() {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  const provider = await getInstanceProvider(session.user.tenantId)
  const now      = new Date().toISOString()

  try {
    const result = await provider.getStatus()
    const state  = result.state

    const statusMap: Record<string, string> = {
      open:       "connected",
      close:      "disconnected",
      connecting: "connecting",
    }
    const status = statusMap[state ?? "close"] ?? "disconnected"

    const update: Record<string, unknown> = {
      status,
      last_heartbeat_at: now,
      updated_at:        now,
    }
    if (status === "connected") {
      update.reconnect_attempts = 0
      update.last_error         = null
    }

    await supabaseAdmin
      .from("whatsapp_instances")
      .update(update)
      .eq("tenant_id", session.user.tenantId)

    return { status }
  } catch (err) {
    await supabaseAdmin
      .from("whatsapp_instances")
      .update({
        last_heartbeat_at: now,
        last_error:        `Health check falhou: ${(err as Error).message}`,
        updated_at:        now,
      })
      .eq("tenant_id", session.user.tenantId)

    return { status: "disconnected" }
  }
}

export async function disconnectWhatsApp() {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  const provider = await getInstanceProvider(session.user.tenantId)

  await provider.logout()

  const now = new Date().toISOString()
  await supabaseAdmin
    .from("whatsapp_instances")
    .update({
      status:             "disconnected",
      phone_number:       null,
      user_disconnected:  true,
      reconnect_attempts: 0,
      last_heartbeat_at:  now,
      last_error:         null,
      updated_at:         now,
    })
    .eq("tenant_id", session.user.tenantId)

  revalidatePath("/configuracoes/whatsapp")
  return { success: true }
}

export async function configureWebhook(webhookUrl: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  const provider = await getInstanceProvider(session.user.tenantId)
  await provider.setWebhook(webhookUrl)

  await supabaseAdmin
    .from("whatsapp_instances")
    .update({ webhook_url: webhookUrl, updated_at: new Date().toISOString() })
    .eq("tenant_id", session.user.tenantId)

  return { success: true }
}

// ── Mensagens ───────────────────────────────────────────────

export async function sendMessage(
  conversationId: string,
  content:        string,
  isPrivateNote?: boolean,
) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  const tenantId = session.user.tenantId

  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("id, contact_id, instance_id, assigned_to, participants, chat_contacts(whatsapp_id, phone_number, primary_channel)")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .single()

  if (!conv) throw new Error("Conversa não encontrada")

  const assignedTo    = (conv as { assigned_to: string | null }).assigned_to
  const isAdmin       = ["owner", "admin"].includes(session.user.role)
  const isAssigned    = assignedTo === session.user.id
  const isParticipant = ((conv as { participants?: string[] }).participants ?? []).includes(session.user.id)
  const isPool        = assignedTo === null

  if (!isAdmin && !isAssigned && !isParticipant && !isPool) {
    throw new Error("Sem permissão para responder nesta conversa. Peça para o atendente atribuído te adicionar como participante.")
  }

  // Pool — primeiro a responder vira responsável (auto-assign).
  // Notas privadas não atribuem (são internas).
  if (isPool && !isPrivateNote) {
    await supabaseAdmin
      .from("chat_conversations")
      .update({ assigned_to: session.user.id, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
  }

  const contact = conv.chat_contacts as unknown as {
    whatsapp_id: string | null; phone_number: string | null; primary_channel: string | null
  }

  const { data: msg, error } = await supabaseAdmin
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      tenant_id:       tenantId,
      sender_type:     "agent",
      sender_id:       session.user.id,
      content_type:    "text",
      content,
      status:          isPrivateNote ? "delivered" : "pending",
      is_private_note: isPrivateNote ?? false,
    })
    .select("id")
    .single()

  if (error || !msg) throw new Error(error?.message ?? "Erro ao salvar mensagem")

  if (!isPrivateNote) {
    const channel = contact.primary_channel ?? "whatsapp"
    if (channel === "whatsapp") {
      try {
        const provider = await getProviderForInstance((conv as { instance_id: string }).instance_id, tenantId)
        const result   = await provider.sendText(contact.phone_number ?? "", content)

        await supabaseAdmin
          .from("chat_messages")
          .update({ whatsapp_msg_id: result.messageId || null, status: "sent" })
          .eq("id", msg.id)

        // Sinal de "envio ativo" — atualiza health da instance
        await supabaseAdmin
          .from("whatsapp_instances")
          .update({ last_outbound_message_at: new Date().toISOString() })
          .eq("tenant_id", tenantId)
      } catch (err) {
        await supabaseAdmin
          .from("chat_messages")
          .update({ status: "failed" })
          .eq("id", msg.id)
        throw new Error(`Erro ao enviar: ${(err as Error).message}`)
      }
    } else if (channel === "site") {
      // Site-chat: nada a enviar externamente. A msg 'agent' já está persistida;
      // o visitante recebe via polling do widget. Só marca como enviada.
      await supabaseAdmin
        .from("chat_messages")
        .update({ status: "sent" })
        .eq("id", msg.id)
    } else {
      await supabaseAdmin
        .from("chat_messages")
        .update({ status: "failed" })
        .eq("id", msg.id)
      throw new Error(`Resposta no canal '${channel}' ainda não suportada`)
    }
  }

  await supabaseAdmin
    .from("chat_conversations")
    .update({
      last_message_at:     new Date().toISOString(),
      last_message_preview: content.substring(0, 100),
      last_message_dir:     "out",
      flagged_pending:      false,
      updated_at:          new Date().toISOString(),
    })
    .eq("id", conversationId)

  revalidatePath("/inbox")
  return { id: msg.id }
}

// ── Envio de mídia ──────────────────────────────────────────

const CHAT_BUCKET = "chat-attachments"

function detectMediaType(mime: string): "image" | "audio" | "video" | "document" {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
  return "document"
}

export async function sendChatMedia(conversationId: string, formData: FormData) {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")

  const file    = formData.get("file") as File | null
  const caption = (formData.get("caption") as string) || ""
  // Flag PTT — gravação de voice note nativa. Quando true e mediaType=audio,
  // usa endpoint sendWhatsAppAudio (cliente vê bolha de áudio nativa do WhatsApp).
  const isVoiceNote = formData.get("ptt") === "1"

  // Validação server-side (defesa em profundidade — client já valida)
  const validation = validateMediaFile(file)
  if (!validation.ok || !file) throw new Error(validation.error ?? "Arquivo inválido")

  const tenantId  = session.user.tenantId
  const mediaType = detectMediaType(file.type)

  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("id, contact_id, instance_id, assigned_to, participants, chat_contacts(phone_number, primary_channel)")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .single()

  if (!conv) throw new Error("Conversa não encontrada")

  // Mídia hoje só sai no WhatsApp. Em canais sem envio de mídia (site-chat),
  // bloqueia com mensagem clara em vez de tentar enviar pra um destino vazio.
  const mediaChannel = (conv.chat_contacts as unknown as { primary_channel: string | null } | null)?.primary_channel ?? "whatsapp"
  if (mediaChannel !== "whatsapp") {
    throw new Error("Envio de mídia ainda não disponível nesse canal. Use texto.")
  }

  const assignedTo    = (conv as { assigned_to: string | null }).assigned_to
  const isAdmin       = ["owner", "admin"].includes(session.user.role)
  const isAssigned    = assignedTo === session.user.id
  const isParticipant = ((conv as { participants?: string[] }).participants ?? []).includes(session.user.id)
  const isPool        = assignedTo === null

  if (!isAdmin && !isAssigned && !isParticipant && !isPool) {
    throw new Error("Sem permissão para enviar mídia nesta conversa.")
  }

  // Pool — primeiro a enviar mídia vira responsável
  if (isPool) {
    await supabaseAdmin
      .from("chat_conversations")
      .update({ assigned_to: session.user.id, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
  }

  const contact = conv.chat_contacts as unknown as { phone_number: string }

  const safeName    = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")
  const storagePath = `${tenantId}/${conversationId}/${Date.now()}_${safeName}`
  const arrayBuffer = await file.arrayBuffer()

  const { error: uploadErr } = await supabaseAdmin.storage
    .from(CHAT_BUCKET)
    .upload(storagePath, arrayBuffer, { contentType: file.type, upsert: false })
  if (uploadErr) throw new Error(`Storage: ${uploadErr.message}`)

  const { data: signed, error: urlErr } = await supabaseAdmin.storage
    .from(CHAT_BUCKET)
    .createSignedUrl(storagePath, 3600)
  if (urlErr || !signed) {
    await supabaseAdmin.storage.from(CHAT_BUCKET).remove([storagePath])
    throw new Error("Erro ao gerar URL")
  }

  const sendAsVoiceNote = isVoiceNote && mediaType === "audio"

  const { data: msg, error: dbErr } = await supabaseAdmin
    .from("chat_messages")
    .insert({
      conversation_id: conversationId,
      tenant_id:       tenantId,
      sender_type:     "agent",
      sender_id:       session.user.id,
      content_type:    mediaType,
      content:         caption || null,
      media_url:       signed.signedUrl,
      media_mime_type: file.type,
      media_file_name: file.name,
      status:          "pending",
      is_private_note: false,
      metadata:        { storage_path: storagePath, ...(sendAsVoiceNote ? { is_voice_note: true } : {}) },
    })
    .select("id")
    .single()

  if (dbErr || !msg) {
    await supabaseAdmin.storage.from(CHAT_BUCKET).remove([storagePath])
    throw new Error(dbErr?.message ?? "Erro ao salvar")
  }

  try {
    const provider = await getProviderForInstance((conv as { instance_id: string }).instance_id, tenantId)
    const result   = sendAsVoiceNote
      ? await provider.sendVoiceNote(contact.phone_number, signed.signedUrl)
      : await provider.sendMedia(
          contact.phone_number,
          signed.signedUrl,
          mediaType,
          caption || undefined,
          file.name,
        )

    await supabaseAdmin
      .from("chat_messages")
      .update({ whatsapp_msg_id: result.messageId || null, status: "sent" })
      .eq("id", msg.id)

    await supabaseAdmin
      .from("whatsapp_instances")
      .update({ last_outbound_message_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
  } catch (err) {
    await supabaseAdmin
      .from("chat_messages")
      .update({ status: "failed" })
      .eq("id", msg.id)
    throw new Error(`Falha no envio: ${(err as Error).message}`)
  }

  const previewLabels: Record<string, string> = {
    image: "📷 Imagem", audio: "🎤 Áudio", video: "📹 Vídeo", document: "📎 Documento",
  }
  await supabaseAdmin
    .from("chat_conversations")
    .update({
      last_message_at:      new Date().toISOString(),
      last_message_preview: caption || previewLabels[mediaType] || "Mídia",
      last_message_dir:     "out",
      flagged_pending:      false,
      updated_at:           new Date().toISOString(),
    })
    .eq("id", conversationId)

  revalidatePath("/inbox")
  return { id: msg.id }
}

// ── Gerenciamento de conversas ──────────────────────────────

export async function assignConversation(conversationId: string, agentId: string | null) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  // Valida que agentId (se não-null) pertence ao tenant — bloqueia IDOR
  if (agentId) {
    const { data: member } = await supabaseAdmin
      .from("tenant_users")
      .select("user_id")
      .eq("tenant_id", session.user.tenantId)
      .eq("user_id", agentId)
      .eq("active", true)
      .maybeSingle()
    if (!member) throw new Error("Agente não pertence a este tenant")
  }

  await supabaseAdmin
    .from("chat_conversations")
    .update({ assigned_to: agentId, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("tenant_id", session.user.tenantId)

  revalidatePath("/inbox")
}

export async function updateConversationStatus(conversationId: string, status: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = {
    status,
    updated_at: now,
  }

  if (status === "resolved") {
    updates.unread_count    = 0
    updates.flagged_pending = false
    updates.resolved_at     = now
  } else {
    // open/pending/snoozed: limpa resolved_at (caso esteja sendo reaberta)
    updates.resolved_at  = null
  }

  await supabaseAdmin
    .from("chat_conversations")
    .update(updates)
    .eq("id", conversationId)
    .eq("tenant_id", session.user.tenantId)

  revalidatePath("/inbox")
}

export async function markConversationRead(conversationId: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  await supabaseAdmin
    .from("chat_conversations")
    .update({ unread_count: 0, flagged_pending: false, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("tenant_id", session.user.tenantId)
}

// Flag manual de "pendente" — bolinha azul volta mesmo já tendo respondido.
// Limpa sozinha quando o atendente responde (sendMessage/sendChatMedia) ou resolve.
export async function setConversationFlagged(conversationId: string, value: boolean) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  await supabaseAdmin
    .from("chat_conversations")
    .update({ flagged_pending: value, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("tenant_id", session.user.tenantId)

  revalidatePath("/inbox")
}

// Fixar conversa no topo da lista. pinned_at = timestamp (ordem entre fixadas) ou null.
export async function setConversationPinned(conversationId: string, value: boolean) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  await supabaseAdmin
    .from("chat_conversations")
    .update({ pinned_at: value ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("tenant_id", session.user.tenantId)

  revalidatePath("/inbox")
}

// ── Criar conversa manual ───────────────────────────────────

function normalizePhone(input: string): { phone: string; jid: string } | null {
  const digits = input.replace(/\D/g, "")
  if (digits.length < 10) return null
  const withCountry = digits.startsWith("55") ? digits : `55${digits}`
  return { phone: withCountry, jid: `${withCountry}@s.whatsapp.net` }
}

export async function searchContacts(query: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  // Rate-limit: 30/min/sessão. Mitiga enumeração de contatos via PII.
  const rl = rateLimit(`search:contacts:${session.user.id}`, 30, 60_000)
  if (!rl.ok) return []

  const tenantId = session.user.tenantId
  const q        = query.trim()
  if (q.length < 2) return []

  const { data: contacts } = await supabaseAdmin
    .from("chat_contacts")
    .select("id, phone_number, push_name, custom_name, email, company")
    .eq("tenant_id", tenantId)
    .or(`custom_name.ilike.%${q}%,push_name.ilike.%${q}%,phone_number.ilike.%${q}%,email.ilike.%${q}%,company.ilike.%${q}%`)
    .limit(8)

  const list = contacts ?? []
  if (list.length === 0) return []

  // Para cada contato encontrado, checa se já tem conversa (ativa OU resolved
  // não-arquivada). Usado na UI pra mostrar badge "já tem conversa" e evitar
  // o atendente pensar que tá criando algo do zero.
  const contactIds = list.map((c) => c.id)
  const { data: convs } = await supabaseAdmin
    .from("chat_conversations")
    .select("contact_id, status, archived_at")
    .eq("tenant_id", tenantId)
    .in("contact_id", contactIds)

  const statusByContact = new Map<string, "active" | "resolved" | null>()
  for (const c of (convs ?? [])) {
    const cid = (c as { contact_id: string }).contact_id
    const st  = (c as { status: string }).status
    const arch = !!(c as { archived_at: string | null }).archived_at
    const current = statusByContact.get(cid)
    // Prioriza active > resolved. Conv arquivada nunca substitui a outra.
    if (arch && current) continue
    if (["open", "pending", "snoozed"].includes(st) && current !== "active") {
      statusByContact.set(cid, "active")
    } else if (st === "resolved" && !current) {
      statusByContact.set(cid, "resolved")
    } else if (!current) {
      statusByContact.set(cid, null)
    }
  }

  return list.map((c) => ({
    ...c,
    conversation_state: statusByContact.get(c.id) ?? null,  // "active" | "resolved" | null
  }))
}

export async function createManualConversation(input: {
  phone?:        string
  contactId?:    string
  pushName?:     string
}) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  const tenantId = session.user.tenantId

  const { data: instance } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!instance) throw new Error("WhatsApp não configurado.")

  let contactId = input.contactId ?? null

  if (!contactId) {
    const norm = normalizePhone(input.phone ?? "")
    if (!norm) throw new Error("Telefone inválido. Use DDD + número (ex: 11999998888)")

    const { data: existing } = await supabaseAdmin
      .from("chat_contacts")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("whatsapp_id", norm.jid)
      .maybeSingle()

    if (existing) {
      contactId = existing.id
    } else {
      const { data: created, error } = await supabaseAdmin
        .from("chat_contacts")
        .insert({
          tenant_id:           tenantId,
          whatsapp_id:         norm.jid,
          phone_number:        norm.phone,
          push_name:           input.pushName ?? null,
          source:              "whatsapp_outbound",
          primary_channel:     "whatsapp",   // identidade multicanal (Fase 1)
          primary_external_id: norm.jid,
        })
        .select("id")
        .single()
      if (error || !created) throw new Error(`Erro criando contato: ${error?.message}`)
      contactId = created.id
    }
  }

  if (!contactId) throw new Error("Falha ao resolver contato")

  // ── Dedup: regra única do Kora (1 conversa viva por contato) ──
  // - Se há ATIVA → reusa
  // - Se há fechada recente (≤7 dias) → reabre (só muda status; stage/lifecycle/won/lost intactos)
  // - Senão → cria nova (continua o fluxo abaixo)
  const dedup = await findOrReopenConversation({ tenantId, contactId })
  if (dedup.found !== "none") {
    revalidatePath("/inbox")
    revalidatePath("/kanban")
    return { id: dedup.conversation.id, reused: true, reopened: dedup.found === "reopened" }
  }

  let pipelineId: string | null = null
  let stageId:    string | null = null

  const { data: tc } = await supabaseAdmin
    .from("tenant_config")
    .select("default_pipeline_id")
    .eq("tenant_id", tenantId)
    .maybeSingle()

  if (tc?.default_pipeline_id) {
    pipelineId = tc.default_pipeline_id
    const { data: firstStage } = await supabaseAdmin
      .from("pipeline_stages")
      .select("id")
      .eq("pipeline_id", pipelineId)
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle()
    stageId = firstStage?.id ?? null
  }

  const { data: newConv, error: convErr } = await supabaseAdmin
    .from("chat_conversations")
    .insert({
      tenant_id:     tenantId,
      contact_id:    contactId,
      instance_id:   instance.id,
      status:        "open",
      unread_count:  0,
      pipeline_id:   pipelineId,
      stage_id:      stageId,
      card_position: 0,
      assigned_to:   session.user.id,
    })
    .select("id")
    .single()

  // Race: outro atendente/webhook criou conv ao mesmo tempo. UNIQUE index
  // ativo-por-contato dispara 23505 — tentamos dedup de novo pra pegar
  // a conv que ganhou a corrida.
  if (convErr?.code === "23505") {
    const retry = await findOrReopenConversation({ tenantId, contactId })
    if (retry.found !== "none") {
      revalidatePath("/inbox")
      revalidatePath("/kanban")
      return { id: retry.conversation.id, reused: true, reopened: retry.found === "reopened" }
    }
  }

  if (convErr || !newConv) throw new Error(`Erro criando conversa: ${convErr?.message}`)

  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: newConv.id,
    tenant_id:       tenantId,
    sender_type:     "system",
    content_type:    "text",
    content:         "Conversa iniciada manualmente pelo atendente.",
    status:          "delivered",
    is_private_note: false,
  })

  revalidatePath("/inbox")
  revalidatePath("/kanban")
  return { id: newConv.id, reused: false }
}

// ── Contato: bloquear / notas ───────────────────────────────

export async function setContactBlocked(contactId: string, blocked: boolean) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  await supabaseAdmin
    .from("chat_contacts")
    .update({ is_blocked: blocked, updated_at: new Date().toISOString() })
    .eq("id", contactId)
    .eq("tenant_id", session.user.tenantId)

  revalidatePath("/inbox")
}

export async function setContactNotes(contactId: string, notes: string | null) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  await supabaseAdmin
    .from("chat_contacts")
    .update({ notes, updated_at: new Date().toISOString() })
    .eq("id", contactId)
    .eq("tenant_id", session.user.tenantId)

  revalidatePath("/inbox")
}

export interface ContactInfoInput {
  custom_name?: string | null
  email?:       string | null
  company?:     string | null
  doc_id?:      string | null
  birth_date?:  string | null  // ISO YYYY-MM-DD ou null
}

export async function updateContactInfo(
  contactId: string,
  input:     ContactInfoInput,
): Promise<{ error?: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }

  // Normaliza: strings vazias viram null pra não poluir o banco com ""
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.custom_name !== undefined) payload.custom_name = input.custom_name?.trim() || null
  if (input.email       !== undefined) payload.email       = input.email?.trim().toLowerCase() || null
  if (input.company     !== undefined) payload.company     = input.company?.trim() || null
  if (input.doc_id      !== undefined) payload.doc_id      = input.doc_id?.replace(/\D/g, "") || null
  if (input.birth_date  !== undefined) payload.birth_date  = input.birth_date || null

  // Validação rápida — email no formato básico (não vamos rodar regex perfeita)
  if (payload.email && typeof payload.email === "string" && !payload.email.includes("@")) {
    return { error: "Email inválido" }
  }

  const { error } = await supabaseAdmin
    .from("chat_contacts")
    .update(payload)
    .eq("id", contactId)
    .eq("tenant_id", session.user.tenantId)

  if (error) return { error: error.message }

  revalidatePath("/inbox")
  revalidatePath("/contatos")
  return {}
}

export async function archiveConversation(conversationId: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  const now = new Date().toISOString()
  await supabaseAdmin
    .from("chat_conversations")
    .update({
      archived_at: now,
      unread_count: 0,
      updated_at:   now,
    })
    .eq("id", conversationId)
    .eq("tenant_id", session.user.tenantId)

  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conversationId,
    tenant_id:       session.user.tenantId,
    sender_type:     "system",
    content_type:    "text",
    content:         "Conversa arquivada.",
    status:          "delivered",
    is_private_note: false,
  })

  revalidatePath("/inbox")
  revalidatePath("/kanban")
}

export async function unarchiveConversation(conversationId: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  await supabaseAdmin
    .from("chat_conversations")
    .update({
      archived_at: null,
      updated_at:  new Date().toISOString(),
    })
    .eq("id", conversationId)
    .eq("tenant_id", session.user.tenantId)

  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conversationId,
    tenant_id:       session.user.tenantId,
    sender_type:     "system",
    content_type:    "text",
    content:         "Conversa restaurada.",
    status:          "delivered",
    is_private_note: false,
  })

  revalidatePath("/inbox")
  revalidatePath("/kanban")
}

// ── Participantes da conversa (array uuid[]) ────────────────

export async function addConversationParticipant(conversationId: string, userId: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  const tenantId = session.user.tenantId

  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("assigned_to, participants")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .single()

  if (!conv) throw new Error("Conversa não encontrada")

  const isAdmin    = ["owner", "admin"].includes(session.user.role)
  const isAssigned = conv.assigned_to === session.user.id
  if (!isAdmin && !isAssigned) throw new Error("Apenas o atendente atribuído ou administradores podem adicionar participantes.")

  // Valida que userId pertence ao tenant — bloqueia IDOR
  const { data: member } = await supabaseAdmin
    .from("tenant_users")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle()
  if (!member) throw new Error("Usuário não pertence a este tenant")

  const current = (conv.participants ?? []) as string[]
  if (current.includes(userId)) return { ok: true }
  const next = [...current, userId]

  await supabaseAdmin
    .from("chat_conversations")
    .update({ participants: next, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)

  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .single()

  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conversationId,
    tenant_id:       tenantId,
    sender_type:     "system",
    content_type:    "text",
    content:         `${prof?.full_name ?? "Agente"} foi adicionado à conversa.`,
    status:          "delivered",
    is_private_note: false,
  })

  revalidatePath("/inbox")
  return { ok: true }
}

export async function removeConversationParticipant(conversationId: string, userId: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  const tenantId = session.user.tenantId

  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("assigned_to, participants")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .single()

  if (!conv) throw new Error("Conversa não encontrada")

  const isAdmin    = ["owner", "admin"].includes(session.user.role)
  const isAssigned = conv.assigned_to === session.user.id
  const isSelf     = userId === session.user.id
  if (!isAdmin && !isAssigned && !isSelf) {
    throw new Error("Sem permissão para remover participantes.")
  }

  const current = (conv.participants ?? []) as string[]
  const next    = current.filter((id) => id !== userId)

  await supabaseAdmin
    .from("chat_conversations")
    .update({ participants: next, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)

  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .single()

  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conversationId,
    tenant_id:       tenantId,
    sender_type:     "system",
    content_type:    "text",
    content:         `${prof?.full_name ?? "Agente"} saiu da conversa.`,
    status:          "delivered",
    is_private_note: false,
  })

  revalidatePath("/inbox")
  return { ok: true }
}

// ── Total de não-lidas (para badge no menu) ─────────────────

export async function getUnreadTotal() {
  const session = await auth()
  if (!session) return 0

  const tenantId = session.user.tenantId
  const userId   = session.user.id
  const isAdmin  = ["owner", "admin"].includes(session.user.role)

  const { data } = await supabaseAdmin
    .from("chat_conversations")
    .select("unread_count, assigned_to, participants")
    .eq("tenant_id", tenantId)
    .gt("unread_count", 0)
    .in("status", ["open", "pending"])

  if (!data) return 0

  let visible = data
  if (!isAdmin) {
    const { data: tu } = await supabaseAdmin
      .from("tenant_users")
      .select("view_all")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .maybeSingle()

    if (!tu?.view_all) {
      visible = data.filter((c: { assigned_to: string | null; participants: string[] | null }) =>
        c.assigned_to === null ||                  // pool aberto
        c.assigned_to === userId ||
        (c.participants ?? []).includes(userId)
      )
    }
  }

  return visible.reduce((s: number, c: { unread_count: number | null }) => s + (c.unread_count ?? 0), 0)
}

// ── Configuração por tenant ─────────────────────────────────

export async function getTenantConfig() {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  const { data } = await supabaseAdmin
    .from("tenant_config")
    .select("default_pipeline_id, auto_create_lead_from_whatsapp")
    .eq("tenant_id", session.user.tenantId)
    .maybeSingle()

  return data ?? { default_pipeline_id: null, auto_create_lead_from_whatsapp: false }
}

// ── Lifecycle do contato ────────────────────────────────────

/**
 * Promove um contato de "contact" para "lead" e (opcionalmente) cria deal no funil.
 * O atendente clica "Qualificar" quando avalia que há FIT comercial.
 */
export async function qualifyLead(conversationId: string, pipelineId?: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")
  const tenantId = session.user.tenantId

  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("id, contact_id, pipeline_id, is_group")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .single()

  if (!conv) throw new Error("Conversa não encontrada")
  if (conv.is_group) throw new Error("Conversas de grupo não vão para o funil")
  if (!conv.contact_id) throw new Error("Conversa sem contato vinculado")

  await supabaseAdmin
    .from("chat_contacts")
    .update({
      lifecycle_stage:      "lead",
      lifecycle_changed_at: new Date().toISOString(),
      qualified_at:         new Date().toISOString(),
      qualified_by:         session.user.id,
      unfit_reason:         null,
      updated_at:           new Date().toISOString(),
    })
    .eq("id", conv.contact_id)
    .eq("tenant_id", tenantId)

  const targetPipelineId = pipelineId ?? conv.pipeline_id
  if (targetPipelineId) {
    const { data: firstStage } = await supabaseAdmin
      .from("pipeline_stages")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("pipeline_id", targetPipelineId)
      .eq("is_triage", false)
      .eq("is_won", false)
      .eq("is_lost", false)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle()

    if (firstStage) {
      await supabaseAdmin
        .from("chat_conversations")
        .update({
          pipeline_id:   targetPipelineId,
          stage_id:      firstStage.id,
          card_position: 0,
          updated_at:    new Date().toISOString(),
        })
        .eq("id", conversationId)
    }
  }

  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conversationId,
    tenant_id:       tenantId,
    sender_type:     "system",
    content_type:    "text",
    content:         "✅ Contato qualificado como Lead.",
    status:          "delivered",
    is_private_note: false,
  })

  revalidatePath("/inbox")
  revalidatePath("/kanban")
  return { ok: true }
}

/**
 * Desqualifica um contato (não tem fit comercial). Mantém a conversa no Inbox
 * mas remove do funil ativo.
 */
export async function markUnfit(conversationId: string, reason?: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")
  const tenantId = session.user.tenantId

  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("contact_id")
    .eq("id", conversationId)
    .eq("tenant_id", tenantId)
    .single()

  if (!conv?.contact_id) throw new Error("Conversa sem contato")

  await supabaseAdmin
    .from("chat_contacts")
    .update({
      lifecycle_stage:      "unfit",
      lifecycle_changed_at: new Date().toISOString(),
      unfit_reason:         reason ?? null,
      updated_at:           new Date().toISOString(),
    })
    .eq("id", conv.contact_id)

  await supabaseAdmin
    .from("chat_conversations")
    .update({
      pipeline_id:   null,
      stage_id:      null,
      card_position: 0,
      updated_at:    new Date().toISOString(),
    })
    .eq("id", conversationId)

  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conversationId,
    tenant_id:       tenantId,
    sender_type:     "system",
    content_type:    "text",
    content:         reason
      ? `🚫 Contato marcado como Sem Fit. Motivo: ${reason}`
      : "🚫 Contato marcado como Sem Fit.",
    status:          "delivered",
    is_private_note: false,
  })

  revalidatePath("/inbox")
  revalidatePath("/kanban")
  return { ok: true }
}

// ── Grupos WhatsApp (opt-in) ────────────────────────────────

export async function listPendingGroups() {
  const session = await auth()
  if (!session) return []

  const { data } = await supabaseAdmin
    .from("chat_groups_whitelist")
    .select("id, group_jid, group_name, member_count, detected_at")
    .eq("tenant_id", session.user.tenantId)
    .eq("status", "pending")
    .order("detected_at", { ascending: false })

  return data ?? []
}

export async function decideGroup(
  groupWhitelistId: string,
  decision:         "monitor" | "ignore",
) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  const tenantId = session.user.tenantId

  const { data: whitelist } = await supabaseAdmin
    .from("chat_groups_whitelist")
    .select("id, group_jid, instance_id")
    .eq("id", groupWhitelistId)
    .eq("tenant_id", tenantId)
    .single()

  await supabaseAdmin
    .from("chat_groups_whitelist")
    .update({
      status:     decision,
      decided_by: session.user.id,
      decided_at: new Date().toISOString(),
    })
    .eq("id", groupWhitelistId)
    .eq("tenant_id", tenantId)

  if (decision === "monitor" && whitelist) {
    await fetchAndSaveGroupMetadata(whitelist.instance_id, whitelist.group_jid, tenantId)
  }

  revalidatePath("/inbox")
  return { ok: true }
}

/**
 * Busca metadata do grupo via Evolution e atualiza whitelist + conversa.
 */
async function fetchAndSaveGroupMetadata(instanceId: string, groupJid: string, tenantId: string) {
  try {
    const { data: inst } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("*")
      .eq("id", instanceId)
      .single()
    if (!inst) return

    const provider = getProvider(inst)
    const meta     = await provider.fetchGroupMetadata(groupJid)
    if (!meta) return

    const members = (meta.participants ?? []).map((p) => ({ jid: p.id }))
    const now     = new Date().toISOString()

    await supabaseAdmin
      .from("chat_groups_whitelist")
      .update({
        group_name:    meta.subject ?? null,
        group_picture: meta.pictureUrl ?? null,
        member_count:  meta.size ?? members.length,
      })
      .eq("tenant_id", tenantId)
      .eq("group_jid", groupJid)

    await supabaseAdmin
      .from("chat_conversations")
      .update({
        group_name:    meta.subject ?? null,
        group_picture: meta.pictureUrl ?? null,
        group_members: members,
        updated_at:    now,
      })
      .eq("tenant_id", tenantId)
      .eq("group_jid", groupJid)
      .eq("is_group", true)
  } catch {
    /* silencioso — metadata pode falhar se grupo é privado, etc */
  }
}

// ── Quick Replies ───────────────────────────────────────────

export async function createQuickReply(data: { shortcut: string; title: string; content: string }) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  await supabaseAdmin.from("chat_quick_replies").insert({
    tenant_id:  session.user.tenantId,
    shortcut:   data.shortcut.startsWith("/") ? data.shortcut : `/${data.shortcut}`,
    title:      data.title,
    content:    data.content,
    created_by: session.user.id,
  })

  revalidatePath("/configuracoes/respostas")
}

export async function updateQuickReply(id: string, data: { shortcut: string; title: string; content: string }) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  await supabaseAdmin
    .from("chat_quick_replies")
    .update({
      shortcut: data.shortcut.startsWith("/") ? data.shortcut : `/${data.shortcut}`,
      title:    data.title,
      content:  data.content,
    })
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)

  revalidatePath("/configuracoes/respostas")
}

export async function deleteQuickReply(id: string) {
  const session = await auth()
  if (!session) throw new Error("Não autenticado")

  await supabaseAdmin
    .from("chat_quick_replies")
    .delete()
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)

  revalidatePath("/configuracoes/respostas")
}

// getMessages() removida — substituída por src/lib/actions/messages.ts
// que faz cursor pagination + getMessagesUpdates pra polling incremental.


// refreshInbox() removida — substituída por getConversationsUpdates({since}) em
// src/lib/actions/conversations.ts (polling incremental, baixa só o delta).
