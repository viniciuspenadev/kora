export type TaskStatus = "pending" | "done" | "canceled"
export type TaskPatch = { title?: string; dueAt?: string | null; assignedTo?: string; status?: TaskStatus }
export function validateTaskPatch(input: TaskPatch): string | null {
  if (input.title !== undefined && (typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 240)) return "Informe um título de até 240 caracteres."
  if (input.dueAt != null && (typeof input.dueAt !== "string" || !Number.isFinite(Date.parse(input.dueAt)))) return "Informe uma data válida."
  if (input.status !== undefined && !["pending", "done", "canceled"].includes(input.status)) return "Situação inválida."
  if (input.assignedTo !== undefined && !/^[0-9a-f-]{36}$/i.test(input.assignedTo)) return "Responsável inválido."
  return null
}
export const taskHref = (task: { deal_id: string | null; contact_id: string | null }) => task.deal_id
  ? `/negocios/${task.deal_id}?tab=activity` : task.contact_id ? `/contatos/${task.contact_id}` : "/tarefas"
export const canEditTask = (task: { assigned_to: string | null }, userId: string, isAdmin: boolean) => isAdmin || task.assigned_to === userId
