"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { requireModule } from "@/lib/modules"
import { canAccessDeal } from "@/lib/actions/deals"
import { createManagedTask, updateManagedTask } from "@/lib/actions/task-management"

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
  dealId?: string | null; contactId?: string | null; title: string; dueAt?: string | null; assignedTo?: string | null
}): Promise<{ id: string } | { error: string }> { return createManagedTask(input) }

export async function setTaskDone(taskId: string, done: boolean): Promise<{ ok: true } | { error: string }> {
  return updateManagedTask(taskId, { status: done ? "done" : "pending" })
}

/** Reagenda a mesma tarefa; a transação rearma o lembrete e registra histórico. */
export async function snoozeTask(taskId: string, dueAt: string): Promise<{ ok: true } | { error: string }> {
  return updateManagedTask(taskId, { dueAt })
}

/** Tarefas de um negócio (pendentes primeiro, por prazo). Pra a ficha do negócio. */
export async function listDealTasks(dealId: string): Promise<TaskRow[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  try { await requireModule("crm") } catch { return [] }
  const t = session.user.tenantId
  const { data: deal } = await supabaseAdmin.from("tenant_deals").select("contact_id, assigned_to").eq("id", dealId).eq("tenant_id", t).maybeSingle()
  if (!deal) return []
  const dl = deal as { contact_id: string | null; assigned_to: string | null }
  if (!(await canAccessDeal(t, dl.contact_id, dl.assigned_to))) return []

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
