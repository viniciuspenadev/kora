import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { parseMessageDelete, deleteProtocol } from "./message-delete"

export async function reconcileMessageDelete(instance: { id: string; tenant_id: string }, payload: unknown, deletedEvent = false): Promise<boolean> {
  const deletion = parseMessageDelete(payload, deletedEvent)
  if (!deletion) return deletedEvent || !!deleteProtocol(payload)
  const { error } = await supabaseAdmin.rpc("confirm_chat_message_deletion", {
    p_tenant: instance.tenant_id, p_instance: instance.id, p_whatsapp_id: deletion.messageId,
    p_from_me: deletion.fromMe,
  })
  if (error) throw new Error("Não foi possível reconciliar a exclusão da mensagem")
  return true
}
