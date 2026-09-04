import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { taskContextAccess, taskMemberScope } from "./task-access"
import { taskHref } from "./task-rules"
import { sendPushToUsers } from "@/lib/push/send"

/** O sino é durável e atômico com o carimbo. Push é um espelho best-effort. */
export async function runTaskReminderSweep(): Promise<{ notified: number; skipped: number }> {
  let notified = 0, skipped = 0
  let cursor: { due_at: string; id: string } | null = null
  const modules = new Map<string, boolean>()
  const members = new Map<string, Awaited<ReturnType<typeof taskMemberScope>>>()
  for (;;) {
  let query = supabaseAdmin.from("tenant_tasks")
    .select("id,tenant_id,title,due_at,assigned_to,deal_id,contact_id,updated_at")
    .eq("status", "pending").is("reminded_at", null).not("due_at", "is", null)
    .lte("due_at", new Date().toISOString())
  if (cursor) query = query.or(`due_at.gt.${cursor.due_at},and(due_at.eq.${cursor.due_at},id.gt.${cursor.id})`)
  const { data, error } = await query.order("due_at").order("id").limit(500)
  if (error) throw new Error("Falha na leitura de lembretes de tarefas")
  for (const task of data ?? []) {
    if (!modules.has(task.tenant_id)) modules.set(task.tenant_id, await hasModule(task.tenant_id, "crm"))
    if (!task.assigned_to || !modules.get(task.tenant_id)) { skipped++; continue }
    const key=`${task.tenant_id}:${task.assigned_to}`
    if (!members.has(key)) members.set(key, await taskMemberScope(task.tenant_id, task.assigned_to))
    const recipient = members.get(key)
    if (!recipient || !(await taskContextAccess(recipient, task))) { skipped++; continue }
    const result = await supabaseAdmin.rpc("crm_task_notify", { p_tenant: task.tenant_id, p_id: task.id, p_expected: task.updated_at })
    if (result.error) throw new Error("Falha ao persistir lembrete de tarefa")
    if (!result.data) { skipped++; continue }
    notified++
    try {
      await sendPushToUsers([task.assigned_to], { title: `Tarefa: ${task.title}`, body: "O prazo desta tarefa chegou.", url: taskHref(task), tag: `task_due:${task.id}` })
    } catch { /* O aviso já está salvo no sino; falha de push não repete a notificação. */ }
  }
  if (!data?.length || data.length < 500) break
  const last = data[data.length-1]
  cursor = { due_at: last.due_at, id: last.id }
  }
  return { notified, skipped }
}
