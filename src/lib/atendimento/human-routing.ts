import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { carteiraOwner } from "@/lib/carteira"
import { memberAttendsNumber } from "@/lib/visibility"
import { logConversationEvent } from "./events"

/** Preferência de atendimento, nunca formação de carteira. Não lê handoff_binding. */
export async function responsibleDestination(tenantId: string, contactId: string | null, instanceId: string | null) {
  const ownerId = await carteiraOwner(tenantId, contactId)
  if (!ownerId) return null
  const { data: member, error } = await supabaseAdmin.from("tenant_users")
    .select("user_id, role, view_all, instance_ids, department_id")
    .eq("tenant_id", tenantId).eq("user_id", ownerId).eq("active", true).maybeSingle()
  if (error || !member || !memberAttendsNumber(member, instanceId)) return null
  return { agentId: ownerId, departmentId: (member.department_id as string | null) ?? null }
}

/** Default quando nenhum fluxo conduz. Uma entrega explícita (inclusive fila)
 * ou tomada humana vence; o compare-and-set impede sobrescrever uma mudança concorrente. */
export async function routeToHumanDefault(tenantId: string, conversationId: string, reason: string, expectedMetadata?: Record<string, unknown>): Promise<void> {
  const { data: conv, error } = await supabaseAdmin.from("chat_conversations")
    .select("id, contact_id, instance_id, status, assigned_to, department_id, metadata, updated_at")
    .eq("tenant_id", tenantId).eq("id", conversationId).maybeSingle()
  if (error) throw new Error("Não foi possível consultar o destino do atendimento.")
  if (!conv || conv.status !== "open") return
  const meta = (conv.metadata ?? {}) as Record<string, unknown>
  if (meta.ai_routed) return
  if (expectedMetadata && ((meta.attendance_cycle ?? null) !== (expectedMetadata.attendance_cycle ?? null)
      || (meta.studio_entry ?? null) !== (expectedMetadata.studio_entry ?? null))) return
  const destination = conv.assigned_to
    ? { agentId: conv.assigned_to, departmentId: conv.department_id }
    : await responsibleDestination(tenantId, conv.contact_id, conv.instance_id)
  const now = new Date().toISOString()
  const metadata = { ...meta, ai_routed: { at: now, via: "human_default", reason } }
  delete (metadata as Record<string, unknown>).reopen_owner
  delete (metadata as Record<string, unknown>).ai_pinned_flow
  delete (metadata as Record<string, unknown>).studio_entry
  let update = supabaseAdmin.from("chat_conversations")
    .update({ assigned_to: destination?.agentId ?? null, department_id: destination?.departmentId ?? null,
      ai_handling: false, metadata, updated_at: now })
    .eq("tenant_id", tenantId).eq("id", conversationId).eq("status", "open")
    .eq("updated_at", conv.updated_at)
  update = conv.assigned_to ? update.eq("assigned_to", conv.assigned_to) : update.is("assigned_to", null)
  const { data: changed, error: writeError } = await update.select("id")
  if (writeError) throw new Error("Não foi possível aplicar o destino do atendimento.")
  if (!changed?.length) return
  await logConversationEvent({ tenantId, conversationId, type: "ai_handback", actorKind: "system",
    toAgentId: destination?.agentId ?? null, departmentId: destination?.departmentId ?? null,
    reason, meta: { destination: destination ? "responsible" : "pool" } })
}
