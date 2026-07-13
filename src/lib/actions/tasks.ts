"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { requireModule } from "@/lib/modules"
import { canAccessDeal } from "@/lib/actions/deals"
import { recordDealEvent } from "@/lib/crm/deals"

// ═══════════════════════════════════════════════════════════════
// CRM — Tarefas / Próxima ação
// ═══════════════════════════════════════════════════════════════
// Gated por `crm`. Visibilidade herda do negócio/contato (canAccessDeal).

export interface TaskRow {
  id:         string
  title:      string
  due_at:     string | null
  status:     string          // 'pending' | 'done' | 'canceled'
  done_at:    string | null
  created_at: string
  /** Responsável pela tarefa (assigned_to; default = quem criou). Nome + id pro avatar. */
  responsible:    string | null
  responsible_id: string | null
}

export async function createTask(input: {
  dealId?:     string | null
  contactId?:  string | null
  title:       string
  dueAt?:      string | null
  assignedTo?: string | null
}): Promise<{ id: string } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  if (!input.title.trim()) return { error: "Dê um título pra tarefa" }
  const t = session.user.tenantId

  let contactId = input.contactId ?? null
  const dealId  = input.dealId ?? null
  if (dealId) {
    const { data: deal } = await supabaseAdmin.from("tenant_deals").select("contact_id").eq("id", dealId).eq("tenant_id", t).maybeSingle()
    if (!deal) return { error: "Negócio inválido" }
    contactId = (deal as { contact_id: string | null }).contact_id
  }
  if (!(await canAccessDeal(t, contactId))) return { error: "Sem acesso" }

  const { data, error } = await supabaseAdmin.from("tenant_tasks").insert({
    tenant_id:   t,
    contact_id:  contactId,
    deal_id:     dealId,
    title:       input.title.trim(),
    due_at:      input.dueAt ?? null,
    assigned_to: input.assignedTo ?? session.user.id,
    created_by:  session.user.id,
  }).select("id").single()
  if (error || !data) return { error: error?.message ?? "Falha ao criar tarefa" }
  // Dossiê do negócio: "Próxima ação definida" (só auditoria — sem cartão no chat).
  if (dealId) await recordDealEvent({ tenantId: t, dealId, type: "task_created", by: session.user.id, note: input.title.trim(), postCard: false })
  return { id: (data as { id: string }).id }
}

export async function setTaskDone(taskId: string, done: boolean): Promise<{ ok: true } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  const t = session.user.tenantId
  const { data: task } = await supabaseAdmin.from("tenant_tasks").select("contact_id, deal_id, title").eq("id", taskId).eq("tenant_id", t).maybeSingle()
  if (!task) return { error: "Tarefa não encontrada" }
  const tk = task as { contact_id: string | null; deal_id: string | null; title: string }
  if (!(await canAccessDeal(t, tk.contact_id))) return { error: "Sem acesso" }
  await supabaseAdmin.from("tenant_tasks").update({
    status:  done ? "done" : "pending",
    done_at: done ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("id", taskId).eq("tenant_id", t)
  // Dossiê: concluir tarefa de um negócio entra na timeline (só auditoria).
  if (done && tk.deal_id) await recordDealEvent({ tenantId: t, dealId: tk.deal_id, type: "task_done", by: session.user.id, note: tk.title, postCard: false })
  return { ok: true }
}

/** Adiar uma tarefa pra um novo prazo (rearma o lembrete). */
export async function snoozeTask(taskId: string, dueAt: string): Promise<{ ok: true } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  const t = session.user.tenantId
  const { data: task } = await supabaseAdmin.from("tenant_tasks").select("contact_id").eq("id", taskId).eq("tenant_id", t).maybeSingle()
  if (!task) return { error: "Tarefa não encontrada" }
  if (!(await canAccessDeal(t, (task as { contact_id: string | null }).contact_id))) return { error: "Sem acesso" }
  // NOTA: rearmar o lembrete (reminded_at = null) entra quando a migration reminded_at for aplicada.
  await supabaseAdmin.from("tenant_tasks")
    .update({ due_at: dueAt, updated_at: new Date().toISOString() })
    .eq("id", taskId).eq("tenant_id", t)
  return { ok: true }
}

/** Tarefas de um negócio (pendentes primeiro, por prazo). Pra a ficha do negócio. */
export async function listDealTasks(dealId: string): Promise<TaskRow[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  try { await requireModule("crm") } catch { return [] }
  const t = session.user.tenantId
  const { data: deal } = await supabaseAdmin.from("tenant_deals").select("contact_id").eq("id", dealId).eq("tenant_id", t).maybeSingle()
  if (!deal || !(await canAccessDeal(t, (deal as { contact_id: string | null }).contact_id))) return []

  const { data } = await supabaseAdmin.from("tenant_tasks")
    .select("id, title, due_at, status, done_at, created_at, assigned_to")
    .eq("tenant_id", t).eq("deal_id", dealId)
    .order("status", { ascending: true })
    .order("due_at", { ascending: true, nullsFirst: false })
  const rows = (data ?? []) as Record<string, unknown>[]
  const ids = Array.from(new Set(rows.map((r) => r.assigned_to as string | null).filter(Boolean))) as string[]
  const nameMap = new Map<string, string>()
  if (ids.length) {
    const { data: profs } = await supabaseAdmin.from("profiles").select("id, full_name").in("id", ids)
    for (const p of (profs ?? []) as { id: string; full_name: string | null }[]) nameMap.set(p.id, p.full_name ?? "—")
  }
  return rows.map((r) => ({
    id: r.id as string, title: r.title as string, due_at: (r.due_at as string | null) ?? null,
    status: r.status as string, done_at: (r.done_at as string | null) ?? null, created_at: r.created_at as string,
    responsible: r.assigned_to ? (nameMap.get(r.assigned_to as string) ?? null) : null,
    responsible_id: (r.assigned_to as string | null) ?? null,
  }))
}
