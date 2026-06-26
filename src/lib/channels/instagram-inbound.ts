import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveOrCreateContact } from "@/lib/contacts/identity"
import { findOrReopenConversation } from "@/lib/conversation-dedup"
import { decryptSecret } from "@/lib/crypto/secrets"
import { fetchIgProfile } from "@/lib/instagram/api"

const IG_PLACEHOLDER_NAME = "Usuário do Instagram"

/**
 * Ingestão do Instagram Direct (caminho "API do Instagram com login do Instagram")
 * — ISOLADA do meta-inbound (WhatsApp). F1: DM → contato (identidade IGSID via
 * `primary_channel='instagram'`) → conversa `channel='instagram'` → mensagem no
 * inbox. Roteia o tenant por `channel_connections` (id da conta IG → tenant).
 * Comentário (comment-to-DM / private reply) = F2. Doc: docs/instagram-direct-design.md.
 *
 * Nome real do contato = enriquecido via Graph API depois (F1.1); por ora placeholder.
 * `instance_id` é NOT NULL no schema → usa a instância WhatsApp default do tenant como
 * placeholder (igual o canal `site`); NÃO é usada pra enviar no IG (isso é o token da conexão).
 */

type IgAttachment = { type?: string; payload?: { url?: string } }
type IgMessaging = {
  sender?:    { id?: string }            // IGSID de quem mandou
  recipient?: { id?: string }            // id da conta conectada
  timestamp?: number
  message?:   { mid?: string; text?: string; is_echo?: boolean; attachments?: IgAttachment[] }
}

const MEDIA_LABEL: Record<string, string> = { image: "📷 Imagem", video: "📹 Vídeo", audio: "🎤 Áudio", file: "📎 Arquivo", share: "🔗 Compartilhado", story_mention: "📖 Menção no story" }
function attachmentKind(type?: string): string {
  return type === "image" ? "image" : type === "video" ? "video" : type === "audio" ? "audio" : "document"
}
type IgChange  = { field?: string; value?: Record<string, unknown> }
type IgEntry   = { id?: string; time?: number; messaging?: IgMessaging[]; changes?: IgChange[] }
type IgWebhook = { object?: string; entry?: IgEntry[] }

function log(kind: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ src: "ig-inbound", kind, ...data }))
}

/** Conta IG conectada → tenant + token (decifrado) p/ enrichment/outbound. 1 conta = 1 tenant. */
async function connectionFor(igAccountId: string): Promise<{ tenantId: string; token: string | null } | null> {
  const { data } = await supabaseAdmin.from("channel_connections")
    .select("tenant_id, access_token").eq("channel", "instagram").eq("external_account_id", igAccountId).eq("status", "active").maybeSingle()
  if (!data) return null
  return { tenantId: data.tenant_id as string, token: decryptSecret(data.access_token as string | null) }
}

/**
 * Enriquece o contato com nome real + @ + foto via Graph API (precisa do token).
 * Sem token → garante só o placeholder no create. Re-enriquece um contato antigo
 * que ainda esteja com placeholder (ex: criado antes de conectar o token).
 */
async function maybeEnrich(token: string | null, igsid: string, contactId: string, created: boolean): Promise<void> {
  if (!token) {
    if (created) await supabaseAdmin.from("chat_contacts").update({ push_name: IG_PLACEHOLDER_NAME }).eq("id", contactId).is("push_name", null)
    return
  }
  if (!created) {
    const { data } = await supabaseAdmin.from("chat_contacts").select("push_name").eq("id", contactId).single()
    const pn = data?.push_name as string | null
    if (pn && pn !== IG_PLACEHOLDER_NAME) return   // já tem nome real
  }
  const prof = await fetchIgProfile(igsid, token)
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (prof?.name)       patch.push_name       = prof.name
  if (prof?.username)   patch.username        = prof.username
  if (prof?.profilePic) patch.profile_pic_url = prof.profilePic
  if (!prof?.name && created) patch.push_name = IG_PLACEHOLDER_NAME   // fallback
  await supabaseAdmin.from("chat_contacts").update(patch).eq("id", contactId)
}

/** Placeholder de instance_id (NOT NULL) — 1ª instância WhatsApp do tenant. */
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
    channel: "instagram", status: "open", unread_count: 0,
    assigned_to: null, last_message_at: new Date().toISOString(),
  }).select("id").single()
  if (error || !data) throw new Error(`ig conv: ${error?.message ?? "desconhecido"}`)
  return { id: data.id as string, isNew: true }
}

async function handleDm(igAccountId: string | null, m: IgMessaging): Promise<void> {
  const fromIgsid = m.sender?.id ?? null
  const text = m.message?.text ?? null
  const mid  = m.message?.mid ?? null
  const att  = m.message?.attachments?.[0]
  if (!igAccountId || igAccountId === "0" || !fromIgsid) { log("dm-skip", { reason: "missing-id", igAccountId, fromIgsid }); return }

  const conn = await connectionFor(igAccountId)
  if (!conn) { log("dm-skip", { reason: "no-connection", igAccountId }); return }
  const instanceId = await defaultInstanceId(conn.tenantId)
  if (!instanceId) { log("dm-skip", { reason: "no-instance", tenantId: conn.tenantId }); return }

  const contact = await resolveOrCreateContact(conn.tenantId, { instagram: fromIgsid }, { primaryChannel: "instagram", source: "instagram" })
  await maybeEnrich(conn.token, fromIgsid, contact.id, contact.created)   // nome+@+foto via Graph API (se conectado)

  const conv = await getOrCreateIgConversation(conn.tenantId, contact.id, instanceId)

  // Mídia: visível já (label + URL no metadata). Download p/ o bucket = próximo passo.
  const contentType = att?.type ? attachmentKind(att.type) : "text"
  const content     = att?.type ? (text?.trim() || MEDIA_LABEL[att.type] || "📎 Anexo") : text
  const preview     = (content?.trim()?.slice(0, 100)) || "Mensagem"
  const now = new Date().toISOString()

  const { error } = await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conv.id, tenant_id: conn.tenantId,
    sender_type: "contact", sender_id: null,
    content_type: contentType, content,
    whatsapp_msg_id: mid,                 // idempotência (reusa a coluna; Meta reenvia)
    status: "delivered", is_private_note: false,
    metadata: { channel: "instagram", ig_account_id: igAccountId, ...(att?.payload?.url ? { ig_attachment_url: att.payload.url, ig_attachment_type: att.type } : {}) },
  })
  if (error) { if (error.code !== "23505") log("dm-insert-err", { err: error.message }); return }   // 23505 = duplicata

  const { data: cc } = await supabaseAdmin.from("chat_conversations").select("unread_count, status").eq("id", conv.id).single()
  const wasResolved = (cc?.status as string) === "resolved"
  await supabaseAdmin.from("chat_conversations").update({
    last_message_at:      now,
    last_inbound_at:      now,            // abre a janela 24h (o cliente falou) → habilita resposta
    last_message_preview: preview,
    last_message_dir:     "in",
    unread_count:         ((cc?.unread_count as number) ?? 0) + 1,
    status:               wasResolved ? "open" : (cc?.status as string),
    updated_at:           now,
    ...(wasResolved ? { resolved_at: null } : {}),
  }).eq("id", conv.id)

  log("dm-ok", { tenantId: conn.tenantId, contactId: contact.id, convId: conv.id, isNew: conv.isNew, created: contact.created, kind: contentType })
}

export async function processInstagramWebhook(body: unknown): Promise<void> {
  const wh = body as IgWebhook
  if (wh?.object !== "instagram") { log("skip", { reason: "object", object: wh?.object ?? null }); return }

  for (const entry of wh.entry ?? []) {
    const igAccountId = entry.id ?? null   // conta conectada (ex: omni.kora) que recebeu

    for (const m of entry.messaging ?? []) {
      if (m.message?.is_echo) continue     // eco do nosso próprio envio → não re-ingere
      await handleDm(igAccountId, m).catch((e) => log("dm-err", { err: (e as Error).message }))
    }

    for (const ch of entry.changes ?? []) {
      if (ch.field !== "comments") { log("change", { igAccountId, field: ch.field ?? null }); continue }
      const v = ch.value ?? {}
      const from = v.from as { id?: string; username?: string } | undefined
      log("comment", {
        igAccountId,
        commentId: (v.id as string) ?? null,
        fromIgsid: from?.id ?? null,
        username:  from?.username ?? null,
        hasText:   typeof v.text === "string",
      })
      // TODO F2: match de keyword → private reply (Send API recipient.comment_id, 1-DM-por-comentário)
      //   + resolveOrCreateContact(instagram=IGSID) → dispara fluxo no DM.
    }
  }
}
