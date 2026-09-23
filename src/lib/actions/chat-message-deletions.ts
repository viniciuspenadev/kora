"use server"

import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope, canViewConversation } from "@/lib/visibility"
import { assertAtendimentoLiberado } from "@/lib/auth/tenant-serviceable"
import { getProvider } from "@/lib/providers"
import { MessageDeleteNotSentError } from "@/lib/providers/evolution-provider"
import { messageDeleteProblem, MESSAGE_DELETE_WINDOW_MS } from "@/lib/chat/message-delete"
import { rateLimit } from "@/lib/rate-limit"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type MessagePatch = { id: string; content: null; content_type: "deleted"; deleted_at: string }
type DeleteResult = { message: MessagePatch } | { error: string; uncertain?: boolean; operationId?: string }

async function deleteContext(messageId: string) {
  if (!UUID.test(messageId)) throw new Error("Mensagem inválida.")
  const scope = await getViewerScope()
  const { data: message, error } = await supabaseAdmin.from("chat_messages")
    .select("id,conversation_id,content,content_type,sender_type,sender_id,is_private_note,whatsapp_msg_id,status,metadata,created_at,edited_at,deleted_at")
    .eq("id", messageId).eq("tenant_id", scope.tenantId).maybeSingle()
  if (error || !message) throw new Error("Mensagem não encontrada.")
  const { data: conversation, error: convError } = await supabaseAdmin.from("chat_conversations")
    .select("id,instance_id,assigned_to,department_id,participants,channel,status,is_group")
    .eq("id", message.conversation_id).eq("tenant_id", scope.tenantId).maybeSingle()
  if (convError || !conversation || !canViewConversation(scope, conversation)) throw new Error("Conversa não encontrada.")
  if (message.sender_id !== scope.userId || message.sender_type !== "agent") throw new Error("Você só pode apagar suas próprias mensagens.")
  return { scope, message, conversation }
}

/** Read-only recovery. Never re-sends an ambiguous operation. */
export async function getMessageDeleteStatus(messageId: string, operationId: string): Promise<DeleteResult> {
  try {
    if (!UUID.test(operationId)) return { error: "Operação inválida." }
    const { scope } = await deleteContext(messageId)
    const { data: operation, error } = await supabaseAdmin.from("chat_message_deletions").select("status")
      .eq("id", operationId).eq("message_id", messageId).eq("tenant_id", scope.tenantId)
      .eq("actor_user_id", scope.userId).maybeSingle()
    if (error || !operation) return { error: "Não foi possível consultar a exclusão.", uncertain: true }
    if (operation.status === "confirmed") {
      const { message } = await deleteContext(messageId)
      if (!message.deleted_at) return { error: "Confirmação pendente.", uncertain: true, operationId }
      return { message: { id: message.id, content: null, content_type: "deleted", deleted_at: message.deleted_at! } }
    }
    if (operation.status === "failed") return { error: "A exclusão não foi enviada. Você pode tentar novamente." }
    return { error: "Aguardando confirmação do WhatsApp. Não envie a exclusão novamente.", uncertain: true, operationId }
  } catch { return { error: "Não foi possível verificar a exclusão ou seu acesso à conversa.", uncertain: true } }
}

export async function deleteSentMessage(input: {
  messageId: string; operationId: string; previousContent: string | null; previousEditedAt: string | null
}): Promise<DeleteResult> {
  try {
    if (!input || !UUID.test(input.messageId) || !UUID.test(input.operationId)
      || (input.previousContent !== null && typeof input.previousContent !== "string") || (input.previousEditedAt !== null
        && (typeof input.previousEditedAt !== "string" || !Number.isFinite(Date.parse(input.previousEditedAt)))))
      return { error: "Exclusão inválida." }
    const { scope, message, conversation } = await deleteContext(input.messageId)
    if (!rateLimit(`delete-message:${scope.tenantId}:${scope.userId}`, 20, 60_000).ok)
      return { error: "Aguarde um momento antes de apagar novamente." }
    await assertAtendimentoLiberado(scope.tenantId)
    const { data: instance, error: instanceError } = await supabaseAdmin.from("whatsapp_instances")
      .select("provider,evolution_url,evolution_key,instance_name")
      .eq("id", conversation.instance_id).eq("tenant_id", scope.tenantId).maybeSingle()
    if (instanceError || !instance) return { error: "Número da conversa indisponível." }
    const problem = messageDeleteProblem(message, { userId: scope.userId, channel: conversation.channel,
      provider: instance.provider, status: conversation.status, isGroup: conversation.is_group })
    if (problem) return { error: problem }
    const provider = getProvider(instance)
    if (!provider.deleteForEveryone) return { error: "Exclusão indisponível neste canal." }
    const { data: reservation, error: reserveError } = await supabaseAdmin.rpc("reserve_chat_message_deletion", {
      p_tenant: scope.tenantId, p_message: message.id, p_actor: scope.userId, p_operation: input.operationId,
      p_previous: input.previousContent, p_edited_at: input.previousEditedAt,
    })
    if (reserveError || !reservation) return { error: "Não foi possível iniciar a exclusão. Atualize a conversa e confira se a mensagem mudou." }
    if (!reservation.acquired) return getMessageDeleteStatus(message.id, reservation.operationId ?? input.operationId)
    try {
      // Revalidate access after reservation, immediately before the external mutation.
      const current = await deleteContext(message.id)
      if (current.message.deleted_at) return getMessageDeleteStatus(message.id, input.operationId)
      if (current.conversation.status === "resolved" || current.conversation.instance_id !== conversation.instance_id)
        throw new MessageDeleteNotSentError()
    } catch {
      await supabaseAdmin.from("chat_message_deletions").update({ status: "failed", failure_code: "access_changed" })
        .eq("id", input.operationId).eq("tenant_id", scope.tenantId).eq("status", "pending")
      return { error: "A conversa ou seu acesso mudou. A exclusão não foi enviada." }
    }
    try {
      await provider.deleteForEveryone(message.whatsapp_msg_id!, Date.parse(message.created_at) + MESSAGE_DELETE_WINDOW_MS)
      const { data: confirmation, error: confirmError } = await supabaseAdmin.rpc("confirm_chat_message_deletion", {
        p_tenant: scope.tenantId, p_instance: conversation.instance_id, p_whatsapp_id: message.whatsapp_msg_id,
        p_from_me: true, p_operation: input.operationId,
      })
      if (confirmError || confirmation?.status !== "confirmed") throw new Error("confirmation_pending")
      return getMessageDeleteStatus(message.id, input.operationId)
    } catch (error) {
      const notSent = error instanceof MessageDeleteNotSentError
      await supabaseAdmin.from("chat_message_deletions").update({ status: notSent ? "failed" : "uncertain",
        failure_code: notSent ? "original_unavailable" : "confirmation_pending" })
        .eq("id", input.operationId).eq("tenant_id", scope.tenantId).eq("status", "pending")
      // The webhook may have confirmed while the HTTP request failed.
      const status = await getMessageDeleteStatus(message.id, input.operationId)
      if ("message" in status) return status
      return notSent ? { error: "Não foi possível localizar a mensagem original na Evolution. Nenhuma exclusão foi enviada." }
        : { error: "Ainda não recebemos a confirmação. Confira o status antes de tentar novamente.", uncertain: true, operationId: input.operationId }
    }
  } catch {
    // Do not expose provider response bodies, credentials or customer content.
    return { error: "Não foi possível apagar a mensagem. Verifique seu acesso e atualize a conversa." }
  }
}
