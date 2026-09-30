"use server"

import { getViewerScope } from "@/lib/visibility"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import { logAudit } from "@/lib/audit"

export interface MemberConversationAccess {
  role: "owner" | "admin" | "agent"
  departmentId: string | null
  viewAll: boolean
  seePool: boolean
  instanceIds: string[]
  supervisesDepartments: string[]
}

/** O banco valida ator, destino e referências e salva o conjunto em uma transação. */
export async function saveMemberConversationAccess(userId: string, input: MemberConversationAccess): Promise<{ error?: string }> {
  const scope = await getViewerScope()
  if (!scope.isAdmin) return { error: "Somente administradores podem alterar o acesso da equipe." }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const validIds = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 200 && value.every(id => typeof id === "string" && uuid.test(id))
  if (!uuid.test(userId) || !input || !["owner", "admin", "agent"].includes(input.role)
    || (input.departmentId !== null && (typeof input.departmentId !== "string" || !uuid.test(input.departmentId)))
    || typeof input.viewAll !== "boolean" || typeof input.seePool !== "boolean"
    || !validIds(input.instanceIds) || !validIds(input.supervisesDepartments)
    || (input.viewAll && input.supervisesDepartments.length > 0)) {
    return { error: "Revise a função, o departamento e as permissões selecionadas." }
  }
  const { error } = await supabaseAdmin.rpc("save_member_conversation_access", {
    p_tenant_id: scope.tenantId, p_actor_id: scope.userId, p_user_id: userId,
    p_role: input.role, p_department_id: input.departmentId,
    p_view_all: input.viewAll, p_see_pool: input.seePool,
    p_instance_ids: [...new Set(input.instanceIds)], p_supervises_departments: [...new Set(input.supervisesDepartments)],
  })
  if (error) {
    // Os erros P0001 são mensagens controladas da função; não expor detalhes de infra.
    return { error: error.code === "P0001" ? error.message : "Não foi possível salvar o acesso. Nenhuma permissão deste conjunto foi alterada." }
  }
  await logAudit({ tenantId: scope.tenantId, actorId: scope.userId, action: "team.conversation_access.set",
    targetType: "tenant_user", targetId: userId, metadata: { role: input.role, department_id: input.departmentId, view_all: input.viewAll,
      see_pool: input.seePool, instance_count: input.instanceIds.length, supervised_department_count: input.supervisesDepartments.length } })
  revalidatePath("/configuracoes/equipe")
  revalidatePath(`/configuracoes/equipe/${userId}`)
  return {}
}
