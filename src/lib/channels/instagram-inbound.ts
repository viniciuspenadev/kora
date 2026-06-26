import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveOrCreateContact } from "@/lib/contacts/identity"
import { findOrReopenConversation } from "@/lib/conversation-dedup"
import { decryptSecret } from "@/lib/crypto/secrets"
import { fetchIgProfile } from "@/lib/instagram/api"

/**
 * Ingestão do Instagram Direct (caminho "API do Instagram com login do Instagram")
 * — ISOLADA do meta-inbound (WhatsApp). Decodifica TODOS os tipos interativos da API
 * pro MESMO shape `{content_type, content, metadata}` do WhatsApp Oficial → a UI do
 * inbox renderiza sem nenhuma mudança. Roteia o tenant por `channel_connections`.
 * Comentário (comment-to-DM) = F2; resposta do BOT/menu = camada seguinte. Doc:
 * docs/instagram-direct-design.md.
 */

const IG_PLACEHOLDER_NAME = "Usuário do Instagram"
const CHAT_BUCKET = "chat-attachments"

// ── Tipos do webhook (messaging[]) ───────────────────────────────
type IgAttachment = { type?: string; payload?: { url?: string; title?: string } }
type IgMessage = {
  mid?: string; text?: string; is_echo?: boolean; is_deleted?: boolean
  attachments?: IgAttachment[]
  quick_reply?: { payload?: string }
  reply_to?:    { mid?: string; story?: { id?: string; url?: string } }
}
type IgReaction  = { mid?: string; action?: string; reaction?: string; emoji?: string }
type IgMessaging = {
  sender?: { id?: string }; recipient?: { id?: string }; timestamp?: number
  message?:  IgMessage
  postback?: { mid?: string; title?: string; payload?: string }
  reaction?: IgReaction
  read?:     { mid?: string }
  referral?: { ref?: string; source?: string; type?: string }
}
type IgChange  = { field?: string; value?: Record<string, unknown> }
type IgEntry   = { id?: string; time?: number; messaging?: IgMessaging[]; changes?: IgChange[] }
type IgWebhook = { object?: string; entry?: IgEntry[] }

const MEDIA_LABEL: Record<string, string> = { image: "📷 Imagem", video: "📹 Vídeo", audio: "🎤 Áudio", file: "📎 Arquivo", share: "🔗 Compartilhado", story_mention: "📖 Menção no story" }
const PREVIEW_LABEL: Record<string, string> = { image: "📷 Imagem", audio: "🎤 Áudio", video: "📹 Vídeo", document: "📎 Documento", reaction: "Reação", interactive: "Resposta", deleted: "Mensagem apagada" }
function attachmentKind(type?: string): string {
  return type === "image" ? "image" : type === "video" ? "video" : type === "audio" ? "audio" : "document"
}
function log(kind: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ src: "ig-inbound", kind, ...data }))
}

// ── Storage de mídia ─────────────────────────────────────────────
const IG_MIME_EXT: Record<string, string> = {
  "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/aac": "aac", "audio/ogg": "ogg", "audio/amr": "amr",
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/quicktime": "mov",
}
const KIND_MIME: Record<string, string> = { audio: "audio/mp4", image: "image/jpeg", video: "video/mp4", document: "application/octet-stream" }

/** Baixa a mídia do IG (URL temporária do attachment) e sobe no bucket → toca de verdade. */
async function storeIgMedia(tenantId: string, conversationId: string, url: string, kind: string): Promise<{ mediaUrl: string; mime: string; storagePath: string } | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) { log("media-err", { reason: `fetch ${r.status}` }); return null }
    const mime = r.headers.get("content-type")?.split(";")[0].trim() || KIND_MIME[kind] || "application/octet-stream"
    const ext  = IG_MIME_EXT[mime] ?? (kind === "audio" ? "m4a" : kind === "image" ? "jpg" : kind === "video" ? "mp4" : "bin")
    const buf  = Buffer.from(await r.arrayBuffer())
    const path = `${tenantId}/${conversationId}/${Date.now()}_ig_${kind}.${ext}`
    const { error: up } = await supabaseAdmin.storage.from(CHAT_BUCKET).upload(path, buf, { contentType: mime, upsert: false })
    if (up) { log("media-err", { reason: up.message }); return null }
    const { data: signed } = await supabaseAdmin.storage.from(CHAT_BUCKET).createSignedUrl(path, 3600)
    if (!signed?.signedUrl) return null
    return { mediaUrl: signed.signedUrl, mime, storagePath: path }
  } catch (e) { log("media-err", { reason: (e as Error).message }); return null }
}

// ── Tenant/contato/conversa ──────────────────────────────────────
/** Conta IG conectada → tenant + token (decifrado). 1 conta = 1 tenant. */
async function connectionFor(igAccountId: string): Promise<{ tenantId: string; token: string | null } | null> {
  const { data } = await supabaseAdmin.from("channel_connections")
    .select("tenant_id, access_token").eq("channel", "instagram").eq("external_account_id", igAccountId).eq("status", "active").maybeSingle()
  if (!data) return null
  return { tenantId: data.tenant_id as string, token: decryptSecret(data.access_token as string | null) }
}

/** Enriquece o contato (nome/@/foto) via Graph API — precisa do token; senão placeholder. */
async function maybeEnrich(token: string | null, igsid: string, contactId: string, created: boolean): Promise<void> {
  if (!token) {
    if (created) await supabaseAdmin.from("chat_contacts").update({ push_name: IG_PLACEHOLDER_NAME }).eq("id", contactId).is("push_name", null)
    return
  }
  if (!created) {
    const { data } = await supabaseAdmin.from("chat_contacts").select("push_name").eq("id", contactId).single()
    const pn = data?.push_name as string | null
    if (pn && pn !== IG_PLACEHOLDER_NAME) return
  }
  const prof = await fetchIgProfile(igsid, token)
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (prof?.name)       patch.push_name       = prof.name
  if (prof?.username)   patch.username        = prof.username
  if (prof?.profilePic) patch.profile_pic_url = prof.profilePic
  if (!prof?.name && created) patch.push_name = IG_PLACEHOLDER_NAME
  await supabaseAdmin.from("chat_contacts").update(patch).eq("id", contactId)
}

async function defaultInstanceId(tenantId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("whatsapp_instances")
    .select("id").eq("tenant_id", tenantId).order("created_at", { ascending: true }).limit(1).maybeSingle()
  return (data?.id as string) ?? null
}

async function getOrCreateIgConversation(tenantId: string, contactId: string, instanceId: string): Promise<{ id: string; isNew: boolean }> {
  const dedup = await findOrReopenConversation({ tenantId, contactId, skipOwnershipCheck: true })
  if (dedup.found !== "none") return { id: dedup.conversation.id, isNew: false }
  const { data, error } = await supabaseAdmin.from("chat_conversations").insert({
    tenant_id: tenantId, contact_id: contactId, instance_id: instanceId,
    channel: "instagram", status: "open", unread_count: 0, assigned_to: null, last_message_at: new Date().toISOString(),
  }).select("id").single()
  if (error || !data) throw new Error(`ig conv: ${error?.message ?? "desconhecido"}`)
  return { id: data.id as string, isNew: true }
}

/** Resolve tenant + contato (identidade IG) + conversa de uma vez (fonte única). */
async function resolveIgContext(igAccountId: string, fromIgsid: string): Promise<{ tenantId: string; convId: string; token: string | null } | null> {
  const conn = await connectionFor(igAccountId)
  if (!conn) { log("skip", { reason: "no-connection", igAccountId }); return null }
  const instanceId = await defaultInstanceId(conn.tenantId)
  if (!instanceId) { log("skip", { reason: "no-instance", tenantId: conn.tenantId }); return null }
  const contact = await resolveOrCreateContact(conn.tenantId, { instagram: fromIgsid }, { primaryChannel: "instagram", source: "instagram" })
  await maybeEnrich(conn.token, fromIgsid, contact.id, contact.created)
  const conv = await getOrCreateIgConversation(conn.tenantId, contact.id, instanceId)
  return { tenantId: conn.tenantId, convId: conv.id, token: conn.token }
}

/** Bump da conversa pós-inbound (abre janela 24h + sobe no inbox). */
async function bumpConv(convId: string, preview: string): Promise<void> {
  const { data: cc } = await supabaseAdmin.from("chat_conversations").select("unread_count, status").eq("id", convId).single()
  const wasResolved = (cc?.status as string) === "resolved"
  const now = new Date().toISOString()
  await supabaseAdmin.from("chat_conversations").update({
    last_message_at: now, last_inbound_at: now, last_message_preview: preview, last_message_dir: "in",
    unread_count: ((cc?.unread_count as number) ?? 0) + 1, status: wasResolved ? "open" : (cc?.status as string), updated_at: now,
    ...(wasResolved ? { resolved_at: null } : {}),
  }).eq("id", convId)
}

/** Preview da mensagem citada (resolve pelo mid já gravado) — paridade c/ meta-inbound. */
async function resolveQuotedPreview(tenantId: string, quotedMid: string): Promise<{ preview: string; kind: string } | null> {
  const { data } = await supabaseAdmin.from("chat_messages").select("content, content_type").eq("tenant_id", tenantId).eq("whatsapp_msg_id", quotedMid).maybeSingle()
  if (!data) return null
  const kind = (data.content_type as string) ?? "text"
  const preview = ((data.content as string)?.trim()) || PREVIEW_LABEL[kind] || "Mensagem"
  return { preview: preview.slice(0, 200), kind }
}

// ── Decoder: webhook → shape canônico do inbox ───────────────────
interface IgDecoded {
  contentType: string
  content:     string | null
  metadata:    Record<string, unknown>
  routableText: string | null
  attachment?: { url: string; kind: string } | null
  unsendMid?:  string | null    // is_deleted → marca a mensagem existente como apagada
}

function extractIgContent(m: IgMessaging): IgDecoded {
  const meta: Record<string, unknown> = { channel: "instagram" }
  if (m.referral) meta.ig_referral = { ref: m.referral.ref ?? null, source: m.referral.source ?? null, type: m.referral.type ?? null }

  // Postback (tap em ice-breaker / menu persistente / botão) — não tem `message`.
  if (m.postback) {
    meta.interactive_kind = "postback"; meta.interactive_id = m.postback.payload ?? null
    const t = m.postback.title ?? null
    return { contentType: "interactive", content: t, metadata: meta, routableText: t }
  }

  const msg = m.message
  if (!msg) return { contentType: "unsupported", content: "[evento sem mensagem]", metadata: { ...meta, unsupported_type: "unknown" }, routableText: null }

  // Unsend (cliente apagou a mensagem).
  if (msg.is_deleted) return { contentType: "deleted", content: null, metadata: meta, routableText: null, unsendMid: msg.mid ?? null }

  // Tap em quick-reply (botão que enviamos).
  if (msg.quick_reply?.payload) {
    meta.interactive_kind = "quick_reply"; meta.interactive_id = msg.quick_reply.payload
    const t = msg.text ?? null
    return { contentType: "interactive", content: t, metadata: meta, routableText: t }
  }

  // Contexto: resposta a uma mensagem (quoted) ou a um STORY nosso.
  if (msg.reply_to?.story)    meta.ig_story_reply = { id: msg.reply_to.story.id ?? null, url: msg.reply_to.story.url ?? null }
  else if (msg.reply_to?.mid) meta.quoted = { msg_id: msg.reply_to.mid, participant: null, kind: null, preview: null }

  const att = msg.attachments?.[0]
  if (att?.type) {
    meta.ig_attachment_type = att.type
    // Share de post/reel/story — a doc da Meta usa ig_post/ig_reel/ig_story (NÃO "share").
    if (att.type === "ig_post" || att.type === "ig_reel" || att.type === "ig_story" || att.type === "share") {
      meta.ig_share_url  = att.payload?.url ?? null
      meta.ig_share_kind = att.type
      const t = msg.text?.trim() || null
      const label = att.type === "ig_reel" ? "🎬 Compartilhou um reel" : att.type === "ig_story" ? "📖 Compartilhou um story" : "🔗 Compartilhou um post"
      return { contentType: "text", content: t || label, metadata: meta, routableText: t }
    }
    if (att.type === "story_mention") {
      meta.ig_story = "mention"
      return { contentType: "image", content: msg.text?.trim() || null, metadata: meta, routableText: null, attachment: att.payload?.url ? { url: att.payload.url, kind: "image" } : null }
    }
    const kind = attachmentKind(att.type)
    return { contentType: kind, content: msg.text?.trim() || null, metadata: meta, routableText: msg.text?.trim() ?? null, attachment: att.payload?.url ? { url: att.payload.url, kind } : null }
  }

  const t = msg.text ?? null
  return { contentType: "text", content: t, metadata: meta, routableText: t }
}

// ── Handlers ─────────────────────────────────────────────────────
async function handleDm(igAccountId: string | null, m: IgMessaging): Promise<void> {
  const fromIgsid = m.sender?.id ?? null
  if (!igAccountId || igAccountId === "0" || !fromIgsid) { log("dm-skip", { reason: "missing-id", igAccountId, fromIgsid }); return }

  const dec = extractIgContent(m)

  // Unsend: atualiza a mensagem existente pra "apagada" (não cria nova).
  if (dec.unsendMid) {
    const conn = await connectionFor(igAccountId)
    if (conn) await supabaseAdmin.from("chat_messages").update({ content_type: "deleted", content: null }).eq("tenant_id", conn.tenantId).eq("whatsapp_msg_id", dec.unsendMid)
    log("unsend", { igAccountId, mid: dec.unsendMid }); return
  }

  const mid = m.message?.mid ?? m.postback?.mid ?? null
  if (!mid) { log("dm-skip", { reason: "no-mid", igAccountId }); return }
  // Nada renderável (ex: like vazio) → ignora (senão vira bubble vazio).
  if (dec.contentType === "text" && !dec.content?.trim() && !dec.metadata.quoted && !dec.metadata.ig_story_reply) { log("dm-skip", { reason: "empty-message", mid }); return }

  const ctx = await resolveIgContext(igAccountId, fromIgsid)
  if (!ctx) return

  // Mídia → baixa pro bucket.
  let mediaUrl: string | null = null
  let mediaMime: string | null = null
  if (dec.attachment?.url) {
    const stored = await storeIgMedia(ctx.tenantId, ctx.convId, dec.attachment.url, dec.attachment.kind)
    if (stored) { mediaUrl = stored.mediaUrl; mediaMime = stored.mime; dec.metadata.storage_path = stored.storagePath }
    else        { dec.metadata.ig_attachment_url = dec.attachment.url }
  }
  // Quoted → resolve o preview da mensagem citada.
  const quoted = dec.metadata.quoted as { msg_id?: string } | undefined
  if (quoted?.msg_id) {
    const q = await resolveQuotedPreview(ctx.tenantId, quoted.msg_id)
    if (q) dec.metadata.quoted = { ...quoted, ...q }
  }

  let content = dec.content
  if (dec.attachment && !content && !mediaUrl) content = MEDIA_LABEL[(dec.metadata.ig_attachment_type as string) ?? ""] || "📎 Anexo"
  const preview = (content?.trim()?.slice(0, 100)) || MEDIA_LABEL[(dec.metadata.ig_attachment_type as string) ?? ""] || PREVIEW_LABEL[dec.contentType] || "Mensagem"

  const { error } = await supabaseAdmin.from("chat_messages").insert({
    conversation_id: ctx.convId, tenant_id: ctx.tenantId,
    sender_type: "contact", sender_id: null,
    content_type: dec.contentType, content,
    media_url: mediaUrl, media_mime_type: mediaMime,
    whatsapp_msg_id: mid, status: "delivered", is_private_note: false,
    metadata: { ...dec.metadata, ig_account_id: igAccountId },
  })
  if (error) { if (error.code !== "23505") log("dm-insert-err", { err: error.message }); return }

  await bumpConv(ctx.convId, preview)
  log("dm-ok", { tenantId: ctx.tenantId, convId: ctx.convId, kind: dec.contentType })
}

/** Reação (emoji numa mensagem) → message content_type='reaction' (UI sobrepõe no alvo). */
async function handleReaction(igAccountId: string | null, m: IgMessaging): Promise<void> {
  const fromIgsid = m.sender?.id ?? null
  if (!igAccountId || igAccountId === "0" || !fromIgsid || m.reaction?.action !== "react") return
  const ctx = await resolveIgContext(igAccountId, fromIgsid)
  if (!ctx) return
  const emoji = m.reaction.emoji || m.reaction.reaction || "❤️"
  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: ctx.convId, tenant_id: ctx.tenantId, sender_type: "contact", sender_id: null,
    content_type: "reaction", content: emoji, whatsapp_msg_id: null, status: "delivered", is_private_note: false,
    metadata: { channel: "instagram", reacted_to_id: m.reaction.mid ?? null, ig_account_id: igAccountId },
  })
  await bumpConv(ctx.convId, `Reagiu ${emoji}`)
  log("reaction", { convId: ctx.convId, emoji })
}

/** Read receipt → marca a nossa mensagem como lida (✓✓). */
async function handleRead(igAccountId: string | null, m: IgMessaging): Promise<void> {
  const mid = m.read?.mid
  if (!igAccountId || !mid) return
  const conn = await connectionFor(igAccountId)
  if (!conn) return
  await supabaseAdmin.from("chat_messages")
    .update({ status: "read", read_at: new Date().toISOString() })
    .eq("tenant_id", conn.tenantId).eq("whatsapp_msg_id", mid).eq("sender_type", "agent")
  log("read", { mid })
}

export async function processInstagramWebhook(body: unknown): Promise<void> {
  const wh = body as IgWebhook
  if (wh?.object !== "instagram") { log("skip", { reason: "object", object: wh?.object ?? null }); return }

  for (const entry of wh.entry ?? []) {
    const igAccountId = entry.id ?? null

    for (const m of entry.messaging ?? []) {
      log("raw-msg", { igAccountId, m })   // DEBUG TEMPORÁRIO: estrutura real do evento (remover após mapear)
      if (m.message?.is_echo) continue   // eco do nosso envio → não re-ingere
      if (m.reaction)              { await handleReaction(igAccountId, m).catch((e) => log("reaction-err", { err: (e as Error).message })); continue }
      if (m.read)                  { await handleRead(igAccountId, m).catch((e) => log("read-err", { err: (e as Error).message })); continue }
      if (m.message || m.postback) { await handleDm(igAccountId, m).catch((e) => log("dm-err", { err: (e as Error).message })); continue }
      log("messaging-skip", { igAccountId, keys: Object.keys(m) })
    }

    for (const ch of entry.changes ?? []) {
      log("raw-change", { igAccountId, field: ch.field ?? null, value: ch.value ?? null })   // DEBUG TEMPORÁRIO
      if (ch.field !== "comments") { log("change", { igAccountId, field: ch.field ?? null }); continue }
      const v = ch.value ?? {}
      const from = v.from as { id?: string; username?: string } | undefined
      log("comment", { igAccountId, commentId: (v.id as string) ?? null, fromIgsid: from?.id ?? null, username: from?.username ?? null, hasText: typeof v.text === "string" })
      // TODO F2: keyword → private reply (Send API recipient.comment_id) + fluxo no DM.
    }
  }
}
