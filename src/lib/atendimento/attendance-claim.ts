import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { claimOwnerOnAttendance } from "@/lib/carteira"
import { canViewConversation, type ViewerScope } from "@/lib/visibility"
import { logConversationEvent } from "./events"

/** Call only after the action has validated session, visibility and channel.
 * A losing pool sender must reload instead of sending/claiming on a stale grant. */
export async function prepareHumanReply(tenantId: string, conversationId: string, userId: string, assignedTo: string | null, scope: ViewerScope): Promise<void> {
  const { data: current, error } = await supabaseAdmin.from("chat_conversations")
    .select("assigned_to, participants, department_id, instance_id, metadata, updated_at")
    .eq("tenant_id", tenantId).eq("id", conversationId).maybeSingle()
  if (error || !current) throw new Error("Não foi possível confirmar o atendimento. Atualize a conversa.")
  if (scope.tenantId !== tenantId || scope.userId !== userId || !canViewConversation(scope, current)) {
    throw new Error("Sem permissão para responder nesta conversa. Atualize a conversa.")
  }
  if (current.assigned_to !== assignedTo) throw new Error("O responsável pela conversa mudou. Atualize antes de enviar.")
  const now = new Date().toISOString()
  const metadata = { ...((current.metadata ?? {}) as Record<string, unknown>),
    ai_routed: { at: now, by: userId, via: "human_reply" } }
  delete (metadata as Record<string, unknown>).reopen_owner
  delete (metadata as Record<string, unknown>).ai_pinned_flow
  delete (metadata as Record<string, unknown>).studio_entry
  let q = supabaseAdmin.from("chat_conversations")
    .update({ assigned_to: assignedTo ?? userId, ai_handling: false, metadata, updated_at: now })
    .eq("tenant_id", tenantId).eq("id", conversationId).eq("updated_at", current.updated_at)
  q = assignedTo === null ? q.is("assigned_to", null) : q.eq("assigned_to", assignedTo)
  const { data: taken, error: writeError } = await q.select("id")
  if (writeError || !taken?.length) throw new Error("A conversa mudou durante o envio. Atualize antes de tentar novamente.")
  if (assignedTo === null) await logConversationEvent({ tenantId, conversationId, type: "assigned",
    actorKind: "agent", actorId: userId, toAgentId: userId, reason: "auto_assign_pool" })
}

/** Called only after an accepted public send. Also covers an already assigned
 * conversation; no contact ID supplied by the caller can claim another account. */
export async function claimAfterAcceptedReply(tenantId: string, conversationId: string, userId: string, sentContactId: string | null): Promise<void> {
  try {
    const { data: conv, error } = await supabaseAdmin.from("chat_conversations")
      .select("contact_id, assigned_to")
      .eq("tenant_id", tenantId).eq("id", conversationId).maybeSingle()
    if (error) throw new Error("Não foi possível confirmar a carteira após o envio.")
    if (conv?.assigned_to !== userId || conv.contact_id !== sentContactId) return
    await claimOwnerOnAttendance(tenantId, conv.contact_id, userId)
  } catch (error) {
    console.error("[attendance/claim-after-send]", { tenantId, conversationId,
      error: error instanceof Error ? error.message : "claim_failed" })
  }
}
