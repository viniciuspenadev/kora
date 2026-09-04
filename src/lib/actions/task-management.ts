"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope } from "@/lib/visibility"
import { requireModule } from "@/lib/modules"
import { taskContextAccess, taskMemberScope, taskContextIds } from "@/lib/crm/task-access"
import { canEditTask, taskHref, validateTaskPatch, type TaskPatch, type TaskStatus } from "@/lib/crm/task-rules"

export interface ManagedTask {
  id: string; title: string; due_at: string | null; status: TaskStatus; updated_at: string
  assigned_to: string | null; contact_id: string | null; deal_id: string | null
  created_at: string; done_at: string | null; responsible: string | null; canEdit: boolean; href: string
}
const SELECT = "id,title,due_at,status,updated_at,assigned_to,contact_id,deal_id,created_at,done_at"
async function scope() { await requireModule("crm"); return getViewerScope() }
async function eligibleOwners(s: Awaited<ReturnType<typeof scope>>, team: boolean): Promise<string[] | null> {
  if (!team) return [s.userId]
  if (s.isAdmin || s.viewAll) return null
  if (!s.supervisesDepartments.length) return [s.userId]
  const { data, error } = await supabaseAdmin.from("tenant_users").select("user_id")
    .eq("tenant_id", s.tenantId).eq("active", true).in("department_id", s.supervisesDepartments)
  if (error) throw new Error("Não foi possível consultar a equipe.")
  return [...new Set([s.userId, ...(data ?? []).map(r => r.user_id as string)])]
}
async function readTask(id: string) {
  const s = await scope()
  const { data, error } = await supabaseAdmin.from("tenant_tasks").select(SELECT).eq("tenant_id", s.tenantId).eq("id", id).maybeSingle()
  if (error || !data) throw new Error("Tarefa não encontrada.")
  const row = data as Omit<ManagedTask, "responsible" | "canEdit" | "href">
  const owners = await eligibleOwners(s, true)
  if (owners && (!row.assigned_to || !owners.includes(row.assigned_to))) throw new Error("Sem acesso à tarefa.")
  if (!(await taskContextAccess(s, row))) throw new Error("Sem acesso à origem desta tarefa.")
  return { s, row }
}
export async function listManagedTasks(input: { scope?: "me" | "team"; ownerId?: string; status?: TaskStatus | "all"; timing?: "overdue" | "undated"; from?: string; to?: string; page?: number; pageSize?: number } = {}) {
  const s = await scope()
  const owners = await eligibleOwners(s, input.scope === "team")
  const size = Math.min(200, Math.max(1, Math.floor(input.pageSize || 30)))
  const page = Math.max(0, Math.min(10000, Math.floor(input.page || 0)))
  if ([input.from,input.to].some(date => date && !Number.isFinite(Date.parse(date)))) throw new Error("Período inválido")
  const reach = await taskContextIds(s)
  const { data: result, error } = await supabaseAdmin.rpc("crm_task_list", {p_tenant:s.tenantId,p_owners:owners,p_all:reach.all,p_contacts:reach.contacts,p_deals:reach.deals,
    p_filter:{owner:input.ownerId,status:input.status??"all",timing:input.timing,from:input.from,to:input.to},p_offset:page*size,p_size:size})
  if (error) throw new Error("Não foi possível carregar as tarefas. Verifique a atualização do sistema.")
  const { items: data, total: count } = result as {items: ManagedTask[];total:number}
  const ids = [...new Set((data ?? []).map(r => r.assigned_to).filter(Boolean))]
  const { data: names } = ids.length ? await supabaseAdmin.from("profiles").select("id,full_name").in("id", ids) : { data: [] }
  const nameMap = new Map((names ?? []).map(r => [r.id, r.full_name]))
  return { items: (data ?? []).map(r => ({ ...r, responsible: nameMap.get(r.assigned_to) ?? null,
    canEdit: canEditTask(r, s.userId, s.isAdmin), href: taskHref(r) })) as ManagedTask[],
    total: count ?? 0, canSeeTeam: s.isAdmin || s.viewAll || s.supervisesDepartments.length > 0, isAdmin: s.isAdmin }
}
export async function getManagedTask(id: string): Promise<ManagedTask> {
  const { s, row } = await readTask(id)
  const { data } = row.assigned_to ? await supabaseAdmin.from("profiles").select("full_name").eq("id", row.assigned_to).maybeSingle() : { data: null }
  return { ...row, responsible: data?.full_name ?? null, canEdit: canEditTask(row, s.userId, s.isAdmin), href: taskHref(row) }
}
export async function taskAssignees(forFilter = false) {
  const s = await scope()
  if (!s.isAdmin && !forFilter) return []
  const allowed = await eligibleOwners(s, true)
  let query = supabaseAdmin.from("tenant_users").select("user_id").eq("tenant_id", s.tenantId).eq("active", true)
  if(allowed) query=query.in("user_id",allowed)
  const { data, error } = await query
  if (error) throw new Error("Não foi possível carregar responsáveis.")
  const ids = (data ?? []).map(r => r.user_id)
  if (!ids.length) return []
  const { data: names } = await supabaseAdmin.from("profiles").select("id,full_name").in("id", ids).order("full_name")
  return (names ?? []).map(r => ({ id: r.id as string, name: (r.full_name || "Usuário") as string }))
}
export async function taskHistory(id: string, page = 0) {
  const { s } = await readTask(id)
  const offset = Math.max(0, Math.floor(page || 0)) * 30
  const { data, error } = await supabaseAdmin.from("tenant_task_events").select("id,actor_id,kind,before_state,after_state,created_at")
    .eq("tenant_id", s.tenantId).eq("task_id", id).order("created_at", { ascending: false }).order("id").range(offset, offset + 29)
  if (error) throw new Error("Histórico indisponível. Verifique a atualização do sistema.")
  const ids = [...new Set((data ?? []).flatMap(r => [r.actor_id,r.before_state?.assigned_to,r.after_state?.assigned_to]).filter(Boolean))]
  const { data: names } = ids.length ? await supabaseAdmin.from("profiles").select("id,full_name").in("id", ids) : { data: [] }
  const actors = new Map((names ?? []).map(r => [r.id, r.full_name]))
  return (data ?? []).map(r => ({ ...r, actorName: actors.get(r.actor_id) ?? "Sistema",
    previousOwner: actors.get(r.before_state?.assigned_to) ?? "Sem responsável", nextOwner: actors.get(r.after_state?.assigned_to) ?? "Sem responsável" }))
}
export async function updateManagedTask(id: string, input: TaskPatch, expected?: string): Promise<{ ok: true } | { error: string }> {
  try {
    const invalid = validateTaskPatch(input); if (invalid) return { error: invalid }
    const { s, row } = await readTask(id)
    if (!canEditTask(row, s.userId, s.isAdmin)) return { error: "Só o responsável ou um admin pode alterar esta tarefa." }
    if (input.assignedTo && input.assignedTo !== row.assigned_to && !s.isAdmin) return { error: "Só admin pode redistribuir." }
    const recipient = input.assignedTo ?? row.assigned_to
    if (recipient && input.assignedTo) {
      const member = await taskMemberScope(s.tenantId, recipient)
      if (!member || !(await taskContextAccess(member, row))) return { error: "Responsável inativo ou sem acesso à origem desta tarefa." }
    }
    const patch: Record<string, unknown> = {}
    if (input.title !== undefined) patch.title = input.title.trim()
    if (input.dueAt !== undefined) patch.due_at = input.dueAt ? new Date(input.dueAt).toISOString() : null
    if (input.status !== undefined) patch.status = input.status
    if (input.assignedTo !== undefined) patch.assigned_to = input.assignedTo
    const { error } = await supabaseAdmin.rpc("crm_task_mutate", { p_tenant: s.tenantId, p_actor: s.userId, p_id: id, p_expected: expected ?? row.updated_at, p_patch: patch })
    if (error) return { error: error.message.includes("crm_task_mutate") ? "Gestão de tarefas indisponível: atualização do banco pendente." : error.message }
    revalidatePath("/tarefas"); revalidatePath("/agenda"); if (row.deal_id) revalidatePath(`/negocios/${row.deal_id}`)
    return { ok: true }
  } catch (e) { return { error: e instanceof Error ? e.message : "Falha ao atualizar tarefa." } }
}
export async function createManagedTask(input: { dealId?: string | null; contactId?: string | null; title: string; dueAt?: string | null; assignedTo?: string | null }): Promise<{ id: string } | { error: string }> {
  try {
    const invalid = validateTaskPatch({ ...input, assignedTo: input.assignedTo ?? undefined }); if (invalid) return { error: invalid }
    const s = await scope()
    const assigned = input.assignedTo || s.userId
    if (assigned !== s.userId && !s.isAdmin) return { error: "Só admin pode atribuir tarefas a outra pessoa." }
    let contactId = input.contactId ?? null
    if (input.dealId) {
      const { data } = await supabaseAdmin.from("tenant_deals").select("contact_id").eq("tenant_id", s.tenantId).eq("id", input.dealId).maybeSingle()
      if (!data) return { error: "Negócio inválido." }
      contactId = data.contact_id
    }
    const origin = { deal_id: input.dealId || null, contact_id: contactId }
    const member = await taskMemberScope(s.tenantId, assigned)
    if (!member || !(await taskContextAccess(s, origin)) || !(await taskContextAccess(member, origin))) return { error: "Sem acesso à origem ou responsável inválido." }
    const { data, error } = await supabaseAdmin.rpc("crm_task_mutate", { p_tenant: s.tenantId, p_actor: s.userId, p_id: null, p_expected: null,
      p_patch: { title: input.title.trim(), due_at: input.dueAt ? new Date(input.dueAt).toISOString() : null, assigned_to: assigned, ...origin } })
    if (error) return { error: error.message.includes("crm_task_mutate") ? "Gestão de tarefas indisponível: atualização do banco pendente." : error.message }
    revalidatePath("/tarefas"); if (origin.deal_id) revalidatePath(`/negocios/${origin.deal_id}`)
    return { id: String(data) }
  } catch (e) { return { error: e instanceof Error ? e.message : "Falha ao criar tarefa." } }
}
