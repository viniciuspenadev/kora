import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { parseMessageEdit, messageEditProtocol } from "./message-edit"

/** Authenticated Evolution ingress only. No notification, assignment or automation. */
export async function reconcileMessageEdit(instance: { id: string; tenant_id: string }, payload: unknown): Promise<boolean> {
  const edit = parseMessageEdit(payload)
  // Unsupported/malformed edits are still protocol events, never new replies.
  if (!edit) return !!messageEditProtocol(payload)
  const { error } = await supabaseAdmin.rpc("confirm_chat_message_edit", {
    p_tenant: instance.tenant_id, p_instance: instance.id, p_whatsapp_id: edit.messageId,
    p_from_me: edit.fromMe, p_text: edit.text, p_edited_at: edit.editedAt,
    p_content_type: edit.contentType,
  })
  if (error) throw new Error("Não foi possível reconciliar a edição da mensagem")
  return true
}
