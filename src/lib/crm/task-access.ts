import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { SCOPE_TU_SELECT, scopeFromTenantUserRow, canViewConversation, applyVisibilityFilter, seesAllDeals, type ViewerScope, type ScopeTenantUserRow, type ConvVisibilityFields } from "@/lib/visibility"

/** Destinatário é sempre resolvido no servidor; nunca confiamos no role do input. */
export async function taskMemberScope(tenantId: string, userId: string): Promise<ViewerScope | null> {
  const { data, error } = await supabaseAdmin.from("tenant_users").select(`role, ${SCOPE_TU_SELECT}`)
    .eq("tenant_id", tenantId).eq("user_id", userId).eq("active", true).maybeSingle()
  if (error || !data) return null
  return scopeFromTenantUserRow(tenantId, userId, ["owner", "admin"].includes(data.role), data as ScopeTenantUserRow)
}
export async function taskContextAccess(scope: ViewerScope, task: { contact_id: string | null; deal_id: string | null }): Promise<boolean> {
  if (task.deal_id) {
    const { data, error } = await supabaseAdmin.from("tenant_deals").select("assigned_to, contact_id")
      .eq("tenant_id", scope.tenantId).eq("id", task.deal_id).maybeSingle()
    if (error || !data) return false
    if (seesAllDeals(scope) || data.assigned_to === scope.userId) return true
  }
  if (!task.contact_id) return !task.deal_id
  const { data: contact, error } = await supabaseAdmin.from("chat_contacts").select("id")
    .eq("tenant_id", scope.tenantId).eq("id", task.contact_id).maybeSingle()
  if (error || !contact) return false
  if (seesAllDeals(scope)) return true
  const [{ data: convs }, { data: deals }] = await Promise.all([
    supabaseAdmin.from("chat_conversations").select("assigned_to, participants, department_id, instance_id")
      .eq("tenant_id", scope.tenantId).eq("contact_id", task.contact_id),
    supabaseAdmin.from("tenant_deals").select("id").eq("tenant_id", scope.tenantId)
      .eq("contact_id", task.contact_id).eq("assigned_to", scope.userId).limit(1),
  ])
  return !!deals?.length || ((convs ?? []) as ConvVisibilityFields[]).some(c => canViewConversation(scope, c))
}

/** Resolve alcance antes de contar/paginar. Arrays via RPC evitam URLs com milhares de IDs. */
export async function taskContextIds(scope: ViewerScope) {
  if (seesAllDeals(scope)) return { all: true, contacts: [] as string[], deals: [] as string[] }
  const contacts = new Set<string>(), deals = new Set<string>()
  for (let offset=0;;offset+=1000) {
    const { data, error } = await supabaseAdmin.from("tenant_deals").select("id,contact_id")
      .eq("tenant_id",scope.tenantId).eq("assigned_to",scope.userId).order("id").range(offset,offset+999)
    if(error)throw new Error("Não foi possível verificar o acesso aos negócios.")
    for(const row of data??[]) { deals.add(row.id); if(row.contact_id)contacts.add(row.contact_id) }
    if((data?.length??0)<1000)break
  }
  for(let offset=0;;offset+=1000) {
    const query=supabaseAdmin.from("chat_conversations").select("id,contact_id").eq("tenant_id",scope.tenantId)
    const { data,error }=await applyVisibilityFilter(query,scope).order("id").range(offset,offset+999)
    if(error)throw new Error("Não foi possível verificar o acesso às conversas.")
    for(const row of data??[])if(row.contact_id)contacts.add(row.contact_id)
    if((data?.length??0)<1000)break
  }
  return {all:false,contacts:[...contacts],deals:[...deals]}
}
