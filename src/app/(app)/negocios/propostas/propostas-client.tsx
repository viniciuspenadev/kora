"use client"

import { useState, useTransition, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { FileText, Loader2, CircleDollarSign, MailQuestion, CalendarClock, Search, MoreVertical, Check, X, ExternalLink, UserRound, Eye, Download, Plus } from "lucide-react"
import { SimpleSelect } from "@/components/ui/select"
import { FilterPill, PILL_SELECT } from "@/components/ui/filter-pills"
import { SectionCard } from "@/components/ui/section-card"
import { KpiTile } from "@/components/ui/kpi-tile"
import { DataTable, type Column } from "@/components/ui/data-table"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { StatusChip, brlCents, shortDate } from "@/components/crm/quote-status"
import { QuoteViewer } from "@/components/crm/quote-viewer"
import { NovaPropostaWizard } from "@/components/crm/nova-proposta-wizard"
import { markQuoteAccepted, markQuoteDeclined } from "@/lib/actions/documents"
import {
  getProposals, exportProposalsCsv, type ProposalRow, type ProposalsPage, type ProposalsSummary,
  type ProposalSort, type ProposalSortBy, type ProposalFilters,
} from "@/lib/actions/proposals"

type StatusFilter = NonNullable<ProposalFilters["status"]>

const daysSince = (iso: string | null) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : 0
/** Decidir (aceita/recusada) só vale pra proposta EMITIDA e ainda em aberto. */
const canAct = (s: ProposalRow["status"]) => s === "active" || s === "sent"

const COLUMNS: Column<ProposalRow>[] = [
  { id: "code", header: "Proposta", width: "150px", mobile: true,
    cell: (p) => <span className="font-mono text-xs font-semibold text-slate-600 tabular-nums">{p.code}</span> },
  { id: "client", header: "Cliente / Negócio", width: "minmax(200px,1fr)", mobile: true,
    cell: (p) => (
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{p.contactName ?? "—"}</p>
        <p className="text-xs text-slate-400 truncate">
          {p.dealName ?? (p.dealId ? "—" : "Negócio removido")}
          {p.sellerName && <span className="text-slate-300"> · {p.sellerName}</span>}
        </p>
      </div>
    ) },
  { id: "value", header: "Valor", width: "160px", align: "right", mobile: true, sortKey: "value",
    cell: (p) => <span className="text-[15px] font-bold text-slate-900 tabular-nums">{brlCents(p.totalCents)}</span> },
  { id: "sp", header: "", width: "28px", cell: () => null },   // respiro Valor ↔ Status
  { id: "status", header: "Status", width: "150px", mobile: true, sortKey: "status",
    cell: (p) => {
      const aging = canAct(p.status) ? daysSince(p.sentAt ?? p.createdAt) : 0
      return (
        <div className="leading-tight">
          <StatusChip status={p.status} validUntil={p.validUntil} />
          {aging >= 3 && <p className={`text-[10px] mt-1 tabular-nums ${aging >= 7 ? "text-amber-600 font-medium" : "text-slate-400"}`}>parada há {aging}d</p>}
        </div>
      )
    } },
  { id: "dates", header: "Válida até", width: "148px", sortKey: "valid",
    cell: (p) => (
      <div className="leading-tight">
        <p className="text-xs text-slate-600 tabular-nums">{shortDate(p.validUntil)}</p>
        <p className="text-[11px] text-slate-400 tabular-nums">{p.sentAt ? `env. ${shortDate(p.sentAt)}` : "não enviada"}</p>
      </div>
    ) },
]

type Quick = null | "soon" | "expired" | "stale"   // chips rápidos (exclusivos)
interface Over { status?: StatusFilter; sort?: ProposalSort; quick?: Quick; agentId?: string; search?: string }

export function PropostasClient({ initial, summary, agents }: {
  initial: ProposalsPage; summary: ProposalsSummary; agents: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [items, setItems]     = useState<ProposalRow[]>(initial.items)
  const [cursor, setCursor]   = useState(initial.nextCursor)
  const [hasMore, setHasMore] = useState(initial.hasMore)
  const [status, setStatus]   = useState<StatusFilter>("open")
  const [sort, setSort]       = useState<ProposalSort>({ by: "valid", dir: "asc" })   // vencendo primeiro
  const [quick, setQuick]     = useState<Quick>(null)     // chip ativo (sobrepõe status)
  const [agentId, setAgentId] = useState("")              // "" = todos
  const [search, setSearch]   = useState("")
  const [pending, start]      = useTransition()
  const [loadingMore, setLoadingMore] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [novaOpen, setNovaOpen] = useState(false)
  const [viewer, setViewer]   = useState<Pick<ProposalRow, "id" | "code" | "status" | "validUntil"> | null>(null)

  async function onExport() {
    if (exporting) return
    setExporting(true)
    const r = await exportProposalsCsv({ filters: filtersFor({}), sort })
    if ("error" in r) toast.error(r.error)
    else {
      const url = URL.createObjectURL(new Blob([r.csv], { type: "text/csv;charset=utf-8" }))
      const a = document.createElement("a")
      a.href = url; a.download = `propostas-${new Date().toISOString().slice(0, 10)}.csv`
      a.click(); URL.revokeObjectURL(url)
    }
    setExporting(false)
  }

  function filtersFor(over: Over): ProposalFilters {
    const qk = over.quick !== undefined ? over.quick : quick
    const ag = over.agentId !== undefined ? over.agentId : agentId
    const sr = (over.search ?? search).trim()
    const base: ProposalFilters =
      qk === "soon"    ? { expiringDays: 7 }
      : qk === "expired" ? { expired: true }
      : qk === "stale"   ? { staleDays: 7 }
      : { status: over.status ?? status }
    if (ag) base.agentId = ag
    if (sr) base.search = sr
    return base
  }

  function reload(next: Over) {
    const so = next.sort ?? sort
    start(async () => {
      const r = await getProposals({ filters: filtersFor(next), sort: so, limit: 30 })
      setItems(r.items); setCursor(r.nextCursor); setHasMore(r.hasMore)
    })
  }

  // Clique no cabeçalho: mesma coluna → inverte direção; nova coluna → default
  // (valor começa "maior primeiro", validade/status em ordem crescente).
  function onSort(key: string) {
    const by = key as ProposalSortBy
    const next: ProposalSort = sort.by === by
      ? { by, dir: sort.dir === "asc" ? "desc" : "asc" }
      : { by, dir: by === "value" ? "desc" : "asc" }
    setSort(next); reload({ sort: next })
  }

  // Busca com debounce 300ms (padrão de lista do projeto). Ignora o 1º render.
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    const t = setTimeout(() => reload({ search }), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  async function loadMore() {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    const r = await getProposals({ filters: filtersFor({}), sort, cursor, limit: 30 })
    setItems((prev) => [...prev, ...r.items]); setCursor(r.nextCursor); setHasMore(r.hasMore)
    setLoadingMore(false)
  }

  // ── Ações na linha (reúso do motor de documentos) ────────────────────
  // ⚠️ Envio via WhatsApp (Cobrar/Reenviar) REMOVIDO por ora: precisa tratar dual-stack
  // (oficial=template fora da janela · não-oficial=texto EDITÁVEL antes de enviar). Volta
  // quando desenharmos o preview editável + seleção de template.
  async function doMark(p: ProposalRow, kind: "accepted" | "declined") {
    const r = kind === "accepted" ? await markQuoteAccepted(p.id) : await markQuoteDeclined(p.id)
    if ("error" in r) return toast.error(r.error)
    setItems((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: kind } : x)))
    toast.success(kind === "accepted" ? "Marcada como aceita." : "Marcada como recusada.")
  }

  const actionsCol: Column<ProposalRow> = {
    id: "actions", header: "", width: "44px", align: "center",
    cell: (p) => (
      <div onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger title="Ações" className="size-8 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
            <MoreVertical className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {p.code !== "Rascunho" && (
              <>
                <DropdownMenuItem onClick={() => setViewer(p)}><Eye className="size-3.5" /> Ver proposta</DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {canAct(p.status) && (
              <>
                <DropdownMenuItem onClick={() => doMark(p, "accepted")}><Check className="size-3.5 text-emerald-600" /> Marcar aceita</DropdownMenuItem>
                <DropdownMenuItem onClick={() => doMark(p, "declined")}><X className="size-3.5 text-red-600" /> Marcar recusada</DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem disabled={!p.dealId} onClick={() => p.dealId && router.push(`/negocios/${p.dealId}`)}>
              <ExternalLink className="size-3.5" /> Abrir negócio
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    ),
  }

  return (
    <div className="min-h-full bg-canvas">
      {/* Header (§2.1) — título + export; filtros descem pra a toolbar da lista */}
      <div className="px-4 sm:px-6 pt-10 pb-8 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Propostas</h1>
            {pending && <Loader2 className="size-4 animate-spin text-slate-400 shrink-0" />}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">Acompanhe e cobre as cotações de todos os negócios.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={onExport} disabled={exporting}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg transition-colors disabled:opacity-50">
            {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />} Exportar CSV
          </button>
          <button type="button" onClick={() => setNovaOpen(true)}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
            <Plus className="size-3.5" /> Nova proposta
          </button>
        </div>
      </div>

      <div className="px-4 sm:px-6 pb-8 space-y-4">
        {/* KPIs — primitivo KpiTile (padrão da Agenda: cor no ícone, número slate-900) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <KpiTile icon={CircleDollarSign} iconClass="text-primary-600" label="Em aberto"
            value={brlCents(summary.openTotalCents)} caption="ativas + enviadas" />
          <KpiTile icon={MailQuestion} iconClass="text-sky-500" label="Aguardando resposta"
            value={String(summary.awaiting)} caption="propostas emitidas sem decisão" />
          <KpiTile icon={CalendarClock} iconClass="text-amber-600" label="Vencendo em 7 dias"
            value={String(summary.expiringSoon)} caption="clique pra filtrar" active={quick === "soon"}
            onClick={() => { const nk: Quick = quick === "soon" ? null : "soon"; setQuick(nk); reload({ quick: nk }) }} />
        </div>

        {/* Toolbar: busca (esquerda) + atendente + status + ordenação (direita) */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por cliente ou negócio…"
              className="w-full h-9 pl-9 pr-3 text-sm bg-white border border-slate-200 rounded-lg placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary-300" />
          </div>
          {agents.length > 0 && (
            <FilterPill icon={UserRound} w="w-48">
              <SimpleSelect className={PILL_SELECT} value={agentId}
                onChange={(v) => { setAgentId(v); reload({ agentId: v }) }}
                options={[{ value: "", label: "Todos os atendentes" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} />
            </FilterPill>
          )}
          <FilterPill icon={FileText} w="w-40">
            <SimpleSelect className={PILL_SELECT} value={quick ? "open" : status}
              onChange={(v) => { setQuick(null); setStatus(v as StatusFilter); reload({ status: v as StatusFilter, quick: null }) }}
              options={[
                { value: "open",     label: "Em aberto" },
                { value: "all",      label: "Todas" },
                { value: "sent",     label: "Enviadas" },
                { value: "active",   label: "Ativas" },
                { value: "accepted", label: "Aceitas" },
                { value: "declined", label: "Recusadas" },
              ]} />
          </FilterPill>
        </div>

        {/* Chips rápidos — recortes de cobrança de 1 clique */}
        <div className="flex flex-wrap items-center gap-1.5">
          {([["expired", "Vencidas"], ["soon", "Vencendo"], ["stale", "Aguardando +7d"]] as [Exclude<Quick, null>, string][]).map(([k, lbl]) => {
            const on = quick === k
            return (
              <button key={k} type="button"
                onClick={() => { const nk: Quick = on ? null : k; setQuick(nk); reload({ quick: nk }) }}
                className={`h-7 px-3 text-xs font-semibold rounded-full border transition-colors ${on ? "bg-primary text-white border-primary" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}`}>
                {lbl}
              </button>
            )
          })}
        </div>

        {/* Lista */}
        <SectionCard flush>
          <DataTable
            rows={items}
            columns={[...COLUMNS, actionsCol]}
            sort={{ key: sort.by, dir: sort.dir }}
            onSort={onSort}
            rowKey={(p) => p.id}
            onRowClick={(p) => { if (p.dealId) router.push(`/negocios/${p.dealId}`) }}
            empty={{ icon: FileText, title: "Nenhuma proposta aqui", description: "As cotações geradas nos negócios aparecem aqui pra acompanhamento e cobrança." }}
          />
          {hasMore && (
            <div className="p-3 border-t border-slate-100 flex justify-center">
              <button type="button" onClick={loadMore} disabled={loadingMore}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg transition-colors disabled:opacity-50">
                {loadingMore && <Loader2 className="size-3.5 animate-spin" />} Carregar mais
              </button>
            </div>
          )}
        </SectionCard>
      </div>

      {viewer && <QuoteViewer id={viewer.id} code={viewer.code} status={viewer.status} validUntil={viewer.validUntil} onClose={() => setViewer(null)} />}
      {novaOpen && <NovaPropostaWizard onClose={() => setNovaOpen(false)} />}
    </div>
  )
}
