import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

/** Evolution supplies seconds since epoch. Missing/invalid dates must not turn
 * history synchronization into a new response at the time of ingestion. */
export function evolutionSentAt(value: unknown, nowMs = Date.now()): string | null {
  const seconds = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN
  const ms = seconds * 1000
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || ms > nowMs || !Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

/** Reprojects an already persisted external message. Safe to call on webhook
 * redelivery after a failed projection; never infers a Kora agent from the owner. */
export async function applyExternalReply(input: { tenantId: string; instanceId: string; messageId: string }): Promise<boolean> {
  const { tenantId, instanceId, messageId } = input
  const { data: message, error } = await supabaseAdmin.from("chat_messages")
    .select("conversation_id, content, content_type, metadata, status, sender_type, is_private_note")
    .eq("tenant_id", tenantId).eq("id", messageId).maybeSingle()
  if (error) throw new Error("Falha ao ler resposta externa.")
  if (!message || message.sender_type !== "agent" || message.is_private_note !== false
    || !["sent", "delivered", "read"].includes(message.status)) return false
  const meta = message.metadata as Record<string, unknown> | null
  if (meta?.via_celular !== true || meta.edited || typeof meta.whatsapp_sent_at !== "string") return false
  const sentMs = Date.parse(meta.whatsapp_sent_at)
  if (!Number.isFinite(sentMs) || sentMs > Date.now()) return false
  // Receipts, edits, reactions and unsupported events are not a response.
  if (!["text", "image", "audio", "video", "document", "sticker", "location", "contact", "poll", "interactive", "album"].includes(message.content_type)
    || (message.content_type === "text" && !message.content?.trim())) return false
  const preview = message.content?.slice(0, 100) || `📎 ${message.content_type}`

  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: current, error: readError } = await supabaseAdmin.from("chat_conversations")
      .select("id, updated_at, last_message_at, last_message_dir, last_inbound_at, flagged_pending, unread_count")
      .eq("tenant_id", tenantId).eq("instance_id", instanceId).eq("channel", "whatsapp")
      .eq("id", message.conversation_id).maybeSingle()
    if (readError) throw new Error("Falha ao ler atendimento da resposta externa.")
    if (!current) return false
    const latest = Math.max(Date.parse(current.last_message_at ?? "") || 0, Date.parse(current.last_inbound_at ?? "") || 0)
    if (sentMs <= latest) return false
    let update = supabaseAdmin.from("chat_conversations").update({
      last_message_at: meta.whatsapp_sent_at,
      last_message_preview: preview,
      last_message_dir: "out_phone",
      flagged_pending: false,
      updated_at: new Date().toISOString(),
    }).eq("tenant_id", tenantId).eq("instance_id", instanceId).eq("channel", "whatsapp").eq("id", current.id)
      .eq("updated_at", current.updated_at)
    update = current.last_message_at == null ? update.is("last_message_at", null) : update.eq("last_message_at", current.last_message_at)
    update = current.last_message_dir == null ? update.is("last_message_dir", null) : update.eq("last_message_dir", current.last_message_dir)
    update = current.last_inbound_at == null ? update.is("last_inbound_at", null) : update.eq("last_inbound_at", current.last_inbound_at)
    update = current.unread_count == null ? update.is("unread_count", null) : update.eq("unread_count", current.unread_count)
    update = current.flagged_pending == null ? update.is("flagged_pending", null) : update.eq("flagged_pending", current.flagged_pending)
    const { data: changed, error: writeError } = await update.select("id")
    if (writeError) throw new Error("Falha ao atualizar atendimento da resposta externa.")
    if (changed?.length) return true
  }
  throw new Error("Atendimento alterado durante a resposta externa.")
}
