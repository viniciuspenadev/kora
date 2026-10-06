"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowUpRight, Building2, CalendarClock, Check, ChevronLeft, ChevronRight, Clock3, Download, FileText, Filter, ListFilter, SearchX, X } from "lucide-react"
import type { DealRow, DealsPageData } from "@/lib/actions/deals"
import { QuoteViewer } from "@/components/crm/quote-viewer"
import { QUOTE_TERM } from "@/lib/commercial/quote-terms"
import { downloadCsv } from "@/lib/csv"
import { DataTable, type Column, type SortState } from "@/components/ui/data-table"
import { SectionCard } from "@/components/ui/section-card"
import { EmptyState } from "@/components/ui/empty-state"
import { FormRow } from "@/components/ui/form-row"
import { SimpleSelect } from "@/components/ui/select"
import { StatusDot } from "@/components/ui/status-dot"
import { Toolbar, FilterChip } from "@/components/ui/toolbar"
import { UserAvatar } from "@/components/ui/user-avatar"
import { dealListCsvRows, dealStageDays, DEAL_LIST_SORTS, filterDealList, quoteSituation, sortDealList, taskTiming, type DealListFilters, type DealListFocus, type DealListSort, type DealQuoteMini } from "@/lib/crm/deal-list"

const money = (value: number) => Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const count = (value: number) => value.toLocaleString("pt-BR")
const button = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
const statusOptions = [{ value: "", label: "Todos" }, { value: "open", label: "Abertos" }, { value: "won", label: "Ganhos" }, { value: "lost", label: "Perdidos" }, { value: "canceled", label: "Cancelados" }]
const focusOptions = [{ value: "overdue", label: "Ação atrasada" }, { value: "today", label: "Ação para hoje" }, { value: "no_task", label: "Sem próxima ação" }] as const
// Cobrança de orçamento (a página Propostas foi absorvida pela Lista — dono, 29/09/2026).
const quoteFocusOptions = [{ value: "quote_expired", label: QUOTE_TERM.expired }, { value: "quote_soon", label: QUOTE_TERM.expiringSoon }, { value: "with_quote", label: QUOTE_TERM.with }, { value: "no_quote", label: QUOTE_TERM.without }] as const
const allFocus = [...focusOptions, ...quoteFocusOptions]
const toneClass = { danger: "text-red-600 font-medium", warning: "text-amber-700 font-medium", success: "text-emerald-700 font-medium", neutral: "text-slate-500", muted: "text-slate-400" } as const
const filterKeys = ["q", "pipeline", "stage", "status", "responsible", "unit", "focus", "page"]

function shortDate(iso: string) {
  const value = new Date(iso)
  return Number.isNaN(value.getTime()) ? "—" : value.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).replaceAll(" de ", " ")
}

export function DealsList({ data, onShowBoard }: { data: DealsPageData; onShowBoard: () => void }) {
  const params = useSearchParams()
  const router = useRouter()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [viewer, setViewer] = useState<DealQuoteMini | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer) }, [])
  const filters = useMemo<DealListFilters>(() => ({
    search: params.get("q") ?? "", pipeline: params.get("pipeline") ?? "", stage: params.get("stage") ?? "",
    status: statusOptions.some((s) => s.value === params.get("status")) ? params.get("status")! : "",
    responsible: params.get("responsible") ?? "", unit: params.get("unit") ?? "",
    focus: allFocus.some((f) => f.value === params.get("focus")) ? params.get("focus") as DealListFocus : "",
  }), [params])
  const sort: DealListSort = DEAL_LIST_SORTS.some((s) => s.value === params.get("sort")) ? params.get("sort") as DealListSort : "updated_desc"
  const pageSize = [25, 50, 100].includes(Number(params.get("pageSize"))) ? Number(params.get("pageSize")) : 25
  const requestedPage = Math.max(1, Math.floor(Number(params.get("page")) || 1))
  const filtered = useMemo(() => filterDealList(data.deals, filters, now), [data.deals, filters, now])
  const sorted = useMemo(() => sortDealList(filtered, sort), [filtered, sort])
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const page = Math.min(requestedPage, pages)
  const rows = sorted.slice((page - 1) * pageSize, page * pageSize)
  const value = filtered.reduce((sum, d) => sum + Number(d.estimated_value ?? 0), 0)
  const missingValues = filtered.filter((d) => d.estimated_value == null).length
  const hasFilters = Object.values(filters).some(Boolean)
  const advancedCount = [filters.pipeline, filters.stage, filters.responsible, filters.unit].filter(Boolean).length
  const pipes = useMemo(() => {
    const items = new Map(data.pipelines.map((p) => [p.id, p.name]))
    for (const d of data.deals) if (d.pipeline_id && !items.has(d.pipeline_id)) items.set(d.pipeline_id, d.pipeline_name ?? "Funil arquivado")
    return [...items].map(([value, label]) => ({ value, label }))
  }, [data.pipelines, data.deals])
  const stages = useMemo(() => {
    const items = new Map<string, { value: string; label: string; group: string }>()
    for (const d of data.deals) if (d.stage && (!filters.pipeline || d.pipeline_id === filters.pipeline)) {
      items.set(d.stage.id, { value: d.stage.id, label: d.stage.name, group: d.pipeline_name ?? "Sem funil" })
    }
    return [...items.values()]
  }, [data.deals, filters.pipeline])
  const agents = useMemo(() => {
    const items = new Map(data.agents.map((a) => [a.id, a.name]))
    for (const d of data.deals) if (d.assigned_to && !items.has(d.assigned_to)) items.set(d.assigned_to, d.responsible ?? "Usuário indisponível")
    return [...items].map(([value, label]) => ({ value, label }))
  }, [data.agents, data.deals])

  function update(updates: Record<string, string>) {
    const next = new URLSearchParams(window.location.search)
    next.set("view", "list")
    next.delete("page")
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    window.history.replaceState(null, "", `/negocios?${next.toString()}`)
    scrollRef.current?.scrollTo({ top: 0 })
  }
  function clearFilters() { update(Object.fromEntries(filterKeys.map((key) => [key, ""]))) }
  const activeChips = [
    filters.pipeline && { key: "pipeline", label: pipes.find((p) => p.value === filters.pipeline)?.label ?? "Funil selecionado" },
    filters.stage && { key: "stage", label: stages.find((s) => s.value === filters.stage)?.label ?? "Etapa selecionada" },
    filters.responsible && { key: "responsible", label: filters.responsible === "none" ? "Sem responsável" : agents.find((a) => a.value === filters.responsible)?.label ?? "Responsável selecionado" },
    filters.unit && { key: "unit", label: filters.unit === "none" ? "Sem unidade" : data.units.find((u) => u.id === filters.unit)?.name ?? "Unidade selecionada" },
  ].filter((chip): chip is { key: string; label: string } => !!chip)

  const sortState: SortState = sort.startsWith("value") ? { key: "value", dir: sort === "value_asc" ? "asc" : "desc" }
    : sort.startsWith("updated") ? { key: "updated", dir: sort === "updated_asc" ? "asc" : "desc" }
    : { key: sort === "name_asc" ? "name" : "next_action", dir: "asc" }
  function sortColumn(key: string) {
    const next = key === "value" ? (sort === "value_desc" ? "value_asc" : "value_desc")
      : key === "updated" ? (sort === "updated_desc" ? "updated_asc" : "updated_desc") : key === "name" ? "name_asc" : "next_action"
    update({ sort: next })
  }
  const detailHref = (d: DealRow) => `/negocios/${d.id}?returnTo=${encodeURIComponent(`/negocios?${params.toString()}`)}`
  const columns: Column<DealRow>[] = [
    { id: "deal", header: "Negócio / cliente", width: "minmax(210px,1.7fr)", sortKey: "name", cell: (d) => <DealIdentity deal={d} href={detailHref(d)} /> },
    { id: "stage", header: "Etapa / funil", width: "minmax(155px,1.2fr)", cell: (d) => <DealStage deal={d} now={now} /> },
    { id: "task", header: "Próxima ação", width: "minmax(170px,1.3fr)", sortKey: "next_action", cell: (d) => <DealNextAction deal={d} now={now} /> },
    { id: "value", header: "Valor", width: "125px", align: "right", sortKey: "value", cell: (d) => <span className="text-sm font-semibold tabular-nums text-slate-900 whitespace-nowrap">{d.estimated_value == null ? "—" : money(d.estimated_value)}</span> },
    { id: "quote", header: QUOTE_TERM.one, width: "minmax(150px,1fr)", cell: (d) => <DealQuote deal={d} now={now} href={detailHref(d)} onOpen={setViewer} /> },
    { id: "owner", header: "Responsável", width: "minmax(140px,1fr)", cell: (d) => <DealOwner deal={d} unit={data.units.find((u) => u.id === d.unit_id)?.name} /> },
    { id: "updated", header: "Atualizado", width: "95px", sortKey: "updated", cell: (d) => <time dateTime={d.updated_at} className="text-xs text-slate-500">{shortDate(d.updated_at)}</time> },
    { id: "mobile", header: "Negócio", width: "1fr", desktop: false, mobile: true, cell: (d) => (
      <div className="space-y-3 py-1">
        <DealIdentity deal={d} href={detailHref(d)} />
        <div className="flex items-start justify-between gap-3"><DealStage deal={d} now={now} /><span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{d.estimated_value == null ? "Sem valor" : money(d.estimated_value)}</span></div>
        <div className="rounded-lg bg-slate-50 p-3"><DealNextAction deal={d} now={now} /></div>
        {d.quote && <DealQuote deal={d} now={now} href={detailHref(d)} onOpen={setViewer} />}
        <div className="flex items-center justify-between gap-3"><DealOwner deal={d} unit={data.units.find((u) => u.id === d.unit_id)?.name} /><span className="text-right text-[11px] text-slate-400">Atualizado<br />{shortDate(d.updated_at)}</span></div>
      </div>
    ) },
  ]

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
      <div className="space-y-4">
        <Toolbar search={{ value: filters.search, onChange: (q) => update({ q }), placeholder: "Buscar negócio, contato ou empresa…" }}
          actions={<>
            <button type="button" className={`${button} ${filtersOpen || advancedCount ? "border-primary-200 text-primary-700 bg-primary-50" : ""}`} aria-expanded={filtersOpen} aria-controls="deal-list-filters" onClick={() => setFiltersOpen(!filtersOpen)}><Filter className="size-3.5" />Filtros{advancedCount > 0 && <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] text-white">{advancedCount}</span>}</button>
            <SimpleSelect value={sort} onChange={(sort) => update({ sort })} ariaLabel="Ordenar negócios" className="w-[200px] text-xs" options={DEAL_LIST_SORTS} />
            {/* Mesmas linhas filtradas/ordenadas da tela (não só a página atual). */}
            <button type="button" className={button} disabled={!sorted.length} onClick={() => downloadCsv(`negocios-${new Date(now).toISOString().slice(0, 10)}.csv`, dealListCsvRows(sorted, now))}><Download className="size-3.5" />Exportar</button>
          </>} />
        {filtersOpen && <SectionCard flush><div id="deal-list-filters" className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <FormRow label="Funil"><SimpleSelect value={filters.pipeline} ariaLabel="Filtrar por funil" onChange={(pipeline) => update({ pipeline, stage: "" })} options={[{ value: "", label: "Todos os funis" }, ...pipes]} /></FormRow>
          <FormRow label="Etapa"><SimpleSelect value={filters.stage} ariaLabel="Filtrar por etapa" onChange={(stage) => update({ stage })} options={[{ value: "", label: "Todas as etapas" }, ...stages]} /></FormRow>
          <FormRow label="Responsável"><SimpleSelect value={filters.responsible} ariaLabel="Filtrar por responsável" onChange={(responsible) => update({ responsible })} options={[{ value: "", label: "Todos os responsáveis" }, { value: "none", label: "Sem responsável" }, ...agents]} /></FormRow>
          <FormRow label="Unidade"><SimpleSelect value={filters.unit} ariaLabel="Filtrar por unidade" onChange={(unit) => update({ unit })} options={[{ value: "", label: "Todas as unidades" }, ...data.units.map((u) => ({ value: u.id, label: u.name })), { value: "none", label: "Sem unidade" }]} /></FormRow>
        </div></SectionCard>}
        {activeChips.length > 0 && <div className="flex flex-wrap items-center gap-2">{activeChips.map((chip) => <button key={chip.key} type="button" onClick={() => update(chip.key === "pipeline" ? { pipeline: "", stage: "" } : { [chip.key]: "" })} aria-label={`Remover filtro: ${chip.label}`} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-2.5 py-1.5 text-xs text-primary-700"><span className="truncate">{chip.label}</span><X className="size-3 shrink-0" /></button>)}</div>}
        <SectionCard flush>
          <div className="grid grid-cols-5 items-center border-b border-slate-200 px-2 pt-2 sm:flex sm:gap-1 sm:px-4" aria-label="Status dos negócios">
            {statusOptions.map((s) => <button key={s.value} type="button" aria-pressed={filters.status === s.value} onClick={() => update({ status: s.value, ...(s.value !== "open" && s.value !== "" ? { focus: "" } : {}) })} className={`-mb-px border-b-2 px-0 py-3 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:px-3 sm:text-xs ${filters.status === s.value ? "border-primary text-primary-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{s.label}</button>)}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
            <span className="mr-1 text-xs text-slate-500">Priorizar:</span>
            {focusOptions.map((f) => <FilterChip key={f.value} active={filters.focus === f.value} onClick={() => update({ focus: filters.focus === f.value ? "" : f.value, status: "open" })}>{f.label}</FilterChip>)}
            <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" aria-hidden />
            {quoteFocusOptions.map((f) => <FilterChip key={f.value} active={filters.focus === f.value} onClick={() => update({ focus: filters.focus === f.value ? "" : f.value, status: "open" })}>{f.label}</FilterChip>)}
            {hasFilters && <button type="button" onClick={clearFilters} className="ml-auto inline-flex h-9 items-center gap-1.5 px-2 text-xs font-medium text-slate-500 hover:text-primary-700"><X className="size-3.5" />Limpar filtros</button>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
            <p className="text-xs text-slate-600" role="status" aria-live="polite"><strong className="font-semibold text-slate-900">{count(filtered.length)}</strong> {filtered.length === 1 ? "negócio encontrado" : "negócios encontrados"}{hasFilters && <span className="text-slate-400"> · de {count(data.deals.length)}</span>}</p>
            <p className="text-xs text-slate-500">Valor estimado <strong className="ml-1 font-semibold tabular-nums text-slate-900">{money(value)}</strong>{missingValues > 0 && <span className="ml-1">· {missingValues} sem valor</span>}</p>
          </div>
          {rows.length ? <div className="overflow-x-auto"><DataTable className="md:min-w-[1265px]" rows={rows} columns={columns} rowKey={(d) => d.id} sort={sortState} onSort={sortColumn} onRowClick={(d) => router.push(detailHref(d))} /></div>
            : <EmptyState bordered={false} icon={hasFilters ? SearchX : ListFilter} title={hasFilters ? "Nenhum negócio com esses filtros" : "Sua carteira começa aqui"} description={hasFilters ? "Experimente outro termo ou remova os filtros para ampliar a busca." : "Adicione um negócio pelo Funil para acompanhar o cliente, o valor e o próximo passo."} action={<button type="button" className={button} onClick={hasFilters ? clearFilters : onShowBoard}>{hasFilters ? "Limpar filtros" : "Ir para o Funil"}</button>} />}
          {filtered.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/50 px-5 py-3">
            <div className="flex items-center gap-2"><SimpleSelect value={String(pageSize)} onChange={(pageSize) => update({ pageSize })} ariaLabel="Negócios por página" className="w-24 text-xs" options={[25, 50, 100].map((n) => ({ value: String(n), label: `${n} / pág.` }))} /><span className="text-xs tabular-nums text-slate-500">{count((page - 1) * pageSize + 1)}–{count(Math.min(page * pageSize, filtered.length))} de {count(filtered.length)}</span></div>
            <div className="flex items-center gap-2"><button type="button" className={`${button} px-2`} aria-label="Página anterior" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}><ChevronLeft className="size-4" /></button><span className="text-xs tabular-nums text-slate-600">Página {page} de {pages}</span><button type="button" className={`${button} px-2`} aria-label="Próxima página" disabled={page >= pages} onClick={() => update({ page: String(page + 1) })}><ChevronRight className="size-4" /></button></div>
          </div>}
        </SectionCard>
        {data.deals.length >= 2000 && <p className="text-xs text-slate-500">Esta visão contém os 2.000 negócios mais recentes. A busca, os filtros e os totais se aplicam a esse recorte.</p>}
      </div>
      {viewer && <QuoteViewer id={viewer.id} code={viewer.code} status={viewer.status} validUntil={viewer.validUntil} onClose={() => setViewer(null)} />}
    </div>
  )
}

// Coluna "Orçamento": ícone de PDF (abre o visualizador sem sair da Lista) + situação.
// Rascunho não tem PDF → leva à ficha. "+N" = outros emitidos → aba de orçamentos do negócio.
function DealQuote({ deal: d, now, href, onOpen }: { deal: DealRow; now: number; href: string; onOpen: (q: DealQuoteMini) => void }) {
  const q = d.quote
  if (!q) return <span className="text-xs text-slate-300">—</span>
  const s = quoteSituation(q, now)
  const draft = q.status === "draft"
  return <div className="flex min-w-0 items-start gap-2">
    {draft
      ? <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-dashed border-slate-300 text-slate-400" title={QUOTE_TERM.status.draft}><FileText className="size-4" /></span>
      : <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(q) }} title={`${QUOTE_TERM.view} ${q.code}`} aria-label={`${QUOTE_TERM.view} ${q.code}`}
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-primary-200 bg-primary-50 text-primary-700 transition-colors hover:bg-primary hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><FileText className="size-4" /></button>}
    <div className="min-w-0">
      <p className="truncate text-xs font-medium tabular-nums text-slate-700">{q.code}{q.others > 0 && <Link href={`${href}&tab=proposals`} onClick={(e) => e.stopPropagation()} className="ml-1 text-primary-700 hover:underline" title={`Mais ${q.others} — ver no negócio`}>+{q.others}</Link>}</p>
      {!draft && <p className={`mt-0.5 truncate text-[11px] ${toneClass[s.tone]}`}>{s.label}</p>}
    </div>
  </div>
}

function DealIdentity({ deal: d, href }: { deal: DealRow; href: string }) {
  return <div className="min-w-0">
    <Link href={href} onClick={(e) => e.stopPropagation()} className="group inline-flex max-w-full items-center gap-1.5 rounded text-sm font-semibold text-slate-900 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><span className="truncate" title={d.name ?? undefined}>{d.name?.trim() || "Negócio sem nome"}</span><ArrowUpRight className="size-3.5 shrink-0 text-slate-400 group-hover:text-primary-600" /></Link>
    <p className="mt-1 truncate text-xs text-slate-500" title={d.contact_name ?? undefined}>{d.contact_name ?? (d.company_name ? "Contato não vinculado" : "Sem cliente vinculado")}</p>
    {d.company_name && <p className="mt-1 flex min-w-0 items-center gap-1 text-xs text-slate-400" title={d.company_name}><Building2 className="size-3 shrink-0" /><span className="truncate">{d.company_name}</span></p>}
  </div>
}

function DealStage({ deal: d, now }: { deal: DealRow; now: number }) {
  const days = dealStageDays(d, now)
  const closed = d.status !== "open"
  return <div className="min-w-0 space-y-1.5">
    {closed ? <StatusDot size="sm" tone={d.status === "won" ? "success" : d.status === "lost" ? "danger" : "neutral"} label={d.status === "won" ? "Ganho" : d.status === "lost" ? "Perdido" : d.status === "canceled" ? "Cancelado" : "Encerrado"} />
      : <span className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700" title={d.stage?.name}><span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: d.stage?.color ?? "#64748b" }} /><span className="truncate">{d.stage?.name ?? "Sem etapa"}</span></span>}
    <p className="truncate text-xs text-slate-500" title={d.pipeline_name ?? undefined}>{d.pipeline_name ?? "Sem funil"}</p>
    {days !== null && <p className="text-[11px] text-slate-400">{days === 0 ? "Entrou hoje na etapa" : `${days} ${days === 1 ? "dia" : "dias"} na etapa`}</p>}
  </div>
}

function DealNextAction({ deal: d, now }: { deal: DealRow; now: number }) {
  const timing = taskTiming(d, now)
  if (timing === "closed") return <span className="inline-flex items-center gap-1.5 text-xs text-slate-400"><Check className="size-3.5" />Negócio encerrado</span>
  if (timing === "none") return <span className="inline-flex items-center gap-1.5 text-xs text-amber-700"><CalendarClock className="size-3.5 shrink-0" />Sem próxima ação</span>
  const overdue = timing === "overdue"
  const due = d.next_task!.due_at
  const isToday = due && new Date(due).toDateString() === new Date(now).toDateString()
  const label = !due || timing === "undated" ? "Sem prazo definido" : `${isToday ? "Hoje" : shortDate(due)} às ${new Date(due).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
  return <div className="min-w-0"><p className="truncate text-xs font-medium text-slate-700" title={d.next_task!.title}>{d.next_task!.title}</p><p className={`mt-1.5 flex items-start gap-1 text-[11px] ${overdue ? "font-medium text-red-600" : "text-slate-500"}`}><Clock3 className="mt-0.5 size-3 shrink-0" /><span>{overdue ? "Atrasada · " : ""}{label}</span></p></div>
}

function DealOwner({ deal: d, unit }: { deal: DealRow; unit?: string }) {
  return <div className="flex min-w-0 items-center gap-2"><UserAvatar userId={d.assigned_to} name={d.responsible} size={28} /><div className="min-w-0"><p className="truncate text-xs font-medium text-slate-700" title={d.responsible ?? undefined}>{d.assigned_to ? d.responsible ?? "Usuário indisponível" : "Sem responsável"}</p><p className="mt-0.5 truncate text-[11px] text-slate-400">{unit ?? (d.unit_id ? "Unidade indisponível" : "Sem unidade")}</p></div></div>
}
