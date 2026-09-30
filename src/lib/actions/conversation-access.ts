"use server"

import { getViewerScope, canViewConversation } from "@/lib/visibility"
import { supabaseAdmin } from "@/lib/supabase"

/** Revalida cards já carregados: ausência em um delta não informa revogação. */
export async function reconcileConversationAccess(ids: string[]) {
  if (!Array.isArray(ids) || ids.length > 500 || ids.some(id => typeof id !== "string" || id.length > 64)) {
    throw new Error("Lista de conversas inválida.")
  }
  const scope = await getViewerScope()
  const scopeKey = JSON.stringify([scope.tenantId, scope.userId, scope.isAdmin, scope.viewAll, scope.seePool,
    scope.departmentId, scope.instanceIds, scope.supervisesDepartments])
  if (!ids.length) return { visibleIds: [] as string[], scopeKey }
  const { data, error } = await supabaseAdmin.from("chat_conversations")
    .select("id, assigned_to, participants, department_id, instance_id, is_group, group_live_enabled, group_access_mode")
    .eq("tenant_id", scope.tenantId).in("id", [...new Set(ids)])
  if (error) throw new Error("Não foi possível confirmar o acesso às conversas.")
  return { visibleIds: (data ?? []).filter(c => canViewConversation(scope, c)).map(c => c.id as string), scopeKey }
}
