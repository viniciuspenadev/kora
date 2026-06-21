import "server-only"
import { after } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getProvider } from "@/lib/providers"
import { findOrReopenConversation } from "@/lib/conversation-dedup"
import { resolveOrCreateContact } from "@/lib/contacts/identity"
import { routeAutomationTurn } from "@/lib/ai-v2/dispatch"
import { latestInboundAt } from "@/lib/ai/context"
import { dispatchAutomations } from "@/lib/automation/dispatch"
import { evaluateKeywordTriggers } from "@/lib/automation/keyword-engine"
import { assignNextAgent } from "@/lib/automation/auto-assign"
import { handleAgendaReply } from "@/lib/agenda/interceptor"
import { notifyInboundMessage } from "@/lib/push/send"
import { upsertTemplateCache, logTemplateEvent } from "@/lib/channels/template-cache"
import { HEALTH_FIELDS, processHealthWebhook } from "@/lib/channels/health"
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
const PREVIEW_LABEL: Record<string, string> = {
  image: "📷 Imagem", audio: "🎤 Áudio", video: "📹 Vídeo", document: "📎 Documento",
  sticker: "Sticker", location: "📍 Localização", contact: "👤 Contato",
  reaction: "Reação", poll: "📊 Enquete", interactive: "Resposta",
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

interface MetaMediaAudio extends MetaMedia { voice?: boolean }
interface MetaLocation { latitude?: number; longitude?: number; name?: string; address?: string; url?: string }
interface MetaContactPayload {
  name?:   { formatted_name?: string; first_name?: string; last_name?: string }
  phones?: { phone?: string; wa_id?: string; type?: string }[]
  emails?: { email?: string; type?: string }[]
  org?:    { company?: string }
}
interface MetaReaction { message_id?: string; emoji?: string }
interface MetaInteractive {
  type?:         string  // button_reply | list_reply | nfm_reply
  button_reply?: { id?: string; title?: string }
  list_reply?:   { id?: string; title?: string; description?: string }
  nfm_reply?:    { name?: string; body?: string; response_json?: string }
}
interface MetaButton { text?: string; payload?: string }  // tap em quick-reply de template
interface MetaOrder {
  catalog_id?:    string
  text?:          string
  product_items?: { product_retailer_id?: string; quantity?: number; item_price?: number; currency?: string }[]
}
interface MetaSystem { body?: string; type?: string; wa_id?: string }
/** Bloco de citação/encaminhamento que a Cloud API anexa a qualquer mensagem. */
interface MetaContext {
  from?:                 string
  id?:                   string   // whatsapp_msg_id da mensagem citada
  forwarded?:            boolean
  frequently_forwarded?: boolean
}
interface MetaError { code?: number; title?: string; message?: string }

interface MetaMessage {
  // BSUID: `from_user_id` (BSUID) é SEMPRE presente daqui pra frente; `from` (telefone)
  // PODE faltar quando o cliente usa username. Ver docs/BUSID/bsuid-adaptation-plan.md.
  from?: string; from_user_id?: string; id: string; type: string
  timestamp?: string  // epoch (segundos) — relógio da Meta; âncora da janela de 24h
  text?: { body?: string }
  image?: MetaMedia; audio?: MetaMediaAudio; video?: MetaMedia; document?: MetaMedia; sticker?: MetaMedia
  location?:    MetaLocation
  contacts?:    MetaContactPayload[]
  reaction?:    MetaReaction
  interactive?: MetaInteractive
  button?:      MetaButton
  order?:       MetaOrder
  system?:      MetaSystem
  context?:     MetaContext
  errors?:      MetaError[]
  referral?:    MetaReferral
}

/** Shape canônico do conteúdo extraído de um inbound da Cloud API (= contrato do inbox). */
interface MetaExtract {
  contentType:  string
  content:      string | null
  download?:    { obj: MetaMedia; storageType: MediaType }
  fileName?:    string | null
  metadata:     Record<string, unknown>
  /** Texto que alimenta keyword/IA/menu (corpo do texto OU título do botão/lista). */
  routableText: string | null
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

/** Monta um vCard mínimo a partir do contato estruturado da Cloud API (o inbox lê `vcard`). */
function buildVCard(c: MetaContactPayload): string {
  const name  = c.name?.formatted_name || [c.name?.first_name, c.name?.last_name].filter(Boolean).join(" ") || "Contato"
  const tel   = c.phones?.[0]?.phone
  const email = c.emails?.[0]?.email
  const org   = c.org?.company
  return [
    "BEGIN:VCARD", "VERSION:3.0", `FN:${name}`,
    org ? `ORG:${org}` : null,
    tel ? `TEL;type=CELL:${tel}` : null,
    email ? `EMAIL:${email}` : null,
    "END:VCARD",
  ].filter(Boolean).join("\n")
}

/**
 * Decodifica QUALQUER tipo de inbound da Cloud API pro shape canônico do inbox
 * (espelha o `extractMessageContent` do webhook Evolution). O que não renderiza
 * vira `unsupported` com `unsupported_type` — nunca quebra, nunca dump cru.
 */
function extractMetaContent(msg: MetaMessage): MetaExtract {
  const meta: Record<string, unknown> = {}
  // Citação / encaminhamento — vale pra qualquer tipo de mensagem.
  if (msg.context?.id) {
    meta.quoted = { msg_id: msg.context.id, participant: msg.context.from ?? null, kind: null, preview: null }
  }
  if (msg.context?.forwarded || msg.context?.frequently_forwarded) meta.forwarded = true
  if (msg.errors?.length) meta.errors = msg.errors

  switch (msg.type) {
    case "text":
      return { contentType: "text", content: msg.text?.body ?? "", metadata: meta, routableText: msg.text?.body ?? null }

    case "image": case "video": case "document": {
      const obj = msg[msg.type] as MetaMedia | undefined
      return {
        contentType: msg.type, content: obj?.caption ?? null,
        download: obj ? { obj, storageType: msg.type } : undefined,
        fileName: obj?.filename ?? null, metadata: meta, routableText: obj?.caption ?? null,
      }
    }
    case "audio": {
      const obj = msg.audio
      if (obj?.voice) meta.voice = true
      return {
        contentType: "audio", content: null,
        download: obj ? { obj, storageType: "audio" } : undefined,
        metadata: meta, routableText: null,
      }
    }
    case "sticker": {
      const obj = msg.sticker
      return {
        contentType: "sticker", content: null,
        download: obj ? { obj, storageType: "image" } : undefined,  // webp baixa como imagem
        metadata: meta, routableText: null,
      }
    }

    case "location": {
      const l = msg.location
      if (l) { meta.location_name = l.name ?? null; meta.location_address = l.address ?? null }
      return {
        contentType: "location",
        content: l ? `${l.latitude ?? 0},${l.longitude ?? 0}` : null,
        metadata: meta, routableText: null,
      }
    }

    case "contacts": {
      const list = msg.contacts ?? []
      meta.contacts = list.map((c) => ({ name: c.name?.formatted_name ?? "Contato", vcard: buildVCard(c) }))
      const content = list.length === 1 ? (list[0].name?.formatted_name ?? "Contato") : `${list.length} contatos`
      return { contentType: "contact", content, metadata: meta, routableText: null }
    }

    case "reaction": {
      meta.reacted_to_id = msg.reaction?.message_id ?? null
      return { contentType: "reaction", content: msg.reaction?.emoji ?? "", metadata: meta, routableText: null }
    }

    case "interactive": {
      const it = msg.interactive
      if (it?.button_reply) {
        meta.interactive_kind = "button"; meta.interactive_id = it.button_reply.id ?? null
        const t = it.button_reply.title ?? null
        return { contentType: "interactive", content: t, metadata: meta, routableText: t }
      }
      if (it?.list_reply) {
        meta.interactive_kind = "list"; meta.interactive_id = it.list_reply.id ?? null
        const t = it.list_reply.title ?? null
        return { contentType: "interactive", content: t, metadata: meta, routableText: t }
      }
      if (it?.nfm_reply) {
        meta.interactive_kind = "interactive"; meta.nfm_response = it.nfm_reply.response_json ?? null
        return { contentType: "interactive", content: it.nfm_reply.body || it.nfm_reply.name || "Resposta de formulário", metadata: meta, routableText: null }
      }
      meta.interactive_kind = "interactive"
      return { contentType: "interactive", content: "Resposta interativa", metadata: meta, routableText: null }
    }

    case "button": {  // tap num botão de QUICK_REPLY de template aprovado
      meta.interactive_kind = "template_button"; meta.interactive_id = msg.button?.payload ?? null
      const t = msg.button?.text ?? null
      return { contentType: "interactive", content: t, metadata: meta, routableText: t }
    }

    case "order": {  // comércio — fora de escopo no Kora: marcador gracioso
      meta.unsupported_type = "order"; meta.order = msg.order
      const n = msg.order?.product_items?.length ?? 0
      return {
        contentType: "unsupported",
        content: msg.order?.text || (n ? `🛒 Pedido com ${n} ${n === 1 ? "item" : "itens"}` : "🛒 Pedido recebido"),
        metadata: meta, routableText: null,
      }
    }

    case "system": {
      meta.unsupported_type = "system"
      return { contentType: "unsupported", content: msg.system?.body ?? "Evento do sistema", metadata: meta, routableText: null }
    }

    default: {  // unknown / unsupported / request_welcome / etc.
      meta.unsupported_type = msg.type ?? "unknown"
      const errTitle = msg.errors?.[0]?.title
      return {
        contentType: "unsupported",
        content: errTitle ? `[${errTitle}]` : `[mensagem do tipo "${msg.type}" não suportada]`,
        metadata: meta, routableText: null,
      }
    }
  }
}

/**
 * Resolve o preview da mensagem citada (a Cloud API só manda o id). Best-effort:
 * procura pelo whatsapp_msg_id já gravado — assim o card "em resposta a" mostra texto.
 */
async function resolveQuotedPreview(
  tenantId: string, quotedMsgId: string,
): Promise<{ msg_id: string; preview: string; kind: string } | null> {
  const { data } = await supabaseAdmin
    .from("chat_messages")
    .select("content, content_type")
    .eq("tenant_id", tenantId).eq("whatsapp_msg_id", quotedMsgId)
    .maybeSingle()
  if (!data) return null
  const kind    = (data.content_type as string) ?? "text"
  const preview = ((data.content as string)?.trim()) || PREVIEW_LABEL[kind] || "Mensagem"
  return { msg_id: quotedMsgId, preview: preview.slice(0, 200), kind }
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

      // Saúde do número (restrição/ban/qualidade/tier) — também por WABA id.
      if (HEALTH_FIELDS.has(c.field ?? "")) {
        await processHealthWebhook((entry as { id?: string })?.id, c.field!, (c.value ?? {}) as Parameters<typeof processHealthWebhook>[2])
          .catch((e) => console.error("[meta-webhook] health:", e))
        continue
      }

      // BSUID — monitoramento (TEMPORÁRIO): o webhook `user_id_update` traz o par
      // previous→current do BSUID na troca de número. Handler ainda não implementado —
      // só logamos o payload cru pra destravar (docs/BUSID/bsuid-adaptation-plan.md §6.4).
      // Exige subscrever o field no app Meta. Remover após capturar 1 evento real.
      if (c.field === "user_id_update") {
        console.log(JSON.stringify({ event: "bsuid_user_id_update", waba: (entry as { id?: string })?.id ?? null, value: c.value ?? null }))
        continue
      }

      if (c.field !== "messages") continue
      const value = c.value ?? {}
      const pnid = (value.metadata as { phone_number_id?: string } | undefined)?.phone_number_id
      if (!pnid) continue

      const instance = await findInstance(pnid)
      if (!instance) { console.warn("[meta-webhook] instância não achada p/ phone_number_id", pnid); continue }

      // Status (delivered/read/failed + erro/cobrança)
      for (const st of (value.statuses as MetaStatus[] | undefined) ?? []) {
        await processStatus(instance.tenant_id, st).catch((e) => console.error("[meta-webhook] status:", e))
      }

      // Nome + username do contato (vêm em contacts[]) — indexados por telefone (wa_id)
      // E BSUID (user_id), porque o telefone pode faltar quando o cliente usa username.
      const nameById = new Map<string, string>()
      const userById = new Map<string, string>()   // @handle (profile.username) — display, mutável
      for (const ct of (value.contacts as Array<{ wa_id?: string; user_id?: string; profile?: { name?: string; username?: string } }> | undefined) ?? []) {
        const nm = ct.profile?.name ?? ""
        const un = ct.profile?.username ?? ""
        if (ct.wa_id)   { nameById.set(ct.wa_id, nm);   if (un) userById.set(ct.wa_id, un) }
        if (ct.user_id) { nameById.set(ct.user_id, nm); if (un) userById.set(ct.user_id, un) }
      }

      for (const msg of (value.messages as MetaMessage[] | undefined) ?? []) {
        const nm = (msg.from && nameById.get(msg.from)) || (msg.from_user_id && nameById.get(msg.from_user_id)) || null
        const un = (msg.from && userById.get(msg.from)) || (msg.from_user_id && userById.get(msg.from_user_id)) || null
        await processMessage(instance, msg, nm, un)
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

async function processMessage(instance: InstanceRow, msg: MetaMessage, pushName: string | null, username: string | null = null) {
  // BSUID — monitoramento (TEMPORÁRIO): captura o payload REAL da troca-de-número
  // (system `user_changed_user_id`) pra destravar o handler (docs/BUSID §6.4). O bloco
  // `system` traz `user_id` (novo BSUID) + `body` ("changed from OLD to NEW"). Remover após capturar.
  if (msg.type === "system") {
    console.log(JSON.stringify({ event: "bsuid_system_message", system: msg.system ?? null, from: msg.from ?? null, from_user_id: msg.from_user_id ?? null, id: msg.id }))
  }
  // BSUID: `from_user_id` é SEMPRE presente; `from` (telefone) PODE faltar (username).
  // Identidade = telefone quando há (unifica com Evolution), senão o BSUID. Nunca estoura.
  const bsuid = msg.from_user_id?.trim() || null
  const phone = msg.from ? msg.from.replace(/\D/g, "") : null
  const jid   = phone ? `${phone}@s.whatsapp.net` : null

  if (!jid && !bsuid) {
    console.warn("[meta-webhook] inbound sem telefone nem BSUID — ignorado:", msg.id)
    return
  }

  const contact = await upsertContact(instance.tenant_id, { jid, phone, bsuid, pushName, username })
  const conv    = await findOrCreateConversation(instance.tenant_id, contact.id, instance.id)

  // CTWA — atribuição de anúncio (formato rico da Cloud API).
  const adReply = extractMetaReferral(msg)

  // Conteúdo — decodifica QUALQUER tipo pro shape canônico do inbox.
  const ext = extractMetaContent(msg)
  const contentType = ext.contentType
  const content     = ext.content
  const metadata: Record<string, unknown> = { ...ext.metadata }
  if (adReply) metadata.external_ad_reply = adReply
  // Rede de segurança temporária: guarda o referral CRU pra validar o mapeamento
  // contra o 1º lead de anúncio real no número oficial (campos da Meta não
  // diferenciados contra payload real ainda). Remover após confirmar o mapeamento.
  if (msg.referral) metadata.referral_raw = msg.referral

  // Mídia (image/audio/video/document/sticker) → baixa da Meta + guarda no storage.
  let mediaUrl: string | null = null
  let mediaMime: string | null = null
  const mediaFileName: string | null = ext.fileName ?? null
  if (ext.download) {
    const stored = await storeMedia(instance, conv.id, ext.download.obj, ext.download.storageType, mediaFileName)
    if ("error" in stored) {
      metadata.media_error = stored.error
      metadata.media_error_at = new Date().toISOString()
    } else {
      mediaUrl = stored.signedUrl
      mediaMime = stored.mimeType ?? ext.download.obj.mime_type ?? null
      metadata.storage_path = stored.storagePath
    }
  }

  // Citação: a Cloud API só manda o id citado — resolvemos o preview pro card "em resposta a".
  if (msg.context?.id) {
    const q = await resolveQuotedPreview(instance.tenant_id, msg.context.id)
    if (q) metadata.quoted = { ...(metadata.quoted as Record<string, unknown> ?? {}), ...q }
  }

  const preview = content && content.trim().length > 0
    ? content.substring(0, 100)
    : (PREVIEW_LABEL[contentType] ?? "Mensagem")

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

  // Read receipt (✓✓ azul pro cliente) — best-effort, nunca falha o webhook.
  after(async () => { try { await getProvider(instance).markAsRead?.(msg.id) } catch { /* noop */ } })

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

  // Texto "roteável": corpo do texto OU o título do botão/lista tocado. É ele que
  // acorda a cadeia (keyword/IA/menu) e o interceptor da Agenda.
  const routable = ext.routableText

  // Camada 0 — interceptor da Agenda (round-trip oficial, §6.10). Determinístico,
  // fail-safe; roteia pelo id do botão/lista (`agenda:*`) ou pelo texto. Se tratou
  // (confirmar/remarcar), bypassa push + keyword + IA (não é "mensagem nova").
  let agendaHandled = false
  try {
    agendaHandled = await handleAgendaReply({
      tenantId: instance.tenant_id, conversationId: conv.id, text: routable ?? "", instance,
      interactiveId: (ext.metadata as { interactive_id?: string })?.interactive_id ?? undefined,
    })
  } catch (e) { console.error("[meta agenda-interceptor]", e) }

  // Push (PWA mobile) — fire-and-forget, nunca falha o webhook. Notifica o
  // atendente atribuído (ou todo o pool se ninguém assumiu ainda).
  if (!agendaHandled) {
    const notifyTitle = pushName || (phone ? `+${phone}` : "Novo contato")
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

  // Cadeia: keyword (sync) → IA (debounce) → automações fixas (fallback). Pulada
  // quando a Agenda já consumiu a resposta (Camada 0 acima).
  if (!agendaHandled) {
    let kwMatched = false
    if (routable && msg.type === "text") {  // keyword só em texto puro (paridade c/ Evolution)
      try {
        kwMatched = await evaluateKeywordTriggers({ tenantId: instance.tenant_id, conversationId: conv.id, text: routable, instance })
      } catch (e) { console.error("[meta keyword]", e) }
    }
    if (!kwMatched) {
      const convId = conv.id
      const text = routable
      const msgId = msg.id
      after(async () => {
        try {
          if (text) {
            const baseline = await latestInboundAt(convId)
            await new Promise((r) => setTimeout(r, AI_DEBOUNCE_MS))
            if ((await latestInboundAt(convId)) !== baseline) return
            // "digitando…" honesto: só quando vamos de fato gerar resposta.
            try { await getProvider(instance).sendTyping?.(msgId) } catch { /* noop */ }
            const ai = await routeAutomationTurn({ tenantId: instance.tenant_id, conversationId: convId, incomingText: text, instance })
            if (ai.status === "responded" || ai.status === "routed") return
            if (ai.status === "skipped" && ai.reason === "already_routed") return
          }
          await dispatchAutomations({ tenantId: instance.tenant_id, conversationId: convId, instance })
        } catch (e) { console.error("[meta ai+automation]", e) }
      })
    }
  }
}

interface MetaStatus {
  id: string; status: string
  conversation?: { id?: string; origin?: { type?: string } }
  pricing?:      { billable?: boolean; pricing_model?: string; category?: string }
  errors?:       Array<{ code?: number; title?: string; message?: string }>
}

async function processStatus(tenantId: string, st: MetaStatus) {
  const map: Record<string, { status: string; field?: string }> = {
    sent:      { status: "sent" },
    delivered: { status: "delivered", field: "delivered_at" },
    read:      { status: "read", field: "read_at" },
    failed:    { status: "failed" },
  }
  const m = map[st.status]
  if (m) {
    const update: Record<string, unknown> = { status: m.status }
    if (m.field) update[m.field] = new Date().toISOString()
    // Falha → guarda o MOTIVO no metadata (merge) pra bolha exibir "por que falhou".
    if (st.status === "failed" && st.errors?.length) {
      const e = st.errors[0]
      const { data: row } = await supabaseAdmin
        .from("chat_messages").select("metadata")
        .eq("whatsapp_msg_id", st.id).eq("tenant_id", tenantId).maybeSingle()
      const meta = (row?.metadata ?? {}) as Record<string, unknown>
      update.metadata = { ...meta, error: { code: e.code ?? null, title: e.title ?? null, message: e.message ?? null } }
    }
    await supabaseAdmin.from("chat_messages").update(update).eq("whatsapp_msg_id", st.id).eq("tenant_id", tenantId)
  }

  // Fundação do financeiro: categoria/cobrança da conversa (dedup por conversation.id
  // via índice único parcial → 23505 ignorado; a Meta reemite o mesmo id na janela).
  if (st.conversation?.id) {
    const { error } = await supabaseAdmin.from("wa_billing_events").insert({
      tenant_id:          tenantId,
      wa_conversation_id: st.conversation.id,
      category:           st.pricing?.category ?? st.conversation.origin?.type ?? null,
      pricing_model:      st.pricing?.pricing_model ?? null,
      billable:           st.pricing?.billable ?? null,
    })
    if (error && error.code !== "23505") console.error("[meta-billing]", error.message)
  }
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
/**
 * Contato Meta com identidade DUPLA: telefone (jid) e/ou BSUID. Acha por QUALQUER
 * uma das chaves e faz MERGE (anexa só o que faltava). Como hoje telefone+BSUID
 * co-ocorrem, o BSUID gruda no contato existente → quando no futuro vier só-BSUID,
 * acha o MESMO contato (não fragmenta). Doc: docs/BUSID/bsuid-adaptation-plan.md §2.2.
 */
async function upsertContact(
  tenantId: string,
  { jid, phone, bsuid, pushName, username }: { jid: string | null; phone: string | null; bsuid: string | null; pushName: string | null; username?: string | null },
): Promise<{ id: string }> {
  // Identidade via RESOLVER CANÔNICO (fonte única) — paridade: find jid→bsuid, merge
  // backfill + push_name latest, source no DEFAULT, updated_at sempre (touch).
  const r = await resolveOrCreateContact(tenantId, { jid, phone, bsuid }, { pushName, username, touch: true })
  return { id: r.id }
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
