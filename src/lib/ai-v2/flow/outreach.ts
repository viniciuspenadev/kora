// ═══════════════════════════════════════════════════════════════
// Kora Studio — nó Disparar no WhatsApp (outreach cross-canal) §F2a
// ═══════════════════════════════════════════════════════════════
// O fluxo roda no fio de ORIGEM (ex: site). Este nó dispara pro número do
// CONTATO no WhatsApp: abre/acha o fio WhatsApp do MESMO contato, aplica o
// gate ESTRUTURAL (oficial fora da janela → só template; baileys → texto),
// envia, persiste no fio WhatsApp e linka a identidade. docs/studio-outreach-
// node-design.md. Reusa a máquina de campanha (createInboundConversation +
// provider.sendTemplate/sendText).
//
// Deferido: F2b = bastão de continuação (o fluxo segue no fio WhatsApp no reply,
// espelhando `campaign_engage`). F2c = pré-check onWhatsApp + JID canônico do 9
// (hoje: existência vem de sucesso/falha do envio; identidade é best-effort).

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { getProvider } from "@/lib/providers"
import { createInboundConversation } from "@/lib/channels/inbound-conversation"
import { normalizePhone, phoneToJid } from "@/lib/phone-utils"
import { syncContactIdentities } from "@/lib/contacts/identity"
import type { ExecCtx } from "../capabilities/types"

export type OutreachBranch = "sent" | "no_whatsapp" | "blocked"

/** Entradas já RESOLVIDAS pelo runtime (telefone lido da var/contato; texto e
 *  params de template já interpolados) — este helper não interpola. */
export interface OutreachInput {
  channel:           "official" | "baileys" | "auto"
  instanceId?:       string
  phoneRaw:          string
  marketing?:        boolean
  templateName?:     string
  templateLanguage?: string
  templateParams?:   string[]
  text?:             string
}

interface InstanceRow { id: string; provider: "meta_cloud" | "baileys" | null; [k: string]: unknown }

/** Resolve o número de saída: instanceId explícito → 1ª do provider desejado →
 *  (auto) prefere oficial (meta_cloud vem antes de baileys na ordem desc). */
async function pickInstance(tenantId: string, channel: string, instanceId?: string): Promise<InstanceRow | null> {
  if (instanceId) {
    const { data } = await supabaseAdmin.from("whatsapp_instances").select("*")
      .eq("tenant_id", tenantId).eq("id", instanceId).maybeSingle()
    return (data as InstanceRow | null) ?? null
  }
  let q = supabaseAdmin.from("whatsapp_instances").select("*").eq("tenant_id", tenantId)
  if (channel === "official") q = q.eq("provider", "meta_cloud")
  else if (channel === "baileys") q = q.eq("provider", "baileys")
  // auto: 'meta_cloud' > 'baileys' em ordem desc → oficial primeiro.
  const { data } = await q.order("provider", { ascending: false }).order("created_at", { ascending: true })
  return ((data as InstanceRow[] | null) ?? [])[0] ?? null
}

export async function runOutreach(ctx: ExecCtx, input: OutreachInput): Promise<{ branch: OutreachBranch }> {
  const { tenantId, contact } = ctx
  if (ctx.dryRun) return { branch: "sent" }   // simulador não transmite

  // 1. Número destino (país-base do tenant). Implausível → sem WhatsApp.
  const { data: tc } = await supabaseAdmin.from("tenant_config")
    .select("default_country").eq("tenant_id", tenantId).maybeSingle()
  const phone = normalizePhone(input.phoneRaw, (tc?.default_country as string | null) ?? "BR")
  if (!phone) return { branch: "no_whatsapp" }

  // 2. Número de saída.
  const inst = await pickInstance(tenantId, input.channel, input.instanceId)
  if (!inst) return { branch: "blocked" }
  const isOfficial = inst.provider === "meta_cloud"
  const provider = getProvider(inst)

  // 3. Conteúdo por canal — fail-closed ESTRUTURAL. O contato veio de outro canal
  //    (ex: site) → fora da janela 24h do Oficial → só TEMPLATE; baileys = texto.
  if (isOfficial) {
    if (!input.templateName?.trim() || !provider.sendTemplate) return { branch: "blocked" }
    // Marketing exige opt-in (I5 omnichannel — endereçável ≠ abordável).
    if (input.marketing) {
      const { data: c } = await supabaseAdmin.from("chat_contacts")
        .select("marketing_opt_in").eq("id", contact.id).eq("tenant_id", tenantId).maybeSingle()
      if (!(c as { marketing_opt_in?: boolean } | null)?.marketing_opt_in) return { branch: "blocked" }
    }
  } else {
    if (!input.text?.trim()) return { branch: "blocked" }
  }

  // 4. Abre/acha o fio WhatsApp do MESMO contato (dedup por contato+canal+instância).
  const conv = await createInboundConversation({ tenantId, contactId: contact.id, instanceId: inst.id, channel: "whatsapp" })

  // 5. Envia. Falha = número provavelmente não está no WhatsApp / não elegível.
  let messageId: string | null = null
  let display = ""
  try {
    if (isOfficial) {
      const params = (input.templateParams ?? []).filter((p) => p.trim() !== "").map((p) => ({ text: p }))
      const res = await provider.sendTemplate!(phone, input.templateName!.trim(), input.templateLanguage?.trim() || "pt_BR", params.length ? params : undefined)
      messageId = res.messageId || null
      display = `[template: ${input.templateName!.trim()}]`
    } else {
      const res = await provider.sendText(phone, input.text!.trim())
      messageId = res.messageId || null
      display = input.text!.trim()
    }
  } catch (e) {
    console.error("[outreach send]", (e as Error)?.message ?? e)
    return { branch: "no_whatsapp" }
  }

  // 6. Persiste a mensagem NO FIO WhatsApp (não no canal de origem).
  const now = new Date().toISOString()
  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conv.id, tenant_id: tenantId,
    sender_type: "bot", content_type: "text", content: display,
    status: "sent", whatsapp_msg_id: messageId, is_private_note: false,
    metadata: { studio: true, studio_outreach: true, from_channel: ctx.channel ?? null },
  })
  await supabaseAdmin.from("chat_conversations").update({
    last_message_at: now, last_message_preview: display.slice(0, 100), last_message_dir: "out", updated_at: now,
  }).eq("id", conv.id).eq("tenant_id", tenantId)

  // 7. Identidade WhatsApp + carimbo de consentimento (base de SERVIÇO: o lead te
  //    procurou e deu o número — NÃO liga marketing_opt_in). Só preenche vazios,
  //    nunca sobrescreve identidade real. Best-effort: colisão de whatsapp_id (=
  //    duplicado) é reconciliada no merge (F2b/F2c), não derruba o disparo.
  //    ⚠️ F2c troca o JID construído pelo canônico do provedor (ambiguidade do 9).
  try {
    const jid = phoneToJid(phone)
    const { data: cur } = await supabaseAdmin.from("chat_contacts")
      .select("whatsapp_id, phone_number, consent_at").eq("id", contact.id).eq("tenant_id", tenantId).maybeSingle()
    const row = cur as { whatsapp_id: string | null; phone_number: string | null; consent_at: string | null } | null
    const patch: Record<string, unknown> = { updated_at: now }
    if (!row?.phone_number?.trim()) patch.phone_number = phone
    if (!row?.whatsapp_id)          patch.whatsapp_id = jid
    if (!row?.consent_at)         { patch.consent_at = now; patch.consent_source = "site_flow" }
    await supabaseAdmin.from("chat_contacts").update(patch).eq("id", contact.id).eq("tenant_id", tenantId)
    await syncContactIdentities(tenantId, contact.id, { whatsapp: jid }, jid, "whatsapp")
  } catch (e) {
    console.error("[outreach identity]", (e as Error)?.message ?? e)
  }

  return { branch: "sent" }
}
