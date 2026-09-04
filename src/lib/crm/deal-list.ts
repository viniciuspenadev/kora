import type { DealRow } from "@/lib/actions/deals"

export type DealListFocus = "" | "overdue" | "today" | "no_task"
export type DealListSort = "updated_desc" | "updated_asc" | "value_desc" | "value_asc" | "name_asc" | "next_action"
export interface DealListFilters {
  search: string
  pipeline: string
  stage: string
  status: string
  responsible: string
  unit: string
  focus: DealListFocus
}

export const DEAL_LIST_SORTS: { value: DealListSort; label: string }[] = [
  { value: "updated_desc", label: "Atualizados recentemente" },
  { value: "updated_asc", label: "Sem atualização há mais tempo" },
  { value: "value_desc", label: "Maior valor" },
  { value: "value_asc", label: "Menor valor" },
  { value: "name_asc", label: "Nome de A a Z" },
  { value: "next_action", label: "Próxima ação primeiro" },
]

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")
const date = (value: string | null | undefined) => {
  const time = value ? Date.parse(value) : NaN
  return Number.isFinite(time) ? time : null
}

export function taskTiming(deal: DealRow, now: number): "overdue" | "today" | "upcoming" | "undated" | "none" | "closed" {
  if (deal.status !== "open") return "closed"
  if (!deal.next_task) return "none"
  const due = date(deal.next_task.due_at)
  if (due === null) return "undated"
  if (due < now) return "overdue"
  return new Date(due).toDateString() === new Date(now).toDateString() ? "today" : "upcoming"
}

export function filterDealList(deals: DealRow[], filters: DealListFilters, now: number): DealRow[] {
  const query = normalize(filters.search.trim())
  return deals.filter((d) => {
    if (filters.pipeline && d.pipeline_id !== filters.pipeline) return false
    if (filters.stage && d.stage?.id !== filters.stage) return false
    if (filters.status && d.status !== filters.status) return false
    if (filters.responsible === "none" ? d.assigned_to != null : filters.responsible && d.assigned_to !== filters.responsible) return false
    if (filters.unit === "none" ? d.unit_id != null : filters.unit && d.unit_id !== filters.unit) return false
    if (query && !normalize([d.name, d.contact_name, d.company_name].filter(Boolean).join(" ")).includes(query)) return false
    const timing = taskTiming(d, now)
    if (filters.focus === "overdue" && timing !== "overdue") return false
    if (filters.focus === "today" && timing !== "today" && !(timing === "overdue" && new Date(d.next_task!.due_at!).toDateString() === new Date(now).toDateString())) return false
    if (filters.focus === "no_task" && timing !== "none") return false
    return true
  })
}

export function sortDealList(deals: DealRow[], sort: DealListSort): DealRow[] {
  // Missing values always follow real values, in either direction. Never mutate props.
  const compare = (a: number | null, b: number | null, direction = 1) => a === null ? (b === null ? 0 : 1) : b === null ? -1 : (a - b) * direction
  return [...deals].sort((a, b) => {
    let order = 0
    if (sort === "name_asc") order = (a.name?.trim() || "Negócio sem nome").localeCompare(b.name?.trim() || "Negócio sem nome", "pt-BR", { sensitivity: "base", numeric: true })
    else if (sort === "value_desc" || sort === "value_asc") order = compare(a.estimated_value, b.estimated_value, sort === "value_desc" ? -1 : 1)
    else if (sort === "next_action") order = compare(a.status === "open" ? date(a.next_task?.due_at) : null, b.status === "open" ? date(b.next_task?.due_at) : null)
    else order = compare(date(a.updated_at), date(b.updated_at), sort === "updated_asc" ? 1 : -1)
    return order || a.id.localeCompare(b.id)
  })
}

export function dealStageDays(deal: DealRow, now: number): number | null {
  const entered = date(deal.stage_entered_at)
  return deal.status === "open" && entered !== null ? Math.max(0, Math.floor((now - entered) / 86_400_000)) : null
}

export function dealListReturnHref(value: string | null): string {
  // The detail backlink may only return to this local list, never an arbitrary URL.
  return value?.startsWith("/negocios?") ? value : "/negocios"
}
