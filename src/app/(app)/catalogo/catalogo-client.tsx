"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Loader2, X, Search, Package, Wrench, Repeat, History, Table2,
  TrendingUp, TrendingDown, Minus,
} from "lucide-react"
import {
  getCatalogItemHistory,
  type CatalogItem, type CatalogBilling, type CatalogItemEvent, type CatalogTablePrices, type CatalogTableCell,
} from "@/lib/actions/catalog"
import { setTableActive } from "@/lib/actions/price-lists"
import { SimpleSelect } from "@/components/ui/select"
import { unitSpec } from "@/lib/crm/units"
import { EmptyState } from "@/components/ui/empty-state"

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 })
const BILLING_LABEL: Record<CatalogBilling, string> = { one_time: "Avulso", monthly: "Mensal", yearly: "Anual" }

export type PriceTrend = { points: number[]; delta: number }

// ── Histórico de alterações do item (auditoria) ────────
const FIELD_PT: Record<string, string> = {
  created: "Item criado", price: "Preço", cost: "Custo",
  max_discount_pct: "Desconto máximo", valid_until: "Validade (legado)",
}
function fmtEventValue(field: string, v: string | null): string {
  if (v == null || v === "") return "—"
  if (field === "price" || field === "cost" || field === "created") return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
  if (field === "max_discount_pct") return `${v}%`
  if (field === "valid_until") return new Date(v + "T12:00:00").toLocaleDateString("pt-BR")
  return v
}

function HistoryDialog({ item, onClose }: { item: CatalogItem; onClose: () => void }) {
  const [events, setEvents] = useState<CatalogItemEvent[] | null>(null)
  useEffect(() => {
    let alive = true
    getCatalogItemHistory(item.id).then((r) => { if (alive) setEvents(r) }).catch(() => { if (alive) setEvents([]) })
    return () => { alive = false }
  }, [item.id])

  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100 shrink-0">
          <span className="size-8 rounded-lg bg-primary-50 text-primary-600 grid place-items-center shrink-0"><History className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-900 truncate">Histórico — {item.name}</h3>
            <p className="text-[11px] text-slate-400">Toda alteração de preço, custo e teto fica registrada, por tabela.</p>
          </div>
          <button type="button" onClick={onClose} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {events === null && <p className="text-center py-8"><Loader2 className="size-4 animate-spin inline text-slate-300" /></p>}
          {events?.length === 0 && <p className="text-xs text-slate-400 text-center py-8">Nenhuma alteração registrada ainda (o histórico passa a contar a partir de agora).</p>}
          {!!events?.length && (
            <div className="divide-y divide-slate-100">
              {events.map((e) => (
                <div key={e.id} className="py-2.5 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-800">
                      {FIELD_PT[e.field] ?? e.field}
                      {e.table_label && <span className="ml-1.5 text-[10px] font-bold text-sky-600">· {e.table_label}</span>}
                    </p>
                    <p className="text-xs text-slate-500 tabular-nums mt-0.5">
                      {e.field === "created"
                        ? <>criado com preço <b className="text-slate-700">{fmtEventValue("price", e.to_value)}</b></>
                        : <><span className="text-slate-400">{fmtEventValue(e.field, e.from_value)}</span> → <b className="text-primary-600">{fmtEventValue(e.field, e.to_value)}</b></>}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] text-slate-400 tabular-nums">{new Date(e.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
                    {e.by_name && <p className="text-[10px] text-slate-500 font-medium">{e.by_name}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Mini-gráfico de tendência (série vem da auditoria) ──────────
function Sparkline({ trend }: { trend: PriceTrend | undefined }) {
  if (!trend || trend.points.length < 2) {
    return <span className="inline-flex items-center gap-1 text-[10px] text-slate-300"><Minus className="size-3" /> estável</span>
  }
  const pts = trend.points
  const min = Math.min(...pts), max = Math.max(...pts)
  const range = max - min || 1
  const w = 56, h = 16
  const path = pts.map((v, i) => `${(i / (pts.length - 1)) * w},${h - 2 - ((v - min) / range) * (h - 4)}`).join(" ")
  const up = trend.delta > 0
  const pct = pts[pts.length - 2] ? Math.abs((trend.delta / pts[pts.length - 2]) * 100) : 0
  return (
    <span className="inline-flex items-center gap-1.5" title={`Últimos preços: ${pts.map((p) => BRL(p)).join(" → ")}`}>
      <svg width={w} height={h} className="shrink-0">
        <polyline points={path} fill="none" strokeWidth={1.5} className={trend.delta === 0 ? "stroke-slate-300" : up ? "stroke-emerald-500" : "stroke-red-400"} />
      </svg>
      {trend.delta === 0
        ? <Minus className="size-3 text-slate-300" />
        : up
          ? <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-600"><TrendingUp className="size-3" />{pct >= 0.1 ? `+${pct.toFixed(pct >= 10 ? 0 : 1)}%` : ""}</span>
          : <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-500"><TrendingDown className="size-3" />{pct >= 0.1 ? `−${pct.toFixed(pct >= 10 ? 0 : 1)}%` : ""}</span>}
    </span>
  )
}

type Tab = "all" | "product" | "service"

export function CatalogClient({ items, trends, tablePrices, canManage }: { items: CatalogItem[]; trends: Record<string, PriceTrend>; tablePrices: CatalogTablePrices; canManage: boolean }) {
  const router = useRouter()
  const tables = tablePrices.tables
  const [tab, setTab]         = useState<Tab>("all")
  const [search, setSearch]   = useState("")
  const [historyOf, setHistoryOf] = useState<CatalogItem | null>(null)
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [bulkTable, setBulkTable] = useState<string>(tables[0]?.id ?? "")
  const [pending, startTransition] = useTransition()

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((i) => {
      if (tab !== "all" && i.type !== tab) return false
      if (q && !i.name.toLowerCase().includes(q) && !(i.sku ?? "").toLowerCase().includes(q) && !(i.category ?? "").toLowerCase().includes(q)) return false
      return true
    })
  }, [items, tab, search])

  const counts = useMemo(() => ({
    all:     items.length,
    product: items.filter((i) => i.type === "product").length,
    service: items.filter((i) => i.type === "service").length,
  }), [items])

  function toggleSelect(id: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  const allSelected = filtered.length > 0 && filtered.every((i) => selected.has(i.id))
  function toggleAll() {
    setSelected((prev) => {
      if (filtered.every((i) => prev.has(i.id))) { const n = new Set(prev); filtered.forEach((i) => n.delete(i.id)); return n }
      const n = new Set(prev); filtered.forEach((i) => n.add(i.id)); return n
    })
  }

  function apply(ids: string[], tableId: string, active: boolean) {
    if (!tableId || ids.length === 0) return
    startTransition(async () => {
      const r = await setTableActive(ids, tableId, active)
      if ("error" in r) { toast.error(r.error); return }
      const tName = tables.find((t) => t.id === tableId)?.name ?? "tabela"
      toast.success(`${r.changed} ${r.changed === 1 ? "produto" : "produtos"} ${active ? "ativado(s)" : "desativado(s)"} em ${tName}`)
      router.refresh()
    })
  }
  const toggleCell = (itemId: string, tableId: string, active: boolean) => apply([itemId], tableId, !active)

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-lg shrink-0">
          <TabBtn active={tab === "all"}     onClick={() => setTab("all")}     label="Todos"    count={counts.all} />
          <TabBtn active={tab === "product"} onClick={() => setTab("product")} label="Produtos" count={counts.product} />
          <TabBtn active={tab === "service"} onClick={() => setTab("service")} label="Serviços" count={counts.service} />
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="size-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome, identificador ou categoria…"
            className="w-full h-9 pl-9 pr-9 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 size-5 grid place-items-center rounded text-slate-400 hover:bg-slate-100">
              <X className="size-3" />
            </button>
          )}
        </div>
        {canManage && (
          <Link href="/catalogo/tabelas"
            className="ml-auto inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors shrink-0">
            <Table2 className="size-3.5" /> Gerenciar nas tabelas
          </Link>
        )}
      </div>

      {/* edição em massa — só Gerenciar + com seleção */}
      {canManage && selected.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap px-3 py-2 bg-primary-50 border border-primary-100 rounded-lg">
          <span className="text-xs font-bold text-primary-700">{selected.size} selecionado{selected.size !== 1 ? "s" : ""}</span>
          <span className="text-[11px] text-slate-500">na tabela</span>
          <SimpleSelect value={bulkTable} onChange={setBulkTable} className="h-7 w-36 text-[11px]"
            options={tables.map((t) => ({ value: t.id, label: t.name }))} />
          <button type="button" disabled={pending || !bulkTable} onClick={() => apply([...selected], bulkTable, true)}
            className="inline-flex items-center h-7 px-2.5 text-[11px] font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">Ativar</button>
          <button type="button" disabled={pending || !bulkTable} onClick={() => apply([...selected], bulkTable, false)}
            className="inline-flex items-center h-7 px-2.5 text-[11px] font-semibold rounded-md bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50">Desativar</button>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-[11px] font-semibold text-slate-500 hover:text-slate-800">Limpar</button>
        </div>
      )}

      {/* matriz produto × tabela */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={tab === "service" ? Wrench : Package}
          title={search ? "Nada encontrado" : "Seu catálogo está vazio"}
          description={search ? "Tente outro termo de busca." : "Cadastre produtos e serviços na tabela de preço — o catálogo mostra tudo aqui, com histórico e tendência."}
          action={!search && canManage ? (
            <Link href="/catalogo/tabelas"
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
              <Table2 className="size-3.5" /> Abrir tabelas de preço
            </Link>
          ) : undefined}
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] text-slate-500 bg-slate-50/60">
                  {canManage && (
                    <th className="w-9 pl-4 pr-1 py-2.5">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Selecionar todos"
                        className="size-3.5 rounded border-slate-300 accent-primary align-middle" />
                    </th>
                  )}
                  <th className="text-left font-medium py-2.5 px-4">Item</th>
                  <th className="text-left font-medium py-2.5 px-3 hidden sm:table-cell">Identificador</th>
                  <th className="text-left font-medium py-2.5 px-3">Cobrança</th>
                  {tables.map((tb) => (
                    <th key={tb.id} className="text-right font-medium py-2.5 px-3 whitespace-nowrap">
                      {tb.name}
                      {tb.is_default && <span className="ml-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">padrão</span>}
                    </th>
                  ))}
                  <th className="text-left font-medium py-2.5 px-3 hidden md:table-cell">Tendência</th>
                  <th className="text-left font-medium py-2.5 px-3 hidden md:table-cell">Desc. máx</th>
                  <th className="text-left font-medium py-2.5 px-3 hidden lg:table-cell">Uso</th>
                  <th className="text-right font-medium py-2.5 px-4">Histórico</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <Row key={item.id} item={item} tables={tables} cellRow={tablePrices.cells[item.id]} trend={trends[item.id]}
                    canManage={canManage} selected={selected.has(item.id)} onToggleSelect={() => toggleSelect(item.id)}
                    onToggleCell={toggleCell} pending={pending} onHistory={() => setHistoryOf(item)} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-400 px-4 py-2.5 border-t border-slate-100 bg-slate-50/40">
            {canManage
              ? <>Clique numa célula pra <b className="text-slate-500">ligar/desligar</b> o produto naquela tabela; selecione vários pra editar em massa. Criar produto e preço, nas <Link href="/catalogo/tabelas" className="text-primary-600 font-semibold hover:underline">tabelas de preço</Link>. Tudo auditado.</>
              : <>O catálogo é a <b className="text-slate-500">vitrine</b> — leitura dos preços por tabela.</>}
          </p>
        </div>
      )}

      {historyOf && <HistoryDialog item={historyOf} onClose={() => setHistoryOf(null)} />}
    </div>
  )
}

function TabBtn({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-md transition-colors ${active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
      {label}
      <span className={`text-[10px] tabular-nums ${active ? "text-slate-400" : "text-slate-400/70"}`}>{count}</span>
    </button>
  )
}

function Row({ item, tables, cellRow, trend, canManage, selected, onToggleSelect, onToggleCell, pending, onHistory }: {
  item: CatalogItem; tables: CatalogTablePrices["tables"]; cellRow: Record<string, CatalogTableCell> | undefined
  trend: PriceTrend | undefined; canManage: boolean; selected: boolean; onToggleSelect: () => void
  onToggleCell: (itemId: string, tableId: string, active: boolean) => void; pending: boolean; onHistory: () => void
}) {
  const TypeIcon  = item.type === "service" ? Wrench : Package
  const recurring = item.billing !== "one_time"
  const unitSym = item.unit && item.unit !== "un" ? unitSpec(item.unit).symbol : null

  return (
    <tr className={`border-b border-slate-100 last:border-0 transition-colors ${selected ? "bg-primary-50/40" : item.active ? "hover:bg-slate-50/50" : "bg-slate-50/40 opacity-60"}`}>
      {canManage && (
        <td className="pl-4 pr-1">
          <input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`Selecionar ${item.name}`}
            className="size-3.5 rounded border-slate-300 accent-primary align-middle" />
        </td>
      )}
      <td className="py-2.5 px-4">
        <div className="flex items-center gap-2.5 min-w-0">
          {item.image_path ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={`/api/catalog-image/${item.id}`} alt="" className="size-8 rounded-lg object-cover shrink-0 ring-1 ring-slate-200" />
          ) : (
            <span className={`size-8 rounded-lg grid place-items-center shrink-0 ${item.type === "service" ? "bg-violet-50 text-violet-500" : "bg-primary-50 text-primary-600"}`}>
              <TypeIcon className="size-3.5" />
            </span>
          )}
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-900 truncate leading-tight">
              {item.name}
              {!item.active && <span className="ml-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">arquivado</span>}
            </p>
            <p className="text-[11px] text-slate-400 truncate">
              {item.category ?? (item.type === "service" ? "Serviço" : "Produto")}
              {unitSym && <span className="text-slate-400"> · por {unitSym}</span>}
            </p>
          </div>
        </div>
      </td>
      <td className="py-2.5 px-3 hidden sm:table-cell">
        {item.sku ? <span className="font-mono text-[11px] text-slate-500">{item.sku}</span> : <span className="text-slate-300">—</span>}
      </td>
      <td className="py-2.5 px-3">
        <span className={`inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full ${recurring ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
          {recurring && <Repeat className="size-2.5" />}
          {BILLING_LABEL[item.billing]}
        </span>
      </td>
      {tables.map((tb) => {
        const cell = cellRow?.[tb.id]
        const active = !!cell && cell.active
        const body = active
          ? <span className="font-semibold text-slate-800 tabular-nums">{BRL(cell!.price)}</span>
          : <span className="text-slate-300">—</span>
        return (
          <td key={tb.id} className="py-2.5 px-3 text-right whitespace-nowrap">
            {canManage ? (
              <button type="button" disabled={pending} onClick={() => onToggleCell(item.id, tb.id, active)}
                title={active ? `Ativo em ${tb.name} — clique pra desativar` : `Fora de ${tb.name} — clique pra ativar`}
                className="group/cell inline-flex items-center gap-1.5 justify-end rounded-md px-1.5 py-0.5 hover:bg-slate-100 disabled:opacity-50">
                {body}
                <span className={`size-1.5 rounded-full shrink-0 ${active ? "bg-emerald-500" : "bg-slate-300 group-hover/cell:bg-emerald-400"}`} />
              </button>
            ) : body}
          </td>
        )
      })}
      <td className="py-2.5 px-3 hidden md:table-cell"><Sparkline trend={trend} /></td>
      <td className="py-2.5 px-3 hidden md:table-cell">
        {item.max_discount_pct > 0
          ? <span className="text-[11px] font-semibold text-slate-600 tabular-nums">até {item.max_discount_pct}%</span>
          : <span className="text-[11px] text-slate-300">sem desconto</span>}
      </td>
      <td className="py-2.5 px-3 hidden lg:table-cell">
        {item.in_use > 0
          ? <span className="text-[11px] text-slate-500 tabular-nums">{item.in_use} negócio{item.in_use !== 1 ? "s" : ""}</span>
          : <span className="text-[11px] text-slate-300">—</span>}
      </td>
      <td className="py-2.5 px-4">
        <div className="flex items-center justify-end">
          <button type="button" onClick={onHistory} title="Histórico de alterações (preço, custo, teto — por tabela)"
            className="size-7 grid place-items-center rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors">
            <History className="size-3.5" />
          </button>
        </div>
      </td>
    </tr>
  )
}
