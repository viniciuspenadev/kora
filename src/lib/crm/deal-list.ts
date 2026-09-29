import type { DealRow } from "@/lib/actions/deals"
import type { DocumentStatus } from "@/lib/commercial/documents"
import { QUOTE_TERM } from "@/lib/commercial/quote-terms"

export type DealListFocus = "" | "overdue" | "today" | "no_task" | "quote_expired" | "quote_soon" | "with_quote" | "no_quote"

/** Orçamento que representa o negócio na Lista (coluna "Orçamento"): o emitido mais recente;
 *  sem nenhum emitido, o rascunho. `others` = outros emitidos não anulados (o "+N"). */
export interface DealQuoteMini {
  id: string; code: string; status: DocumentStatus; validUntil: string | null; others: number
}
export interface DealQuoteDoc { id: string; code: string; status: DocumentStatus; validUntil: string | null; createdAt: string }

/** Anulados já vêm fora. Emitido = qualquer status que não seja rascunho. */
export function pickDealQuote(docs: DealQuoteDoc[]): DealQuoteMini | null {
  if (!docs.length) return null
  const recent = [...docs].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  const issued = recent.filter((d) => d.status !== "draft")
  const pick = issued[0] ?? recent[0]
  return { id: pick.id, code: pick.code, status: pick.status, validUntil: pick.validUntil, others: issued.length ? issued.length - 1 : 0 }
}

/** Dias entre hoje (fuso local) e a validade `yyyy-mm-dd`: negativo = vencido. */
function daysUntil(validUntil: string, now: number): number | null {
  const [y, m, d] = validUntil.split("-").map(Number)
  if (!y || !m || !d) return null
  const today = new Date(now)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86_400_000)
}

export type QuoteSituationKey = "none" | "draft" | "expired" | "soon" | "open" | "accepted" | "declined" | "signed"
export function quoteSituation(q: DealQuoteMini | null | undefined, now: number): { key: QuoteSituationKey; label: string; tone: "danger" | "warning" | "success" | "neutral" | "muted" } {
  if (!q) return { key: "none", label: "—", tone: "muted" }
  if (q.status === "draft") return { key: "draft", label: QUOTE_TERM.status.draft, tone: "muted" }
  if (q.status === "accepted") return { key: "accepted", label: QUOTE_TERM.status.accepted, tone: "success" }
  if (q.status === "signed") return { key: "signed", label: QUOTE_TERM.status.signed, tone: "success" }
  if (q.status === "declined") return { key: "declined", label: QUOTE_TERM.status.declined, tone: "neutral" }
  const status = QUOTE_TERM.status[q.status]
  const days = q.validUntil ? daysUntil(q.validUntil, now) : null
  if (days === null) return { key: "open", label: status, tone: "neutral" }
  if (days < 0) return { key: "expired", label: `${QUOTE_TERM.expiredState} há ${-days} ${days === -1 ? "dia" : "dias"}`, tone: "danger" }
  if (days <= 7) return { key: "soon", label: days === 0 ? "Vence hoje" : `Vence em ${days} ${days === 1 ? "dia" : "dias"}`, tone: "warning" }
  const [, m, d] = q.validUntil!.split("-")
  return { key: "open", label: `${status} · vence ${d}/${m}`, tone: "neutral" }
}
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
    if (filters.focus.startsWith("quote_") || filters.focus === "with_quote" || filters.focus === "no_quote") {
      const key = quoteSituation(d.quote, now).key
      if (filters.focus === "quote_expired" && key !== "expired") return false
      if (filters.focus === "quote_soon" && key !== "soon") return false
      if (filters.focus === "with_quote" && (key === "none" || key === "draft")) return false
      if (filters.focus === "no_quote" && key !== "none" && key !== "draft") return false
    }
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
  // The detail backlink may only return to this local list or board, never an arbitrary URL.
  return value?.startsWith("/negocios?") ? value : "/negocios"
}

/** Planilha da Lista: as mesmas linhas filtradas/ordenadas que a pessoa está vendo. */
export function dealListCsvRows(deals: DealRow[], now: number): string[][] {
  const day = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString("pt-BR") : ""
  const status: Record<string, string> = { open: "Aberto", won: "Ganho", lost: "Perdido", canceled: "Cancelado" }
  const header = ["Negócio", "Cliente", "Empresa", "Funil", "Etapa", "Situação", "Valor", "Responsável", "Próxima ação", "Prazo da ação",
    QUOTE_TERM.one, `Situação ${QUOTE_TERM.ofThe}`, "Validade", "Atualizado"]
  return [header, ...deals.map((d) => [
    d.name?.trim() || "Negócio sem nome", d.contact_name ?? "", d.company_name ?? "", d.pipeline_name ?? "", d.stage?.name ?? "",
    status[d.status] ?? d.status,
    d.estimated_value == null ? "" : Number(d.estimated_value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
    d.assigned_to ? d.responsible ?? "" : "", d.next_task?.title ?? "", day(d.next_task?.due_at),
    d.quote?.code ?? "", d.quote ? quoteSituation(d.quote, now).label : "", d.quote?.validUntil ? day(`${d.quote.validUntil}T12:00:00`) : "",
    day(d.updated_at),
  ])]
}
