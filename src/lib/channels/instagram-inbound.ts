import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveOrCreateContact } from "@/lib/contacts/identity"
import { createInboundConversation } from "@/lib/channels/inbound-conversation"
import { allowedFrom, statusPatch } from "@/lib/channels/message-status"
import { routeAutomationTurn } from "@/lib/ai-v2/dispatch"
import { decryptSecret } from "@/lib/crypto/secrets"
import { fetchIgProfile, sendIgPrivateReplyRaw, replyToIgComment } from "@/lib/instagram/api"
import { buildIgMessage } from "@/lib/instagram/rich-render"
import { sendIgReaction } from "@/lib/instagram/api"
import { hasModulePro } from "@/lib/modules"
import type { RichMessage } from "@/lib/ai-v2/flow/types"
import { saveContactAvatarFromUrl } from "@/lib/contacts/avatar"
import { claimIgAutomation } from "@/lib/instagram/automation-quota"

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

const MEDIA_LABEL: Record<string, string> = { image: "📷 Imagem", video: "📹 Vídeo", audio: "🎤 Áudio", file: "📎 Arquivo", share: "🔗 Compartilhado", story_mention: "📖 Menção no story", ig_post: "🔗 Compartilhou um post", ig_reel: "🎬 Compartilhou um reel", ig_story: "📖 Compartilhou um story" }
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
/** Conta IG conectada → conexão + tenant + token (decifrado). 1 conta = 1 tenant.
 *  `id` (a CONEXÃO) é o eixo do ledger e das regras de comentário — multi-conta de
 *  Instagram no mesmo tenant já cabe sem ambiguidade. */
async function connectionFor(igAccountId: string): Promise<{ id: string; tenantId: string; token: string | null } | null> {
  const { data } = await supabaseAdmin.from("channel_connections")
    .select("id, tenant_id, access_token").eq("channel", "instagram").eq("external_account_id", igAccountId).eq("status", "active").maybeSingle()
  if (!data) return null
  return { id: data.id as string, tenantId: data.tenant_id as string, token: decryptSecret(data.access_token as string | null) }
}

/** Enriquece o contato (nome/@/foto) via Graph API — precisa do token; senão placeholder. */
async function maybeEnrich(token: string | null, tenantId: string, igsid: string, contactId: string, created: boolean): Promise<void> {
  if (!token) {
    if (created) await supabaseAdmin.from("chat_contacts").update({ push_name: IG_PLACEHOLDER_NAME }).eq("id", contactId).is("push_name", null)
    return
  }
  let needName = created
  let needAvatar = created
  if (!created) {
    const { data } = await supabaseAdmin.from("chat_contacts").select("push_name, profile_pic_url").eq("id", contactId).single()
    const pn  = data?.push_name as string | null
    const pic = data?.profile_pic_url as string | null
    needName = !pn || pn === IG_PLACEHOLDER_NAME
    // Avatar precisa se: não tem, OU aponta pra URL crua de CDN (padrão antigo que
    // expira → 403). Contato já migrado (`/api/avatar/...`) não re-baixa. Auto-cura.
    needAvatar = !pic || pic.includes("cdninstagram.com") || pic.includes("fbcdn.net")
    if (!needName && !needAvatar) return
  }
  const prof = await fetchIgProfile(igsid, token)
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (needName && prof?.name)   patch.push_name   = prof.name
  if (prof?.username)           patch.ig_username = prof.username
  if (needName && !prof?.name && created) patch.push_name = IG_PLACEHOLDER_NAME
  await supabaseAdmin.from("chat_contacts").update(patch).eq("id", contactId)
  // Foto: baixa os bytes pro storage e serve por /api/avatar (a URL do CDN do IG expira).
  if (needAvatar) await saveContactAvatarFromUrl(tenantId, contactId, prof?.profilePic)
}

async function getOrCreateIgConversation(tenantId: string, contactId: string, instanceId: string | null): Promise<{ id: string; isNew: boolean }> {
  // Porta ÚNICA de recebimento — mesmo helper do WhatsApp/site. Resolve dedup/reopen
  // + nasce com pipeline/etapa do funil padrão (senão a conversa de IG ficava fora do
  // kanban de atendimento, que filtra por pipeline_id + etapa visível).
  const r = await createInboundConversation({ tenantId, contactId, instanceId, channel: "instagram" })
  return { id: r.id, isNew: r.isNew }
}

/** Resolve tenant + contato (identidade IG) + conversa de uma vez (fonte única). */
async function resolveIgContext(igAccountId: string, fromIgsid: string): Promise<{ tenantId: string; convId: string; token: string | null } | null> {
  const conn = await connectionFor(igAccountId)
  if (!conn) { log("skip", { reason: "no-connection", igAccountId }); return null }
  // instance_id é "emprestado" do WhatsApp por compatibilidade; tenant IG-first (sem
  // WhatsApp) cria o fio com null — o canal já discrimina (coalesce(instance,canal)).
  // ⚠️ NÃO empresta mais um número de WhatsApp. A conversa de Instagram nasce SEM número
  // (`instance_id = NULL`) porque ela não tem um — o `channel` já discrimina o fio.
  // O empréstimo causava: cascata de DELETE levando o histórico de IG junto com o número,
  // gate de visibilidade por número escondendo o canal inteiro de um atendente escopado,
  // selo mentindo "QR/Oficial" na conversa, e métrica de custo contando janela de 24h paga
  // onde template pago nem existe.
  const instanceId = null
  const contact = await resolveOrCreateContact(conn.tenantId, { instagram: fromIgsid }, { primaryChannel: "instagram", source: "instagram" })
  await maybeEnrich(conn.token, conn.tenantId, fromIgsid, contact.id, contact.created)
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
  // 🔴 `ig_story = "reply"` MARCA a resposta a um story NOSSO — e é o que distingue de
  //    `ig_story = "mention"` (a pessoa te marcou no story DELA). Os dois gravam
  //    `ig_story_reply` (o card do inbox usa a url dos dois), então sem esta marca o
  //    gatilho "respondeu ao seu story" dispararia também em menção — evento diferente,
  //    intenção diferente.
  if (msg.reply_to?.story) {
    meta.ig_story = "reply"
    meta.ig_story_reply = { id: msg.reply_to.story.id ?? null, url: msg.reply_to.story.url ?? null }
  }
  else if (msg.reply_to?.mid) meta.quoted = { msg_id: msg.reply_to.mid, participant: null, kind: null, preview: null }

  const att = msg.attachments?.[0]
  if (att?.type) {
    meta.ig_attachment_type = att.type
    // Share de post/reel/story — a doc da Meta usa ig_post/ig_reel/ig_story (NÃO "share").
    // Baixa a IMAGEM do post + marca como share (mostra a imagem + o contexto "compartilhou").
    if (att.type === "ig_post" || att.type === "ig_reel" || att.type === "ig_story" || att.type === "share") {
      meta.ig_share = att.type === "share" ? "ig_post" : att.type    // "share" legado → trata como post
      const t = msg.text?.trim() || null                            // só a legenda; o selo "Compartilhou…" vem do bubble
      if (att.payload?.url) {
        return { contentType: "image", content: t, metadata: meta, routableText: t, attachment: { url: att.payload.url, kind: "image" } }
      }
      return { contentType: "text", content: t, metadata: meta, routableText: t }
    }
    if (att.type === "story_mention") {
      // 🔴 REGRA DA META (docs/instagram-api/story-mention-and-moderation.md):
      // "You must not store or cache the media content on your server." Story é efêmero —
      // pode guardar a URL do CDN, NUNCA os bytes. Por isso NÃO devolvemos `attachment`
      // (que dispararia o download pro nosso bucket, como fazia antes).
      // A URL vai pro metadata e o StoryReplyCard renderiza direto do CDN no navegador do
      // atendente, com placeholder automático quando o story expira (onError).
      // contentType "text" de propósito: sem mídia nossa, "image" acenderia o ícone de
      // mídia órfão na bolha.
      meta.ig_story = "mention"
      if (att.payload?.url) meta.ig_story_reply = { url: att.payload.url, id: null }
      return { contentType: "text", content: msg.text?.trim() || null, metadata: meta, routableText: null, attachment: null }
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
  if (dec.contentType === "text" && !dec.content?.trim() && !dec.metadata.quoted && !dec.metadata.ig_story_reply && !dec.metadata.ig_share) { log("dm-skip", { reason: "empty-message", mid }); return }

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

  // 🔴 F0 — a chamada que faltava. Até 2026-07-28 o ingestor do Instagram gravava a
  // mensagem e PARAVA: `routeAutomationTurn` nunca era chamado, então nenhum fluxo do
  // Studio disparava no Direct. Espelha meta-inbound.ts (canal oficial).
  // A "boca" do canal vive em reply.ts (case "instagram"); sem ela isto lançaria.
  // ⚠️ `routableText: null` é sinal EXPLÍCITO de "não acorda a automação" (menção em
  // story, mídia sem legenda). Cair pro `content` anularia esse sinal — e pior: quando o
  // download da mídia falha, `content` vira o rótulo "📷 Imagem" e a IA responderia a ele.
  // ❤️ Curtir a resposta de story automaticamente (recurso PRO).
  if (dec.metadata.ig_story === "reply" && mid) {
    void maybeAutoReactStoryReply(ctx.tenantId, igAccountId, m.sender?.id ?? null, mid,
      (dec.metadata.ig_story_reply as { id?: string | null } | undefined)?.id ?? null,
      dec.routableText ?? "")
  }

  const routable = dec.routableText
  if (routable?.trim()) {
    try {
      // O motor exige uma instância (contrato do provider). O IG "empresta" a 1ª do
      // tenant, como já faz pra conversa. Tenant IG-first (sem WhatsApp) → sem instância
      // → pula o turno em vez de quebrar.
      const { data: inst } = await supabaseAdmin
        .from("whatsapp_instances").select("*")
        .eq("tenant_id", ctx.tenantId).order("created_at", { ascending: true }).limit(1).maybeSingle()
      if (!inst) { log("ai-skip", { reason: "no-instance", tenantId: ctx.tenantId }); return }

      await routeAutomationTurn({
        tenantId:       ctx.tenantId,
        conversationId: ctx.convId,
        incomingText:   routable,
        // Sinal do INBOUND: a mesma conversa mistura resposta de story com mensagem
        // normal, então isto não pode sair de coluna da conversa.
        signals: {
          isStoryReply: dec.metadata.ig_story === "reply",
          storyId:      (dec.metadata.ig_story_reply as { id?: string | null } | undefined)?.id ?? null,
        },
        instance:       inst as Parameters<typeof routeAutomationTurn>[0]["instance"],
      })
    } catch (e) {
      log("ai-err", { convId: ctx.convId, err: (e as Error).message })
    }
  }
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
  // `read_at` só passou a existir na migration 20260728 — antes disso o PostgREST
  // recusava este UPDATE inteiro e o ✓✓ do Instagram nunca acendia (falha calada).
  const { error } = await supabaseAdmin.from("chat_messages")
    .update(statusPatch("read"))
    // "bot" junto: desde que o Studio responde no Direct, a maioria das mensagens do
    // negócio é do bot — só `agent` deixaria o ✓✓ cobrindo o que o humano mandou.
    .eq("tenant_id", conn.tenantId).eq("whatsapp_msg_id", mid).in("sender_type", ["agent", "bot"])
    .in("status", allowedFrom("read"))
  if (error) console.error("[ig-status] update chat_messages:", error.code, error.message)
  log("read", { mid })
}

// ═══════════════════════════════════════════════════════════════
// Comentário → Direct (comment-to-DM) — automação PREMIUM do Instagram
// ═══════════════════════════════════════════════════════════════
// docs/instagram-studio-node-design.md §8.3 · docs/instagram-modulo-e-limites.md §4.1
//
// 🔴 A private reply NÃO é (e não pode ser) um passo do fluxo. O IGSID só existe DEPOIS
//    dela — vem no `recipient_id` da resposta da Meta —, então antes não há contato nem
//    conversa, e o motor de fluxo exige `conversationId`. Pior: pela regra da Meta, DEPOIS
//    da private reply o app não pode enviar mais nada até a pessoa responder; um fluxo que
//    começasse no comentário quebraria no segundo nó.
//
//    O runtime certo é **carimba-e-espera**, e ele já roda em produção nas campanhas
//    (`recordCampaignOpener` fixa `metadata.campaign_engage`; `run.ts` consome no 1º reply
//    e retoma o fluxo). Aqui é linha por linha o mesmo formato: manda o Direct FORA do
//    fluxo → cria contato/conversa → persiste a mensagem → carimba `ig_comment_engage`.
//    O run.ts retoma quando a pessoa responder. Não inventar um segundo motor.
//
// ✅ ATIVO desde 2026-07-30 — mas só chega comentário de conta que TEM a permissão
//    `instagram_business_manage_comments` (hoje: a conta de teste do dono; a Meta ainda
//    não aprovou pra geral). `subscribeIgWebhooks` tenta com `comments` e cai de volta
//    pros campos base quando a conta não tem — nenhuma conta perde messaging por isso.
//    ⚠️ Chegar o webhook NÃO basta pra disparar: a licença `instagram_automation` é
//    checada aqui dentro (claimIgAutomation → outcome 'module'), e hoje ZERO tenants a
//    têm. São dois gates independentes; nenhum cliente executa automação sem os dois.

const IG_COMMENT_KIND    = "comment_dm"
/** Prazo da Meta pra private reply: 7 dias do comentário (em Live, só durante). */
const IG_PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** `changes[].value` do campo `comments`. ⚠️ `text` é lido pra CASAR a palavra-chave e
 *  descartado em seguida — nunca persistido (I6: PII de terceiro que sequer é cliente). */
interface IgCommentValue {
  id?:           string
  from?:         { id?: string; username?: string }
  media?:        { id?: string; media_product_type?: string; ad_id?: string }
  parent_id?:    string
  verb?:         string
  text?:         string
  created_time?: number | string
}

/** Regra derivada do fluxo (studio_flows.trigger type='ig_comment') pelo editor —
 *  PROJEÇÃO reescrita a cada save/publish (src/lib/actions/studio/flows.ts). */
interface IgCommentRule {
  id:            string
  flow_id:       string
  /** Posts alvo congelados (1–3). Vazio/null = qualquer post. */
  media_ids:     string[] | null
  keywords:      string[] | null
  keyword_match: string | null
  reply_text:    string
  /** Direct RICO (texto · imagem · botões). `null` = usa `reply_text` (fluxo antigo). */
  reply_rich:    RichMessage | null
  public_reply:  string[] | null
}

/**
 * ❤️ Curte a resposta de story, quando algum fluxo pediu E o tenant tem PRO.
 *
 * 🔴 **A LICENÇA É CHECADA AQUI, NO ENVIO** — não na hora de salvar o fluxo. Downgrade de
 *    plano precisa parar de curtir mesmo com `autoReact: true` gravado num fluxo publicado
 *    meses atrás. Config no jsonb é intenção; permissão é `hasModulePro`, sempre ao vivo.
 *
 * ⚠️ Best-effort e fora do caminho crítico (`void`): falhar em curtir não pode atrasar nem
 *    derrubar a ingestão da mensagem. Mas o erro é LOGADO — silêncio é o que se evita.
 *
 * Consulta enxuta de propósito: se QUALQUER fluxo publicado+ativo de resposta a story pede
 * o curtir, curte. Reexecutar o matcher inteiro aqui duplicaria a regra de casamento — e
 * regra duplicada diverge (a lição do dia).
 */
async function maybeAutoReactStoryReply(
  tenantId: string, igAccountId: string | null, senderIgsid: string | null, messageId: string,
  storyId: string | null, text: string,
): Promise<void> {
  try {
    if (!igAccountId || !senderIgsid) return
    if (!(await hasModulePro(tenantId, "instagram_automation"))) return

    const { data } = await supabaseAdmin.from("studio_flows")
      .select("trigger")
      .eq("tenant_id", tenantId).eq("status", "published").eq("active", true)
    // ⚠️ RESPEITA O RECORTE da tela (QA 2026-08-01). Antes bastava "algum fluxo pede
    //    curtir" — então um fluxo mirado no story X curtia resposta ao story Y, e curtia
    //    resposta que reprovaria no filtro de palavra. O ❤️ mora DENTRO da configuração de
    //    story/palavra no modal; a tela prometia um recorte mais estreito que o código.
    const quer = (data ?? []).some((f) => {
      const t = f.trigger as { type?: string; story?: { autoReact?: boolean; storyIds?: string[]; keywords?: string[]; keywordMatch?: string } } | null
      if (t?.type !== "ig_story_reply" || t.story?.autoReact !== true) return false
      const cfg = t.story
      if (cfg.storyIds?.length && (!storyId || !cfg.storyIds.includes(storyId))) return false
      if (cfg.keywords?.length) {
        const alvo = normComment(text)
        const bate = cfg.keywords.some((k) => {
          const n = normComment(k)
          return cfg.keywordMatch === "exact"
            ? new RegExp(`(^|\W)${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\W|$)`).test(alvo)
            : alvo.includes(n)
        })
        if (!bate) return false
      }
      return true
    })
    if (!quer) return

    const conn = await connectionFor(igAccountId)
    if (!conn?.token) return
    const r = await sendIgReaction(conn.token, igAccountId, senderIgsid, messageId)
    log("story-react", "error" in r ? { ok: false, err: r.error } : { ok: true })
  } catch (e) {
    log("story-react-err", { err: (e as Error).message })
  }
}

/** Normaliza p/ comparação PT-BR: minúsculas + sem acento (olá → ola). Mesma régua do
 *  matcher de gatilho do Studio (ai-v2/flow/triggers.ts) — o cliente vê um campo só. */
function normComment(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
}

function ruleMatchesKeywords(rule: IgCommentRule, text: string): boolean {
  const kws = (rule.keywords ?? []).map((k) => normComment((k ?? "").trim())).filter(Boolean)
  if (!kws.length) return true                       // sem palavra = qualquer comentário
  const hay = normComment(text)
  if (rule.keyword_match === "exact") {
    const tokens = new Set(hay.split(/[^\p{L}\p{N}]+/u).filter(Boolean))
    return kws.some((k) => tokens.has(k))
  }
  return kws.some((k) => hay.includes(k))
}

/**
 * Regra vencedora: a que MIRA este post ganha da genérica ("qualquer post").
 * Empate entre duas que miram o mesmo post → a MAIS ANTIGA (mesma régua do
 * `findFlowToStart`). O desempate importa: o cliente clona um fluxo pra testar um DM
 * novo e passa a ter duas regras casando a mesma palavra no mesmo post. Sem ordem
 * estável, QUAL direct sai depende da ordem física das linhas no Postgres — que muda
 * depois de um UPDATE/VACUUM. Mesma entrada, resultado diferente em dias diferentes,
 * sem nada no log que explique.
 */
function pickCommentRule(rules: IgCommentRule[], mediaId: string | null, text: string): IgCommentRule | null {
  const matched = rules.filter((r) => ruleMatchesKeywords(r, text))
  const targets = (r: IgCommentRule) => (r.media_ids ?? []).filter(Boolean)
  const winner = matched.find((r) => !!mediaId && targets(r).includes(mediaId))
             ?? matched.find((r) => targets(r).length === 0)
             ?? null
  // Diagnóstico do empate: sem isto, "por que rodou o fluxo errado?" é indepurável.
  if (winner && matched.length > 1) {
    log("comment-rule-ambiguous", { chosen: winner.id, candidates: matched.map((r) => r.id), mediaId })
  }
  return winner
}

/** Teto de regras carregadas. Acima do maior plano (`automations: 150`) de propósito —
 *  o corte silencioso era o mesmo defeito do 1000 do PostgREST: resultado parcial, zero erro. */
const IG_RULES_CAP = 500

async function loadCommentRules(connectionId: string): Promise<IgCommentRule[]> {
  const { data, error } = await supabaseAdmin
    .from("instagram_comment_rules")
    .select("id, flow_id, media_ids, keywords, keyword_match, reply_text, reply_rich, public_reply")
    .eq("connection_id", connectionId)
    .eq("enabled", true)
    .order("created_at", { ascending: true })     // desempate ESTÁVEL (ver pickCommentRule)
    .order("id",         { ascending: true })     // created_at idêntico (upsert em lote)
    .limit(IG_RULES_CAP)
  if (error) { log("comment-rules-err", { connectionId, err: error.message }); return [] }
  const rows = (data ?? []) as unknown as IgCommentRule[]
  if (rows.length === IG_RULES_CAP) log("comment-rules-capped", { connectionId, cap: IG_RULES_CAP })
  return rows
}

/** Variação da resposta pública (o IG pode esconder respostas repetidas idênticas). */
function pickPublicReply(variants: string[] | null): string | null {
  const list = (variants ?? []).map((v) => (v ?? "").trim()).filter(Boolean)
  if (!list.length) return null
  return list[Math.floor(Math.random() * list.length)]
}

/**
 * Momento do comentário NA META (o prazo de 7 dias da private reply conta daqui).
 *
 * ⚠️ `known: false` quando o payload NÃO traz `created_time` — que é o caso normal do
 * webhook `comments` do Instagram (ele manda id/from/media/parent_id/text e mais nada).
 * O fallback `entry.time` é o instante da ENTREGA do webhook, ou seja "agora": usá-lo pra
 * decidir idade transformava o guard num teste que nunca reprova, e ainda mentia na
 * direção perigosa (comentário antigo reentregue pela Meta passava, gastava a bala e
 * voltava recusado). Com `known: false` a decisão é da Meta — e o `failed` resultante
 * não consome cota.
 */
function commentTimeMs(c: IgCommentValue, entryTimeSec: number | null): { ms: number | null; known: boolean } {
  const raw = c.created_time
  if (typeof raw === "number" && Number.isFinite(raw)) return { ms: raw > 1e12 ? raw : raw * 1000, known: true }
  if (typeof raw === "string") { const p = Date.parse(raw); if (!Number.isNaN(p)) return { ms: p, known: true } }
  if (typeof entryTimeSec === "number" && Number.isFinite(entryTimeSec)) {
    return { ms: entryTimeSec > 1e12 ? entryTimeSec : entryTimeSec * 1000, known: false }
  }
  return { ms: null, known: false }
}

/** Patch do run — allow-list explícita (nunca objeto vindo de fora). */
interface RunPatch {
  status?:          "claimed" | "sent" | "failed" | "skipped" | "replied"
  error?:           string | null
  contact_id?:      string | null
  conversation_id?: string | null
  from_igsid?:      string | null
}
/**
 * 🔴 SÓ SAI DE `claimed` (forward-only, mesma disciplina de `allowedFrom` em
 * channels/message-status.ts). As TRÊS chamadas desta função partem de `claimed` — é o
 * estado em que o claim atômico cria a linha.
 * Sem a guarda existe uma corrida real: o cron reconcilia um claim órfão pra `failed`
 * (devolvendo a cota) e um processo lento, que só agora terminou, sobrescreve pra `sent`
 * — a linha volta a ser cobrável e a cota do cliente é consumida duas vezes pelo mesmo
 * comentário. Com timeout de 10s contra os 15min do cron isso é quase inalcançável;
 * "quase" não é uma garantia que sirva pra faturamento.
 */
async function updateAutomationRun(runId: string, patch: RunPatch): Promise<void> {
  const { error } = await supabaseAdmin.from("instagram_automation_runs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", runId).eq("status", "claimed")
  if (error) log("comment-run-update-err", { runId, err: error.message })
}

/**
 * I5 — nome do contato SEM chamar a API de perfil. Quem só comentou não tem perfil
 * acessível (regra de consentimento da Meta: o `GET /<IGSID>` responde ERRO, não vazio),
 * então `fetchIgProfile`/`maybeEnrich` estão FORA deste caminho de propósito. O `@` que
 * vem no próprio webhook É o nome — e some sozinho no primeiro reply, quando o
 * `maybeEnrich` do handleDm passa a ter permissão e busca nome/foto de verdade.
 */
async function seedCommentContact(tenantId: string, contactId: string, username: string | null): Promise<void> {
  if (!username) return
  const { error } = await supabaseAdmin.from("chat_contacts")
    .update({ ig_username: username, updated_at: new Date().toISOString() })
    .eq("id", contactId).eq("tenant_id", tenantId)
  if (error) log("comment-contact-err", { contactId, err: error.message })
  // Nome só quando ainda NÃO há: sobrescrever apagaria o nome real de quem já conversou.
  const { error: nameErr } = await supabaseAdmin.from("chat_contacts")
    .update({ push_name: `@${username}` })
    .eq("id", contactId).eq("tenant_id", tenantId).is("push_name", null)
  if (nameErr) log("comment-contact-name-err", { contactId, err: nameErr.message })
}

/**
 * Persiste o Direct na conversa (aparece no inbox) + fixa o CARIMBO de engajamento.
 * Espelho literal de `recordCampaignOpener` (campaigns/engine.ts) — o padrão
 * carimba-e-espera que o run.ts já sabe consumir.
 *
 * 🔴 O CARIMBO É A PEÇA QUE FAZ O FLUXO RODAR — não o ledger. Se ele não gravar, a DM
 *    saiu, a cota queimou e o fluxo NUNCA roda (a pessoa responde e cai como mensagem
 *    solta no inbox). Por isso o retorno é honesto: `false` faz o chamador marcar o run
 *    como falho em vez de `sent`, senão o ledger certifica um sucesso que não houve.
 *
 * 🔴 CONVERSA EM ATENDIMENTO HUMANO NÃO É SEQUESTRADA. Cliente antigo, conversa aberta
 *    com uma atendente, comenta num post de promoção: a private reply cai na MESMA thread
 *    (isso é a Meta, não temos escolha) — mas o carimbo, não. Sem esse corte, o fluxo
 *    atropelaria o atendimento em curso, ou ficaria pendurado até 7 dias e dispararia
 *    fora de contexto quando a conversa fosse liberada.
 */
async function recordCommentOpener(args: {
  tenantId: string; convId: string; igAccountId: string; text: string
  messageId: string | null; flowId: string; runId: string
}): Promise<boolean> {
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin.from("chat_messages").insert({
    conversation_id: args.convId, tenant_id: args.tenantId,
    sender_type: "bot", sender_id: null,
    content_type: "text", content: args.text,
    status: "sent", whatsapp_msg_id: args.messageId || null, is_private_note: false,
    metadata: { channel: "instagram", ig_account_id: args.igAccountId, ig_comment_dm: true, automation_run_id: args.runId },
  })
  if (error) { log("comment-msg-err", { convId: args.convId, err: error.message }); return false }

  const { data: cRow, error: readErr } = await supabaseAdmin.from("chat_conversations")
    .select("metadata, assigned_to").eq("id", args.convId).eq("tenant_id", args.tenantId).maybeSingle()
  if (readErr) { log("comment-conv-read-err", { convId: args.convId, err: readErr.message }); return false }
  const row  = cRow as { metadata?: Record<string, unknown>; assigned_to?: string | null } | null
  const meta = row?.metadata ?? {}

  const humanOwned = !!row?.assigned_to
  const patch: Record<string, unknown> = {
    last_message_at: now, last_message_preview: args.text.slice(0, 100), last_message_dir: "out", updated_at: now,
    // ⚠️ `unread_count` e `last_inbound_at` intocados: isto é SAÍDA nossa, não mensagem
    // do cliente — bolinha de não-lida aqui seria mentira e a janela de 24h não abriu.
  }
  if (!humanOwned) {
    patch.metadata = { ...meta, ig_comment_engage: { flowId: args.flowId, runId: args.runId, at: now } }
  }

  const { error: upErr } = await supabaseAdmin.from("chat_conversations").update(patch)
    .eq("id", args.convId).eq("tenant_id", args.tenantId)
  if (upErr) { log("comment-conv-err", { convId: args.convId, err: upErr.message }); return false }

  if (humanOwned) log("comment-no-stamp", { convId: args.convId, reason: "human-assigned" })
  return true
}

/** Webhook `comments` → private reply → resposta pública → contato → conversa → carimbo. */
async function handleComment(igAccountId: string | null, value: Record<string, unknown>, entryTimeSec: number | null): Promise<void> {
  const c         = value as IgCommentValue
  const commentId = typeof c.id === "string" ? c.id : null
  const fromId    = c.from?.id ?? null
  const username  = c.from?.username ?? null
  const mediaId   = typeof c.media?.id === "string" ? c.media.id : null

  if (!igAccountId || igAccountId === "0" || !commentId || !fromId) { log("comment-skip", { reason: "missing-id", igAccountId }); return }
  // (a) AUTO-COMENTÁRIO: sem isto, o dono responde "obrigado!" no próprio post e a conta
  //     manda DM pra si mesma — e ainda queima uma automação da cota.
  if (fromId === igAccountId) { log("comment-skip", { reason: "self-comment", commentId }); return }
  // (b) Só CRIAÇÃO. Edição/remoção não é gatilho (ausente = criação, formato do IG).
  if (c.verb && c.verb !== "add") { log("comment-skip", { reason: `verb:${c.verb}`, commentId }); return }
  // (c) 7 DIAS: fora da janela a Meta recusa. Só corta quando a idade é CONHECIDA —
  //     `entry.time` é o instante da entrega ("agora") e reprovaria zero comentários.
  const occurred = commentTimeMs(c, entryTimeSec)
  if (occurred.known && occurred.ms && Date.now() - occurred.ms > IG_PRIVATE_REPLY_WINDOW_MS) {
    log("comment-skip", { reason: "too-old", commentId }); return
  }

  const conn = await connectionFor(igAccountId)
  if (!conn)       { log("comment-skip", { reason: "no-connection", igAccountId }); return }
  if (!conn.token) { log("comment-skip", { reason: "no-token", igAccountId }); return }

  const rules = await loadCommentRules(conn.id)
  // ⚠️ `text` entra SÓ aqui (casar a palavra) e morre neste escopo — nunca vai pro banco
  //    nem pro log (I6).
  const rule  = pickCommentRule(rules, mediaId, typeof c.text === "string" ? c.text : "")
  if (!rule) { log("comment-skip", { reason: "no-rule", commentId, hasRules: rules.length > 0 }); return }
  // Vazio = nada a enviar. Rico com imagem e sem texto É válido (vai a imagem sozinha).
  const richDm = rule.reply_rich ?? null
  const hasDm  = richDm ? !!(richDm.text?.trim() || richDm.media?.path) : !!rule.reply_text?.trim()
  if (!hasDm) { log("comment-skip", { reason: "empty-dm", ruleId: rule.id }); return }

  // ── LICENÇA + COTA + CLAIM, ATÔMICO (fail-closed) ───────────────────────────
  // Aqui, e não antes: só consulta (e só notifica em 80%/estouro) quando a captura de
  // fato ACONTECERIA — comentário que não casa regra nenhuma não pode disparar aviso de
  // cota. Checar e reservar são UM comando (pg_advisory_xact_lock por tenant): contar no
  // app e inserir depois é TOCTOU, e num post viral 40 handlers leem "49 de 50" e passam.
  // Bloquear = parar de CAPTURAR comentário novo; quem já respondeu segue sendo atendido
  // normalmente (a conversa em andamento não passa por aqui).
  const claim = await claimIgAutomation({
    tenantId: conn.tenantId, connectionId: conn.id, kind: IG_COMMENT_KIND, sourceId: commentId,
    ruleId: rule.id, flowId: rule.flow_id, mediaId, fromUsername: username,
    occurredAt: occurred.ms ? new Date(occurred.ms).toISOString() : new Date().toISOString(),
  })
  const runId = claim.runId
  if (claim.outcome !== "claimed" || !runId) {
    // 'duplicate' e 'person' são funcionamento saudável, não incidente.
    log("comment-skip", { reason: claim.outcome, commentId, tenantId: conn.tenantId, used: claim.used, limit: claim.limit })
    return
  }

  // 1) O DIRECT — a bala única. Sai ANTES da resposta pública: se a pública falhar, o
  //    Direct já está entregue; o inverso desperdiçaria a única chance.
  // 🔴 Montagem do formato rico ANTES do envio, e com QUEDA PRA TEXTO se falhar. Motivo:
  //    a bala é única. Se a imagem sumiu do bucket ou a Meta recusou o upload do anexo,
  //    mandar o texto puro entrega ALGO — abortar entregaria nada e queimaria o comentário
  //    do mesmo jeito (o dedup por comment_id não deixa tentar de novo).
  let payload: Record<string, unknown> = { text: rule.reply_text }
  if (richDm) {
    const built = await buildIgMessage(richDm, {
      token: conn.token, igAccountId, origin: process.env.AUTH_URL ?? process.env.NEXTAUTH_URL,
    })
    if ("error" in built) {
      log("comment-rich-fallback", { ruleId: rule.id, err: built.error })
      if (!rule.reply_text?.trim()) {
        await updateAutomationRun(runId, { status: "failed", error: `direct rico inválido: ${built.error}`.slice(0, 300) })
        return
      }
    } else {
      payload = built.message
    }
  }

  const pr = await sendIgPrivateReplyRaw(conn.token, igAccountId, commentId, payload)
  if ("error" in pr) {
    // `failed` NÃO consome cota (o contador filtra por status) — token expirado ou 429 da
    // Meta não podem zerar o mês do cliente sem ter entregue uma direct sequer.
    await updateAutomationRun(runId, { status: "failed", error: pr.error.slice(0, 300) })
    log("comment-dm-err", { commentId, err: pr.error })
    return
  }

  // 🔴 DAQUI PRA BAIXO A DM JÁ ESTÁ ENTREGUE e é irrecuperável (a Meta permite UMA private
  //    reply por comentário, e o `uq_ig_runs_dedup` já reservou este comment_id — não há
  //    reprocessamento possível). `resolveOrCreateContact` e `createInboundConversation`
  //    LANÇAM; sem este try/catch a exceção subia pro catch do webhook, o run ficava
  //    `claimed` pra sempre e o lead sumia: a pessoa recebia o direct, respondia, e caía
  //    no inbox sem carimbo — o fluxo nunca rodava e o relatório não denunciava nada.
  try {
    // 2) Identidade: o IGSID vem no `recipient_id` da resposta da Meta — é o ÚNICO jeito
    //    de descobrir quem é a pessoa nesta etapa.
    const contact = await resolveOrCreateContact(
      conn.tenantId, { instagram: pr.recipientId }, { primaryChannel: "instagram", source: "instagram" },
    )
    await seedCommentContact(conn.tenantId, contact.id, username)

    // 3) Conversa (porta única — dedup/reopen + etapa do funil) e o CARIMBO, que é o que
    //    de fato faz o fluxo rodar quando a pessoa responder.
    //    instance_id null: conversa de Instagram não tem número (o canal já discrimina).
    const conv = await createInboundConversation({ tenantId: conn.tenantId, contactId: contact.id, instanceId: null, channel: "instagram" })
    const stamped = await recordCommentOpener({
      tenantId: conn.tenantId, convId: conv.id, igAccountId,
      // Carimbo do inbox mostra o TEXTO do direct — o do rico quando houver.
      text: (richDm?.text ?? rule.reply_text) || "", messageId: pr.messageId || null, flowId: rule.flow_id, runId,
    })

    // A DM saiu: a automação FOI executada e é cobrável, mesmo que o carimbo tenha falhado.
    // O `error` preserva a pista — sem ele o ledger certificaria um sucesso que não houve.
    await updateAutomationRun(runId, {
      status: "sent", contact_id: contact.id, conversation_id: conv.id, from_igsid: pr.recipientId,
      error: stamped ? null : "post_send: carimbo não gravado — o fluxo não vai disparar na resposta",
    })
    log("comment-ok", { tenantId: conn.tenantId, convId: conv.id, runId, ruleId: rule.id, stamped })
  } catch (e) {
    await updateAutomationRun(runId, { status: "sent", from_igsid: pr.recipientId, error: `post_send: ${(e as Error).message}`.slice(0, 300) })
    log("comment-post-send-err", { commentId, runId, err: (e as Error).message })
  }

  // 4) Resposta pública (best-effort) — é o que avisa quem NÃO segue a abrir a aba
  //    "Solicitações", onde a private reply cai pra ele. Por último de propósito: é a
  //    etapa menos importante e não pode atrasar nem derrubar o carimbo.
  const publicText = pickPublicReply(rule.public_reply)
  if (publicText) {
    const rr = await replyToIgComment(conn.token, commentId, publicText)
    if ("error" in rr) log("comment-public-err", { commentId, err: rr.error })
  }
}

export async function processInstagramWebhook(body: unknown): Promise<void> {
  const wh = body as IgWebhook
  if (wh?.object !== "instagram") { log("skip", { reason: "object", object: wh?.object ?? null }); return }

  for (const entry of wh.entry ?? []) {
    const igAccountId = entry.id ?? null

    for (const m of entry.messaging ?? []) {
      // Diagnóstico SEM PII: só a FORMA do evento (nunca texto/mídia do cliente).
      log("msg-shape", { igAccountId, keys: Object.keys(m), att: m.message?.attachments?.[0]?.type ?? null, hasText: !!m.message?.text })
      if (m.message?.is_echo) continue   // eco do nosso envio → não re-ingere
      if (m.reaction)              { await handleReaction(igAccountId, m).catch((e) => log("reaction-err", { err: (e as Error).message })); continue }
      if (m.read)                  { await handleRead(igAccountId, m).catch((e) => log("read-err", { err: (e as Error).message })); continue }
      if (m.message || m.postback) { await handleDm(igAccountId, m).catch((e) => log("dm-err", { err: (e as Error).message })); continue }
      log("messaging-skip", { igAccountId, keys: Object.keys(m) })
    }

    for (const ch of entry.changes ?? []) {
      // Idem: forma do change, sem o `value` (carrega texto do comentário = PII).
      log("change-shape", { igAccountId, field: ch.field ?? null, valueKeys: Object.keys(ch.value ?? {}) })
      // ⚠️ SÓ `comments`. `live_comments` é caminho SEPARATO de propósito: o volume
      // explode durante a transmissão e a janela é só enquanto a live está no ar.
      if (ch.field !== "comments") { log("change", { igAccountId, field: ch.field ?? null }); continue }
      const v = ch.value ?? {}
      const from = v.from as { id?: string; username?: string } | undefined
      log("comment", { igAccountId, commentId: (v.id as string) ?? null, fromIgsid: from?.id ?? null, username: from?.username ?? null, hasText: typeof v.text === "string" })
      await handleComment(igAccountId, v, entry.time ?? null).catch((e) => log("comment-err", { err: (e as Error).message }))
    }
  }
}
