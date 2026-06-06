import "server-only"
import { after } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getProvider } from "@/lib/providers"
import { findOrReopenConversation } from "@/lib/conversation-dedup"
import { runAITurn } from "@/lib/ai/run"
import { latestInboundAt } from "@/lib/ai/context"
import { dispatchAutomations } from "@/lib/automation/dispatch"
import { evaluateKeywordTriggers } from "@/lib/automation/keyword-engine"
import { assignNextAgent } from "@/lib/automation/auto-assign"
import { notifyInboundMessage } from "@/lib/push/send"
import { upsertTemplateCache, logTemplateEvent } from "@/lib/channels/template-cache"
import { slimAdMeta } from "@/lib/ad-reply"
import type { ExternalAdReply } from "@/types/chat"

/**
 * Ingestão do WhatsApp Cloud API (oficial) — ISOLADA do webhook Evolution.
 * Reusa só as libs estáveis e compartilhadas (dedup de conversa, IA, automação,
 * auto-assign). Contato/conversa têm versão slim própria aqui pra NÃO tocar no
 * webhook Evolution (regra: provider Meta não pode quebrar o QR).
 * Doc: docs/whatsapp-cloud-api.md.
 */

const CHAT_BUCKET   = "chat-attachments"
const AI_DEBOUNCE_MS = 2500

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/amr": "amr",
  "video/mp4": "mp4", "video/3gpp": "3gp",
  "application/pdf": "pdf",
}
const MEDIA_LABEL: Record<string, string> = {
  image: "📷 Imagem", audio: "🎤 Áudio", video: "📹 Vídeo", document: "📎 Documento",
}
type MediaType = "image" | "audio" | "video" | "document"

interface InstanceRow {
  id: string; tenant_id: string; provider?: string | null
  meta_phone_number_id?: string | null; meta_business_account_id?: string | null
  meta_access_token?: string | null; meta_app_secret?: string | null
}
interface MetaMedia { id: string; mime_type?: string; caption?: string; filename?: string }
/**
 * CTWA — bloco que a Cloud API anexa na 1ª mensagem quando o lead vem de um
 * anúncio "Enviar mensagem". Formato RICO e confiável (≠ Baileys, que oscila
 * entre externalAdReply e o LID enxuto). Doc: WhatsApp Cloud API > referral.
 */
interface MetaReferral {
  source_url?:    string
  source_id?:     string   // Ad ID do Meta Ads Manager
  source_type?:   string   // "ad" | "post"
  headline?:      string
  body?:          string
  media_type?:    string   // "image" | "video"
  image_url?:     string
  video_url?:     string
  thumbnail_url?: string
  ctwa_clid?:     string   // Click-to-WhatsApp Click ID
}
/** Os 3 fields de ciclo de vida de template que a Cloud API entrega via webhook. */
const TEMPLATE_FIELDS = new Set([
  "message_template_status_update",
  "message_template_quality_update",
  "message_template_category_update",
])

/** Value cru de um change de template (campos opcionais — Meta omite o que não muda). */
interface MetaTemplateValue {
  message_template_id?:       string | number
  message_template_name?:     string
  message_template_language?: string
  // status_update
  event?:                     string   // APPROVED | REJECTED | PAUSED | DISABLED | ...
  reason?:                    string
  // quality_update
  previous_quality_score?:    string
  new_quality_score?:         string
  // category_update
  previous_category?:         string
  correct_category?:          string
  new_category?:              string   // alias usado em algumas versões do payload
}

interface MetaMessage {
  from: string; id: string; type: string
  timestamp?: string  // epoch (segundos) — relógio da Meta; âncora da janela de 24h
  text?: { body?: string }
  image?: MetaMedia; audio?: MetaMedia; video?: MetaMedia; document?: MetaMedia
  referral?: MetaReferral
}

/**
 * Infere a plataforma ("instagram"/"facebook") a partir do source_url — a Cloud
 * API NÃO manda um campo de app no referral. Relatórios filtram por `sourceApp`,
 * então preenchemos no ingest. UI também sabe inferir, mas guardar normaliza.
 */
function inferAdSourceApp(sourceUrl?: string): string | undefined {
  const u = (sourceUrl ?? "").toLowerCase()
  if (u.includes("instagram")) return "instagram"
  if (u.includes("facebook") || u.includes("fb.")) return "facebook"
  return undefined
}

/** Normaliza o `referral` da Cloud API pro shape ExternalAdReply (= from_ad_meta). */
function extractMetaReferral(msg: MetaMessage): ExternalAdReply | null {
  const r = msg.referral
  if (!r || (!r.source_id && !r.source_url && !r.ctwa_clid)) return null
  return {
    sourceApp:        inferAdSourceApp(r.source_url),
    sourceType:       r.source_type ?? "ad",
    sourceId:         r.source_id,
    sourceUrl:        r.source_url,
    ctwaClid:         r.ctwa_clid,
    title:            r.headline,
    body:             r.body,
    mediaType:        r.media_type,
    mediaUrl:         r.video_url ?? r.image_url,
    thumbnailUrl:     r.thumbnail_url,
    originalImageUrl: r.image_url,
    showAdAttribution: true,
    attributionFormat: "referral",
  }
}

/** Converte o timestamp epoch (segundos) da Meta pra ISO. Fallback: agora. */
function metaTsToIso(ts?: string): string {
  const n = Number(ts)
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString()
}

export async function processMetaWebhook(body: unknown): Promise<void> {
  const entries = (body as { entry?: unknown[] })?.entry ?? []
  for (const entry of entries) {
    for (const change of ((entry as { changes?: unknown[] })?.changes ?? [])) {
      const c = change as { field?: string; value?: Record<string, unknown> }

      // Ciclo de vida de templates (status/qualidade/categoria). Resolve o tenant
      // por WABA id (= entry.id), NÃO por phone_number_id (templates são por WABA).
      if (TEMPLATE_FIELDS.has(c.field ?? "")) {
        await processTemplateChange((entry as { id?: string })?.id, c.field!, c.value ?? {})
          .catch((e) => console.error("[meta-webhook] template:", e))
        continue
      }

      if (c.field !== "messages") continue
      const value = c.value ?? {}
      const pnid = (value.metadata as { phone_number_id?: string } | undefined)?.phone_number_id
      if (!pnid) continue

      const instance = await findInstance(pnid)
      if (!instance) { console.warn("[meta-webhook] instância não achada p/ phone_number_id", pnid); continue }

      // Status (delivered/read/failed)
      for (const st of (value.statuses as Array<{ id: string; status: string }> | undefined) ?? []) {
        await processStatus(instance.tenant_id, st).catch((e) => console.error("[meta-webhook] status:", e))
      }

      // Nome do contato (vem em contacts[])
      const nameByWa = new Map<string, string>()
      for (const ct of (value.contacts as Array<{ wa_id?: string; profile?: { name?: string } }> | undefined) ?? []) {
        if (ct.wa_id) nameByWa.set(ct.wa_id, ct.profile?.name ?? "")
      }

      for (const msg of (value.messages as MetaMessage[] | undefined) ?? []) {
        await processMessage(instance, msg, nameByWa.get(msg.from) ?? null)
          .catch((e) => console.error("[meta-webhook] message:", e))
      }
    }
  }
}

async function findInstance(phoneNumberId: string): Promise<InstanceRow | null> {
  const { data } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, tenant_id, provider, meta_phone_number_id, meta_business_account_id, meta_access_token, meta_app_secret")
    .eq("meta_phone_number_id", phoneNumberId)
    .maybeSingle()
  return (data ?? null) as InstanceRow | null
}

async function processMessage(instance: InstanceRow, msg: MetaMessage, pushName: string | null) {
  const phone = msg.from.replace(/\D/g, "")
  const jid   = `${phone}@s.whatsapp.net`   // mesma identidade do Evolution (mesmo contato se vier dos dois)

  const contact = await upsertContact(instance.tenant_id, jid, phone, pushName)
  const conv    = await findOrCreateConversation(instance.tenant_id, contact.id, instance.id)

  // CTWA — atribuição de anúncio (formato rico da Cloud API).
  const adReply = extractMetaReferral(msg)

  // Conteúdo + mídia
  let content: string | null = null
  let contentType = "text"
  let mediaUrl: string | null = null
  let mediaMime: string | null = null
  let mediaFileName: string | null = null
  const metadata: Record<string, unknown> = {}
  if (adReply) metadata.external_ad_reply = adReply
  // Rede de segurança temporária: guarda o referral CRU pra validar o mapeamento
  // contra o 1º lead de anúncio real no número oficial (campos da Meta não
  // diferenciados contra payload real ainda). Remover após confirmar o mapeamento.
  if (msg.referral) metadata.referral_raw = msg.referral

  if (msg.type === "text") {
    content = msg.text?.body ?? ""
  } else if (msg.type === "image" || msg.type === "audio" || msg.type === "video" || msg.type === "document") {
    const mt = msg.type as MediaType
    const mediaObj = msg[mt] as MetaMedia | undefined
    contentType = mt
    content = mediaObj?.caption ?? null
    mediaFileName = mediaObj?.filename ?? null
    if (mediaObj) {
      const stored = await storeMedia(instance, conv.id, mediaObj, mt, mediaFileName)
      if ("error" in stored) {
        metadata.media_error = stored.error
        metadata.media_error_at = new Date().toISOString()
      } else {
        mediaUrl = stored.signedUrl
        mediaMime = stored.mimeType ?? mediaObj.mime_type ?? null
        metadata.storage_path = stored.storagePath
      }
    }
  } else {
    // location/contacts/sticker/reaction/etc — registra como texto informativo (v1)
    content = `[mensagem do tipo "${msg.type}" não suportada]`
  }

  const preview = content && content.trim().length > 0
    ? content.substring(0, 100)
    : (MEDIA_LABEL[contentType] ?? "Mensagem")

  const { error: insErr } = await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conv.id,
    tenant_id:       instance.tenant_id,
    sender_type:     "contact",
    sender_id:       null,
    content_type:    contentType,
    content,
    media_url:       mediaUrl,
    media_mime_type: mediaMime,
    media_file_name: mediaFileName,
    whatsapp_msg_id: msg.id,
    status:          "delivered",
    is_private_note: false,
    metadata,
  })
  // 23505 = duplicata (Meta reenvia). Ignora silenciosamente.
  if (insErr) { if (insErr.code !== "23505") console.error("[meta-webhook] insert msg:", insErr.message); return }

  const wasResolved = conv.status === "resolved"
  await supabaseAdmin.from("chat_conversations").update({
    last_message_at:      new Date().toISOString(),
    last_message_preview: preview,
    last_message_dir:     "in",
    // Âncora da janela de 24h = relógio da Meta (timestamp do inbound), não o nosso.
    last_inbound_at:      metaTsToIso(msg.timestamp),
    unread_count:         (conv.unread_count ?? 0) + 1,
    status:               wasResolved ? "open" : conv.status,
    updated_at:           new Date().toISOString(),
    ...(wasResolved ? { resolved_at: null } : {}),
  }).eq("id", conv.id)

  // Push (PWA mobile) — fire-and-forget, nunca falha o webhook. Notifica o
  // atendente atribuído (ou todo o pool se ninguém assumiu ainda).
  {
    const notifyTitle = pushName || `+${phone}`
    const notifyPreview = preview
    after(() => notifyInboundMessage({
      tenantId: instance.tenant_id, conversationId: conv.id, title: notifyTitle, preview: notifyPreview,
    }))
  }

  // CTWA — registra atribuição (first-touch) no contato + denormaliza na conversa.
  // Espelha o caminho Baileys; nice-to-have, nunca falha o webhook.
  if (adReply) {
    console.log(JSON.stringify({
      event:       "ctwa_captured",
      channel:     "meta_cloud",
      tenant_id:   instance.tenant_id,
      contact_id:  contact.id,
      conv_id:     conv.id,
      source_app:  adReply.sourceApp ?? null,
      source_id:   adReply.sourceId ?? null,
      ctwa_clid:   adReply.ctwaClid ?? null,
    }))
    try {
      const { data: contactRow } = await supabaseAdmin
        .from("chat_contacts").select("metadata").eq("id", contact.id).single()
      const existingMeta = (contactRow?.metadata ?? {}) as Record<string, unknown>
      if (!existingMeta.first_ad_reply) {
        await supabaseAdmin.from("chat_contacts").update({
          metadata:   { ...existingMeta, first_ad_reply: slimAdMeta(adReply), first_ad_at: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        }).eq("id", contact.id)
      }
    } catch (e) { console.error("[meta-webhook] first_ad_reply:", e) }

    // Denormaliza na conversa (first-touch wins — só se ainda NULL).
    try {
      await supabaseAdmin.from("chat_conversations")
        .update({ from_ad_meta: slimAdMeta(adReply) }).eq("id", conv.id).is("from_ad_meta", null)
    } catch (e) { console.error("[meta-webhook] from_ad_meta:", e) }
  }

  // Auto-assign só em conversa nova (mesma regra do Evolution)
  if (conv._isNew) {
    after(async () => { try { await assignNextAgent(instance.tenant_id, conv.id) } catch (e) { console.error("[meta auto-assign]", e) } })
  }

  // Cadeia: keyword (sync) → IA (debounce) → automações fixas (fallback)
  let kwMatched = false
  if (content && msg.type === "text") {
    try {
      kwMatched = await evaluateKeywordTriggers({ tenantId: instance.tenant_id, conversationId: conv.id, text: content, instance })
    } catch (e) { console.error("[meta keyword]", e) }
  }
  if (!kwMatched) {
    const convId = conv.id
    const text = content
    after(async () => {
      try {
        if (text && msg.type === "text") {
          const baseline = await latestInboundAt(convId)
          await new Promise((r) => setTimeout(r, AI_DEBOUNCE_MS))
          if ((await latestInboundAt(convId)) !== baseline) return
          const ai = await runAITurn({ tenantId: instance.tenant_id, conversationId: convId, incomingText: text, instance })
          if (ai.status === "responded" || ai.status === "routed") return
          if (ai.status === "skipped" && ai.reason === "already_routed") return
        }
        await dispatchAutomations({ tenantId: instance.tenant_id, conversationId: convId, instance })
      } catch (e) { console.error("[meta ai+automation]", e) }
    })
  }
}

async function processStatus(tenantId: string, st: { id: string; status: string }) {
  const map: Record<string, { status: string; field?: string }> = {
    sent:      { status: "sent" },
    delivered: { status: "delivered", field: "delivered_at" },
    read:      { status: "read", field: "read_at" },
    failed:    { status: "failed" },
  }
  const m = map[st.status]
  if (!m) return
  const update: Record<string, unknown> = { status: m.status }
  if (m.field) update[m.field] = new Date().toISOString()
  await supabaseAdmin.from("chat_messages").update(update).eq("whatsapp_msg_id", st.id).eq("tenant_id", tenantId)
}

// ── Ciclo de vida de templates (status/qualidade/categoria) ──

/** Resolve tenant+instância pelo WABA id (entry.id) no provider oficial. */
async function findInstanceByWaba(wabaId: string): Promise<{ id: string; tenant_id: string } | null> {
  const { data } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, tenant_id")
    .eq("meta_business_account_id", wabaId)
    .eq("provider", "meta_cloud")
    .maybeSingle()
  return (data ?? null) as { id: string; tenant_id: string } | null
}

/**
 * Processa um change de template: atualiza o cache (estado atual) e loga o evento
 * (histórico). Defensivo — campos podem faltar; cache/log são fire-and-forget.
 */
async function processTemplateChange(wabaId: string | undefined, field: string, value: Record<string, unknown>) {
  if (!wabaId) { console.warn("[meta-webhook] template sem entry.id (WABA id)"); return }
  const instance = await findInstanceByWaba(wabaId)
  if (!instance) { console.warn("[meta-webhook] instância não achada p/ WABA id", wabaId); return }

  const v = value as MetaTemplateValue
  const templateId = v.message_template_id != null ? String(v.message_template_id) : null
  const name       = v.message_template_name ?? ""
  const language   = v.message_template_language ?? ""

  // Mapeia o field → tipo do evento e os deltas (old/new) específicos de cada um.
  let event: "status_update" | "quality_update" | "category_update"
  let cachePatch: Parameters<typeof upsertTemplateCache>[3]
  let oldValue: string | null = null
  let newValue: string | null = null

  if (field === "message_template_status_update") {
    event = "status_update"
    const isRejected = v.event === "REJECTED"
    cachePatch = {
      templateId, name, language,
      status:         v.event ?? null,
      rejectedReason: isRejected ? (v.reason ?? null) : null,
    }
    newValue = v.event ?? null
  } else if (field === "message_template_quality_update") {
    event = "quality_update"
    cachePatch = { templateId, name, language, qualityScore: v.new_quality_score ?? null }
    oldValue = v.previous_quality_score ?? null
    newValue = v.new_quality_score ?? null
  } else {
    // message_template_category_update — `correct_category` (ou `new_category` em algumas versões).
    event = "category_update"
    const correct = v.correct_category ?? v.new_category ?? null
    cachePatch = { templateId, name, language, correctCategory: correct }
    oldValue = v.previous_category ?? null
    newValue = correct
  }

  // Fire-and-forget (ambas já têm try/catch interno) — nunca derruba o webhook.
  await upsertTemplateCache(instance.tenant_id, instance.id, wabaId, cachePatch)
  await logTemplateEvent(instance.tenant_id, {
    templateId, name, language, event, oldValue, newValue, reason: v.reason ?? null,
  })
}

// ── Contato/conversa slim (próprios — não tocam no Evolution) ──
async function upsertContact(tenantId: string, jid: string, phone: string, pushName: string | null) {
  const { data, error } = await supabaseAdmin
    .from("chat_contacts")
    .upsert({
      tenant_id: tenantId, whatsapp_id: jid, phone_number: phone, push_name: pushName,
      primary_channel: "whatsapp", primary_external_id: jid, updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id,whatsapp_id", ignoreDuplicates: false })
    .select("id").single()
  if (error || !data) throw new Error(`meta upsertContact: ${error?.message}`)
  return { id: data.id as string }
}

async function findOrCreateConversation(tenantId: string, contactId: string, instanceId: string) {
  const dedup = await findOrReopenConversation({ tenantId, contactId, instanceId, skipOwnershipCheck: true })
  if (dedup.found !== "none") {
    const c = dedup.conversation as unknown as { id: string; status: string; unread_count: number }
    return { id: c.id, status: c.status, unread_count: c.unread_count, _isNew: false }
  }

  let pipelineId: string | null = null
  let stageId: string | null = null
  const { data: cfg } = await supabaseAdmin.from("tenant_config").select("default_pipeline_id").eq("tenant_id", tenantId).maybeSingle()
  if (cfg?.default_pipeline_id) {
    pipelineId = cfg.default_pipeline_id
    const { data: triage } = await supabaseAdmin
      .from("pipeline_stages").select("id")
      .eq("pipeline_id", pipelineId).eq("tenant_id", tenantId).eq("is_triage", true)
      .order("position", { ascending: true }).limit(1).maybeSingle()
    stageId = triage?.id ?? null
  }

  const { data: nc, error } = await supabaseAdmin
    .from("chat_conversations")
    .insert({ tenant_id: tenantId, contact_id: contactId, instance_id: instanceId, status: "open", unread_count: 0, pipeline_id: pipelineId, stage_id: stageId, card_position: 0 })
    .select("id, status, unread_count").single()

  if (error?.code === "23505") {
    const retry = await findOrReopenConversation({ tenantId, contactId, skipOwnershipCheck: true })
    const c = retry.conversation as unknown as { id: string; status: string; unread_count: number }
    return { id: c.id, status: c.status, unread_count: c.unread_count, _isNew: false }
  }
  if (error || !nc) throw new Error(`meta findOrCreateConversation: ${error?.message}`)
  return { id: nc.id as string, status: nc.status as string, unread_count: nc.unread_count as number, _isNew: true }
}

async function storeMedia(
  instance: InstanceRow, conversationId: string, mediaObj: MetaMedia, type: MediaType, knownFileName: string | null,
): Promise<{ storagePath: string; signedUrl: string; mimeType: string | null } | { error: string }> {
  try {
    const provider = getProvider(instance)
    const result = await provider.getMediaBase64(mediaObj)
    if (!result?.base64) return { error: "no_base64" }

    const mimeType = (result.mimetype ?? mediaObj.mime_type ?? "").split(";")[0].trim() || null
    const ext = (mimeType && MIME_EXT[mimeType]) ?? "bin"
    const baseName = knownFileName ?? result.fileName ?? `${type}_${Date.now()}.${ext}`
    const safe = baseName.replace(/[^a-zA-Z0-9.\-_]/g, "_")
    const storagePath = `${instance.tenant_id}/${conversationId}/${Date.now()}_${safe}`

    const buffer = Buffer.from(result.base64, "base64")
    const { error: upErr } = await supabaseAdmin.storage.from(CHAT_BUCKET)
      .upload(storagePath, buffer, { contentType: mimeType ?? "application/octet-stream", upsert: false })
    if (upErr) return { error: `storage_upload: ${upErr.message}` }

    const { data: signed } = await supabaseAdmin.storage.from(CHAT_BUCKET).createSignedUrl(storagePath, 3600)
    if (!signed?.signedUrl) return { error: "signed_url_failed" }
    return { storagePath, signedUrl: signed.signedUrl, mimeType }
  } catch (err) {
    return { error: `unexpected: ${(err as Error).message}` }
  }
}
