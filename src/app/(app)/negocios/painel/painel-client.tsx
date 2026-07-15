"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft, Loader2, TrendingUp, TrendingDown, Activity, ChartColumn,
  Package, Filter, Building2,
} from "lucide-react"
import { SimpleSelect } from "@/components/ui/select"
import { FilterPill, DateRangePill, PILL_SELECT, rangeOfDays, type DateRange } from "@/components/ui/filter-pills"
import { DashboardSkeletonBody } from "@/components/ui/page-skeleton"
import { ContactPic } from "@/components/chat/contact-pic"
import { UserAvatar } from "@/components/ui/user-avatar"
import { getPipelineDashboard, type PipelineDashboardData, type DashDeal, type DashStage } from "@/lib/actions/pipeline-dashboard"

// ── formatação ───────────────────────────────────────────────────
const brl  = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
const brlK = (v: number) => v >= 10_000
  ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}k`
  : brl(v)
const initials = (n: string) => n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?"
const AVA = ["#004add", "#0d9488", "#7c3aed", "#db2777", "#d97706", "#059669", "#e11d48", "#2563eb"]
const avaColor = (n: string) => AVA[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % AVA.length]
const days = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000))
const fmtDays = (d: number) => d < 1 ? "menos de 1 dia" : d === 1 ? "1 dia" : `${d} dias`

function useMeasure(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width ?? 0
      setW((prev) => (Math.abs(prev - cw) > 1 ? cw : prev))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

// ── lentes (KPI clicável recolore o painel — padrão da referência) ─
type Lens = "all" | "won" | "lost" | "open"
const LENS: Record<Lens, { color: string; soft: string; ring: string }> = {
  all:  { color: "#004add", soft: "#eef2ff", ring: "ring-primary/40 border-primary-200" },
  won:  { color: "#10b981", soft: "#ecfdf5", ring: "ring-emerald-400/40 border-emerald-300" },
  lost: { color: "#ef4444", soft: "#fef2f2", ring: "ring-red-400/40 border-red-300" },
  open: { color: "#6366f1", soft: "#eef2ff", ring: "ring-indigo-400/40 border-indigo-300" },
}
const LOSS_COLORS = ["#b91c1c", "#ef4444", "#f87171", "#fca5a5", "#dc2626", "#fecaca", "#991b1b", "#fee2e2"]
/** Donut de atendentes: escala monocromática de azul (referência do owner) — maior fatia = tom mais escuro. */
const BLUE_SHADES = ["#1e40af", "#3b82f6", "#60a5fa", "#0ea5e9", "#93c5fd", "#38bdf8", "#7dd3fc", "#bfdbfe"]

/** Linha das listas Produtos/Atendentes — colunas FIXAS (nome flexível + Vendas ·
    Ticket médio · Total) → tudo alinhado verticalmente, como a referência. */
const STAT_ROW = "grid grid-cols-[minmax(0,1fr)_56px_108px_84px] items-center gap-3 py-2.5"

export function PainelClient({ initial, initialPeriod }: { initial: PipelineDashboardData; initialPeriod: string }) {
  const router = useRouter()
  const [data, setData]   = useState(initial)
  const [range, setRange] = useState<DateRange>(() => rangeOfDays(Number(initialPeriod)))
  const [lens, setLens]   = useState<Lens>("all")
  const [byQty, setByQty] = useState(false)   // donuts: Valor | Quantidade
  const [unitFilter, setUnitFilter] = useState("")   // ""=todas · "none"=sem unidade · id
  const [pending, start]  = useTransition()

  function refetch(pipelineId: string, rg: DateRange) {
    start(async () => {
      const r = await getPipelineDashboard({
        pipelineId,
        from: new Date(rg.from + "T00:00:00").toISOString(),
        to:   new Date(rg.to + "T23:59:59").toISOString(),
      })
      if ("error" in r) { alert(r.error); return }
      setData(r)
    })
  }

  const L = LENS[lens]
  const { stages } = data
  // Cancelado = anulado: fora de TODAS as lentes e métricas (não é aberto nem perdido).
  // Fica só o rastro no chip "N cancelados no período".
  const deals = useMemo(() => data.deals.filter((d) => d.status !== "canceled"), [data.deals])
  const canceledCount = data.deals.length - deals.length

  // Recorte por unidade (client-side, instantâneo) — aplicado APÓS o filtro de
  // cancelados, ANTES de todos os memos derivados. Não afeta canceledCount (semântica
  // preservada: conta sobre data.deals bruto). ""=todas · "none"=sem unidade · id.
  const scoped = useMemo(() => {
    if (!unitFilter) return deals
    if (unitFilter === "none") return deals.filter((d) => d.unit_id == null)
    return deals.filter((d) => d.unit_id === unitFilter)
  }, [deals, unitFilter])

  // Conjunto da lente (KPIs = sempre sobre TODOS os criados no período).
  const set = useMemo(() => {
    if (lens === "won")  return scoped.filter((d) => d.status === "won")
    if (lens === "lost") return scoped.filter((d) => d.status === "lost")
    if (lens === "open") return scoped.filter((d) => d.status === "open")
    return scoped
  }, [scoped, lens])

  const kpi = useMemo(() => {
    const sum = (ds: DashDeal[]) => ds.reduce((s, d) => s + d.value, 0)
    const won = scoped.filter((d) => d.status === "won"), lost = scoped.filter((d) => d.status === "lost"), open = scoped.filter((d) => d.status === "open")
    return {
      all:  { value: sum(scoped), count: scoped.length },
      won:  { value: sum(won),   count: won.length },
      lost: { value: sum(lost),  count: lost.length },
      open: { value: sum(open),  count: open.length },
    }
  }, [scoped])

  // ── funil com velocity (entradas por etapa via path de eventos) ─
  const funnel = useMemo(() => {
    const cols = stages.filter((s) => s.show_in_kanban && !s.is_won && !s.is_lost)
    const now  = new Date().toISOString()
    const per  = cols.map((s) => ({ stage: s, entered: 0, value: 0, daysSum: 0, daysN: 0 }))
    const idx  = new Map(cols.map((s, i) => [s.id, i]))
    for (const d of set) {
      const seen = new Set<string>()
      for (let i = 0; i < d.path.length; i++) {
        const p = d.path[i]
        const ci = idx.get(p.stage)
        if (ci == null || seen.has(p.stage)) continue
        seen.add(p.stage)
        per[ci].entered += 1
        per[ci].value   += d.value
        const end = d.path[i + 1]?.at ?? d.won_at ?? d.lost_at ?? now
        per[ci].daysSum += days(p.at, end)
        per[ci].daysN   += 1
      }
    }
    // Coluna terminal (lente Ganhos/Perdidos): o desfecho como fim do funil.
    const terminal = lens === "won" || lens === "lost"
      ? { label: lens === "won" ? "Ganhos" : "Perdidos", entered: set.length, value: set.reduce((s, d) => s + d.value, 0) }
      : null
    return { cols: per, terminal }
  }, [set, stages, lens])

  // ── donuts ──────────────────────────────────────────────────────
  const metric = (ds: DashDeal[]) => byQty ? ds.length : ds.reduce((s, d) => s + d.value, 0)
  const byAgent = useMemo(() => {
    const g = new Map<string, DashDeal[]>()
    for (const d of set) { const k = d.responsible ?? "Sem responsável"; g.set(k, [...(g.get(k) ?? []), d]) }
    // Cor DEPOIS do sort: maior fatia = azul mais escuro (escala monocromática da referência).
    return [...g.entries()].map(([label, ds]) => ({ label, value: metric(ds) }))
      .filter((x) => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 8)
      .map((x, i) => ({ ...x, color: BLUE_SHADES[i % BLUE_SHADES.length] }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set, byQty])

  const byReason = useMemo(() => {
    const lost = set.filter((d) => d.status === "lost")
    const g = new Map<string, DashDeal[]>()
    for (const d of lost) { const k = d.lost_reason?.trim() || "Sem motivo"; g.set(k, [...(g.get(k) ?? []), d]) }
    return [...g.entries()].map(([label, ds], i) => ({ label, value: metric(ds), color: LOSS_COLORS[i % LOSS_COLORS.length] }))
      .filter((x) => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set, byQty])

  // ── vendas por unidade (dimensão do CRM; só com 2+ unidades ativas) ─
  const byUnit = useMemo(() => {
    const unitMeta = new Map(data.units.map((u) => [u.id, u]))
    const g = new Map<string, DashDeal[]>()
    for (const d of set) { const k = d.unit_id ?? "__none__"; g.set(k, [...(g.get(k) ?? []), d]) }
    return [...g.entries()].map(([k, ds]) => {
      const u = k === "__none__" ? null : unitMeta.get(k)
      return { label: u?.name ?? "Sem unidade", value: metric(ds), color: u?.color ?? "#94a3b8" }
    }).filter((x) => x.value > 0).sort((a, b) => b.value - a.value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set, byQty, data.units])

  // ── produtos & atendentes (listas) ──────────────────────────────
  const products = useMemo(() => {
    const g = new Map<string, { sales: number; total: number; sku: string | null }>()
    for (const d of set) for (const it of d.items) {
      const cur = g.get(it.name) ?? { sales: 0, total: 0, sku: it.sku }
      cur.sales += 1; cur.total += it.total
      if (!cur.sku && it.sku) cur.sku = it.sku
      g.set(it.name, cur)
    }
    return [...g.entries()].map(([name, x]) => ({ name, ...x })).sort((a, b) => b.total - a.total).slice(0, 6)
  }, [set])

  const agents = useMemo(() => {
    const meta = new Map(data.agentProfiles.map((p) => [p.id, p]))
    const g = new Map<string, { id: string | null; name: string; email: string | null; sales: number; total: number }>()
    for (const d of set) {
      const key = d.responsible_id ?? d.responsible ?? "—"
      const cur = g.get(key) ?? {
        id: d.responsible_id,
        name: d.responsible ?? "Sem responsável",
        email: d.responsible_id ? (meta.get(d.responsible_id)?.email ?? null) : null,
        sales: 0, total: 0,
      }
      cur.sales += 1; cur.total += d.value
      g.set(key, cur)
    }
    return [...g.values()].sort((a, b) => b.total - a.total).slice(0, 6)
  }, [set, data.agentProfiles])

  // ── dados mensais (criados / ganhos / perdidos) ─────────────────
  const monthly = useMemo(() => {
    const buckets = new Map<string, { created: number; won: number; lost: number }>()
    const key = (iso: string) => iso.slice(0, 7)
    const spanDays = Math.max(1, days(range.from, range.to))
    const months = Math.min(12, Math.max(1, Math.ceil(spanDays / 30)))
    const end = new Date(range.to + "T12:00:00")
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(end); d.setMonth(d.getMonth() - i)
      buckets.set(d.toISOString().slice(0, 7), { created: 0, won: 0, lost: 0 })
    }
    for (const d of scoped) {
      const bC = buckets.get(key(d.created_at)); if (bC) bC.created += d.value
      if (d.won_at)  { const b = buckets.get(key(d.won_at));  if (b) b.won  += d.value }
      if (d.lost_at) { const b = buckets.get(key(d.lost_at)); if (b) b.lost += d.value }
    }
    return [...buckets.entries()].map(([m, v]) => ({ month: m, ...v }))
  }, [scoped, range])

  const listDeals = useMemo(() => set.slice(0, 30), [set])
  const funnelStages = stages.filter((s) => s.show_in_kanban && !s.is_won && !s.is_lost)

  return (
    <div className="min-h-full bg-canvas">
      {/* Header analítico (design-system §2.1): título no canvas + pílulas de filtro */}
      <div className="px-4 sm:px-6 pt-10 pb-10 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href="/negocios" className="size-7 grid place-items-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white transition-colors shrink-0 -ml-1.5" title="Voltar ao pipeline">
              <ArrowLeft className="size-4" />
            </Link>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight truncate">Painel de Vendas</h1>
            {pending && <Loader2 className="size-4 animate-spin text-slate-400 shrink-0" />}
          </div>
          <p className="text-xs text-slate-400 mt-0.5 ml-7">Visão geral do desempenho · negócios criados no período</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <DateRangePill range={range} onApply={(r) => { setRange(r); refetch(data.pipeline.id, r) }} />
          {data.pipelines.length > 1 && (
            <FilterPill icon={Filter} w="w-44">
              <SimpleSelect value={data.pipeline.id} onChange={(v) => refetch(v, range)}
                className={PILL_SELECT} options={data.pipelines.map((p) => ({ value: p.id, label: p.name }))} />
            </FilterPill>
          )}
          {/* Sempre visível (decisão owner 2026-07-13): unidade se apresenta mesmo sem cadastro */}
          <FilterPill icon={Building2} w="w-48">
            <SimpleSelect value={unitFilter} onChange={setUnitFilter}
              className={PILL_SELECT} options={[
                { value: "", label: "Todas as unidades" },
                ...data.units.map((u) => ({ value: u.id, label: u.name })),
                { value: "none", label: "Sem unidade" },
              ]} />
          </FilterPill>
        </div>
      </div>

      {/* Refetch de filtro (data/funil) troca o corpo por skeleton — header segue vivo. */}
      {pending ? <DashboardSkeletonBody /> : (
      <div className="px-4 sm:px-6 pb-6 space-y-4">
        {/* KPIs = lentes */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <KpiLens label="Total negócios" k={kpi.all}  active={lens === "all"}  lens="all"  icon={ChartColumn}  onClick={() => setLens("all")} />
          <KpiLens label="Total ganhos"   k={kpi.won}  active={lens === "won"}  lens="won"  icon={TrendingUp}   onClick={() => setLens("won")} />
          <KpiLens label="Total perdidos" k={kpi.lost} active={lens === "lost"} lens="lost" icon={TrendingDown} onClick={() => setLens("lost")} />
          <KpiLens label="Total em aberto" k={kpi.open} active={lens === "open"} lens="open" icon={Activity}    onClick={() => setLens("open")} />
        </div>
        {canceledCount > 0 && (
          <p className="text-[11px] text-slate-400 -mt-2">
            {canceledCount} negócio{canceledCount !== 1 ? "s" : ""} cancelado{canceledCount !== 1 ? "s" : ""} no período — anulados não entram em nenhuma métrica.
          </p>
        )}

        {/* Funil + donut atendente */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-stretch">
          <section className="xl:col-span-2 bg-white rounded-xl border border-slate-200 p-4 min-w-0">
            <h2 className="text-sm font-bold text-slate-900">Gráfico de funil</h2>
            <FunnelChart funnel={funnel} color={L.color} />
          </section>
          <section className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Percentual por atendente</h2>
                <p className="text-[11px] text-slate-400">Visualização por {byQty ? "quantidade" : "valor"} dos negócios</p>
              </div>
              <div className="w-32 shrink-0">
                <SimpleSelect value={byQty ? "qty" : "value"} onChange={(v) => setByQty(v === "qty")} className="h-8 text-xs"
                  options={[{ value: "value", label: "Valor" }, { value: "qty", label: "Quantidade" }]} />
              </div>
            </div>
            <Donut data={byAgent} fmt={byQty ? (v) => String(v) : brlK} empty="Sem negócios na lente." />
          </section>
        </div>

        {/* Motivo de perda (lente Perdidos) · Produtos · Atendentes */}
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch">
          {lens === "lost" && (
            <section className="bg-white rounded-xl border border-slate-200 p-4">
              <h2 className="text-sm font-bold text-slate-900">Percentual por motivo de perda</h2>
              <p className="text-[11px] text-slate-400">Visualização por {byQty ? "quantidade" : "valor"} dos negócios</p>
              <Donut data={byReason} fmt={byQty ? (v) => String(v) : brlK} empty="Nenhuma perda no período." showValueInLegend />
            </section>
          )}
          {/* Sempre visível (decisão owner): sem unidades cadastradas mostra 100% "Sem unidade" */}
          <section className="bg-white rounded-xl border border-slate-200 p-4">
            <h2 className="text-sm font-bold text-slate-900">Vendas por unidade</h2>
            <p className="text-[11px] text-slate-400">Visualização por {byQty ? "quantidade" : "valor"} dos negócios</p>
            <Donut data={byUnit} fmt={byQty ? (v) => String(v) : brlK} empty="Sem negócios na lente." labelMode="value" />
          </section>
          <section className="bg-white rounded-xl border border-slate-200 p-4">
            <h2 className="text-sm font-bold text-slate-900">{lens === "won" ? "Produtos mais vendidos" : "Produtos com mais negócios"}</h2>
            {products.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">Sem itens de catálogo nos negócios da lente.</p>
            ) : (
              <div className="mt-2 divide-y divide-slate-100">
                {products.map((p) => (
                  <div key={p.name} className={STAT_ROW}>
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="size-9 rounded-lg grid place-items-center text-xs font-bold shrink-0"
                        style={{ background: `color-mix(in srgb, ${avaColor(p.name)} 16%, transparent)`, color: avaColor(p.name) }}>
                        {initials(p.name).slice(0, 1)}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 truncate">{p.name}</p>
                        {p.sku && <p className="text-[10.5px] text-slate-400 truncate">SKU:{p.sku}</p>}
                      </div>
                    </div>
                    <StatCell label="Vendas"       value={String(p.sales)} />
                    <StatCell label="Ticket médio" value={brl(p.total / p.sales)} />
                    <StatCell label="Total"        value={brlK(p.total)} color={L.color} />
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="bg-white rounded-xl border border-slate-200 p-4">
            <h2 className="text-sm font-bold text-slate-900">{lens === "won" ? "Atendentes com mais vendas" : "Atendentes com mais negócios"}</h2>
            {agents.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">Sem negócios na lente.</p>
            ) : (
              <div className="mt-2 divide-y divide-slate-100">
                {agents.map((a) => (
                  <div key={a.id ?? a.name} className={STAT_ROW}>
                    <div className="flex items-center gap-3 min-w-0">
                      <UserAvatar userId={a.id} name={a.name} size={36} />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 truncate">{a.name}</p>
                        {a.email && <p className="text-[10.5px] text-slate-400 truncate">{a.email}</p>}
                      </div>
                    </div>
                    <StatCell label="Vendas"       value={String(a.sales)} />
                    <StatCell label="Ticket médio" value={brl(a.total / a.sales)} />
                    <StatCell label="Total"        value={brlK(a.total)} color={L.color} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Dados mensais */}
        <section className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Dados mensais</h2>
              <p className="text-[11px] text-slate-400">Visualização por valor dos negócios</p>
            </div>
            <div className="flex items-center gap-3 text-[10.5px] text-slate-500">
              <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-[#3b82f6]" /> Criados</span>
              <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-emerald-500" /> Ganhos</span>
              <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-red-500" /> Perdidos</span>
            </div>
          </div>
          <MonthlyChart data={monthly} />
        </section>

        {/* Lista de negócios da lente */}
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] text-slate-500 bg-slate-50/60">
                  <th className="text-left font-medium py-2.5 px-4">Lead</th>
                  <th className="text-left font-medium py-2.5 px-3 hidden md:table-cell">Produto</th>
                  <th className="text-left font-medium py-2.5 px-3 hidden sm:table-cell">Atendente</th>
                  <th className="text-left font-medium py-2.5 px-3">Etapa</th>
                  <th className="text-left font-medium py-2.5 px-3">Dados</th>
                </tr>
              </thead>
              <tbody>
                {listDeals.length === 0 ? (
                  <tr><td colSpan={5} className="text-center text-xs text-slate-400 py-10">Nenhum negócio nesta lente/período.</td></tr>
                ) : listDeals.map((d) => <DealRowLine key={d.id} d={d} stages={funnelStages} onOpen={() => router.push(`/negocios/${d.id}`)} />)}
              </tbody>
            </table>
          </div>
          {set.length > listDeals.length && (
            <p className="text-[11px] text-slate-400 text-center py-2 border-t border-slate-100">Mostrando {listDeals.length} de {set.length} — veja tudo no <Link href="/negocios" className="text-primary-600 font-semibold hover:underline">pipeline</Link>.</p>
          )}
        </section>
      </div>
      )}
    </div>
  )
}

/** Célula das listas: rótulo em cima, valor embaixo (layout da referência). */
function StatCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-slate-400 leading-tight whitespace-nowrap">{label}</p>
      <p className={`text-xs font-bold tabular-nums leading-tight truncate ${color ? "" : "text-slate-800"}`}
        style={color ? { color } : undefined} title={value}>{value}</p>
    </div>
  )
}

// ── KPI-lente ─────────────────────────────────────────────────────
function KpiLens({ label, k, active, lens, icon: Icon, onClick }: {
  label: string; k: { value: number; count: number }; active: boolean; lens: Lens
  icon: typeof TrendingUp; onClick: () => void
}) {
  const L = LENS[lens]
  return (
    <button type="button" onClick={onClick}
      className={`text-left rounded-xl border bg-white px-4 py-3.5 transition-all ${active ? `ring-2 ${L.ring}` : "border-slate-200 hover:border-slate-300"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-slate-500">{label}</p>
        <span className="size-6 rounded-md grid place-items-center" style={{ background: L.soft }}>
          <Icon className="size-3.5" style={{ color: L.color }} />
        </span>
      </div>
      <p className="text-[22px] leading-tight font-bold tracking-tight text-slate-900 tabular-nums mt-1">{brlK(k.value)}</p>
      <p className="text-[11px] text-slate-400 tabular-nums">{k.count} negócio{k.count !== 1 ? "s" : ""}</p>
    </button>
  )
}

// ── Funil (banda SVG + velocity por etapa) ───────────────────────
function FunnelChart({ funnel, color }: {
  funnel: { cols: { stage: DashStage; entered: number; value: number; daysSum: number; daysN: number }[]; terminal: { label: string; entered: number; value: number } | null }
  color: string
}) {
  const cols = [
    ...funnel.cols.map((c) => ({ name: c.stage.name, dot: c.stage.color, entered: c.entered, value: c.value, avg: c.daysN ? Math.round(c.daysSum / c.daysN) : null })),
    ...(funnel.terminal ? [{ name: funnel.terminal.label, dot: color, entered: funnel.terminal.entered, value: funnel.terminal.value, avg: null }] : []),
  ]
  if (cols.length === 0) return <p className="text-xs text-slate-400 py-10 text-center">Configure as etapas do funil.</p>

  const COL = 176, H = 168
  const max = Math.max(1, ...cols.map((c) => c.entered))
  const hOf = (n: number) => Math.max(H * 0.05, (n / max) * H)
  const W = cols.length * COL

  // Banda: por coluna, trecho reto (60% da largura) + transição em curva até a
  // próxima (40%). Topo esquerda→direita; base volta direita→esquerda (espelho).
  let d = `M 0 ${(H - hOf(cols[0].entered)) / 2}`
  cols.forEach((c, i) => {
    const x0 = i * COL, x1 = x0 + COL * 0.6, x2 = (i + 1) * COL
    const h = hOf(c.entered), y0 = (H - h) / 2
    d += ` L ${x1} ${y0}`
    if (i < cols.length - 1) {
      const nh = hOf(cols[i + 1].entered), ny0 = (H - nh) / 2
      const cx = x1 + (x2 - x1) / 2
      d += ` C ${cx} ${y0}, ${cx} ${ny0}, ${x2} ${ny0}`
    } else d += ` L ${x2} ${y0}`
  })
  for (let i = cols.length - 1; i >= 0; i--) {
    const x0 = i * COL, x1 = x0 + COL * 0.6, x2 = (i + 1) * COL
    const h = hOf(cols[i].entered), y1 = (H + h) / 2
    if (i === cols.length - 1) d += ` L ${x2} ${y1}`
    else {
      const nh = hOf(cols[i + 1].entered), ny1 = (H + nh) / 2
      const cx = x1 + (x2 - x1) / 2
      d += ` C ${cx} ${ny1}, ${cx} ${y1}, ${x1} ${y1}`
    }
    d += ` L ${x0} ${y1}`
  }
  d += " Z"

  return (
    <div className="overflow-x-auto mt-3 -mx-1 px-1">
      <div style={{ minWidth: W }}>
        {/* cabeçalho por etapa */}
        <div className="grid" style={{ gridTemplateColumns: `repeat(${cols.length}, ${COL}px)` }}>
          {cols.map((c, i) => (
            <div key={i} className={`pr-3 pb-2 ${i > 0 ? "pl-3 border-l border-slate-100" : ""}`}>
              <div className="flex items-center justify-between gap-1.5">
                <p className="text-[11px] font-semibold text-slate-700 truncate">{c.name}</p>
                <span className="size-2 rounded-sm shrink-0" style={{ background: c.dot }} />
              </div>
              <p className="text-sm font-bold text-slate-900 tabular-nums mt-0.5">{brlK(c.value)}</p>
              <div className="mt-1 space-y-0.5 text-[10px] text-slate-400">
                <p className="flex justify-between gap-2"><span>Quantidade</span><span className="tabular-nums text-slate-500 font-medium">{c.entered === 0 ? "Nenhum negócio" : `${c.entered} Negócio${c.entered !== 1 ? "s" : ""}`}</span></p>
                <p className="flex justify-between gap-2"><span>Tempo médio</span><span className="tabular-nums text-slate-500 font-medium">{c.avg != null ? fmtDays(c.avg) : "—"}</span></p>
              </div>
            </div>
          ))}
        </div>
        {/* banda */}
        <div className="relative">
          <svg width={W} height={H} className="block">
            <path d={d} fill={color} opacity={0.88} />
            {cols.map((_, i) => i > 0 && <line key={i} x1={i * COL} y1={0} x2={i * COL} y2={H} stroke="#fff" strokeWidth={1} opacity={0.35} />)}
          </svg>
          {/* pílulas de conversão nas junções */}
          {cols.map((c, i) => {
            if (i === cols.length - 1) return null
            const pct = c.entered > 0 ? Math.round((cols[i + 1].entered / c.entered) * 100) : 0
            return (
              <span key={i} className="absolute -translate-x-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-600 bg-white rounded-full px-2 py-0.5 shadow-sm border border-slate-100 tabular-nums"
                style={{ left: (i + 1) * COL, top: H / 2 }}>
                {pct}%
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Donut (referência do owner: label EXTERNO com linha-guia — % ou valor —
//    e legenda horizontal de bolinhas embaixo) ───────────────────────
function Donut({ data, fmt, empty, labelMode = "pct", showValueInLegend = false }: {
  data: { label: string; value: number; color: string }[]
  fmt: (v: number) => string
  empty: string
  /** O que a linha-guia mostra: percentual (default) ou o valor formatado (fmt). */
  labelMode?: "pct" | "value"
  showValueInLegend?: boolean
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total <= 0) return <p className="text-xs text-slate-400 py-10 text-center">{empty}</p>
  const CX = 130, CY = 100, R = 52, SW = 24, C = 2 * Math.PI * R
  // Offset acumulado por segmento — pré-computado (sem mutação durante o render).
  const segs = data.reduce<{ frac: number; offset: number }[]>((acc, seg) => {
    const prev = acc[acc.length - 1]
    acc.push({ frac: seg.value / total, offset: prev ? prev.offset + prev.frac : 0 })
    return acc
  }, [])

  // Labels externos: ponto na borda do anel → cotovelo → trecho horizontal → texto.
  const labels = data.map((seg, i) => {
    const a = (segs[i].offset + segs[i].frac / 2) * 2 * Math.PI - Math.PI / 2
    const right = Math.cos(a) >= 0
    const text = labelMode === "value"
      ? fmt(seg.value)
      : `${((seg.value / total) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
    return {
      sx: CX + Math.cos(a) * (R + SW / 2 + 2), sy: CY + Math.sin(a) * (R + SW / 2 + 2),
      ex: CX + Math.cos(a) * (R + SW / 2 + 13), ey: CY + Math.sin(a) * (R + SW / 2 + 13),
      right, text, frac: segs[i].frac,
    }
  }).filter((l) => l.frac >= 0.02)  // fatia <2% não ganha label (legenda cobre)
  // Anti-colisão: por lado, empurra labels muito próximos pra baixo (min 15px).
  for (const side of [true, false]) {
    const col = labels.filter((l) => l.right === side).sort((a, b) => a.ey - b.ey)
    for (let i = 1; i < col.length; i++) if (col[i].ey - col[i - 1].ey < 15) col[i].ey = col[i - 1].ey + 15
  }

  return (
    <div className="mt-3 flex flex-col items-center gap-3">
      <svg viewBox="0 0 260 200" className="w-full max-w-[300px]">
        <g transform={`rotate(-90 ${CX} ${CY})`}>
          {data.map((seg, i) => (
            <circle key={i} cx={CX} cy={CY} r={R} fill="none" stroke={seg.color} strokeWidth={SW}
              strokeDasharray={`${Math.max(0.5, segs[i].frac * C - 1.5)} ${C}`} strokeDashoffset={-segs[i].offset * C} />
          ))}
        </g>
        {labels.map((l, i) => (
          <g key={i}>
            <polyline
              points={`${l.sx},${l.sy} ${l.ex},${l.ey} ${l.ex + (l.right ? 9 : -9)},${l.ey}`}
              fill="none" stroke="#94a3b8" strokeWidth={1} />
            <circle cx={l.ex + (l.right ? 9 : -9)} cy={l.ey} r={1.5} fill="#64748b" />
            <text x={l.ex + (l.right ? 13 : -13)} y={l.ey + 3.5} textAnchor={l.right ? "start" : "end"}
              fontSize={11} fontWeight={600} className="fill-slate-700 tabular-nums">{l.text}</text>
          </g>
        ))}
      </svg>
      {/* legenda horizontal de bolinhas (como a referência) */}
      <div className="w-full flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 pt-2.5 border-t border-slate-100">
        {data.map((seg) => (
          <span key={seg.label} className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 min-w-0">
            <span className="size-2 rounded-full shrink-0" style={{ background: seg.color }} />
            <span className="truncate max-w-[140px]">{seg.label}</span>
            {showValueInLegend && <span className="text-slate-400 tabular-nums shrink-0">· {fmt(seg.value)}</span>}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Dados mensais (barra empilhada: criados+ganhos acima do zero · perdidos
//    NEGATIVOS abaixo — escala ÚNICA cruzando o zero, gridlines em valores
//    redondos, hover com coluna destacada + tooltip) ─────────────────
function MonthlyChart({ data }: { data: { month: string; created: number; won: number; lost: number }[] }) {
  const [ref, w] = useMeasure()
  const [hover, setHover] = useState<number | null>(null)
  const H = 250, padT = 10, padB = 24, padL = 56, padR = 12
  const plotH = H - padT - padB, plotW = Math.max(0, w - padL - padR)

  // Escala única: mesmo R$-por-px acima e abaixo do zero (honestidade visual).
  const maxUp = Math.max(1, ...data.map((d) => d.created + d.won))
  const maxDn = Math.max(0, ...data.map((d) => d.lost))
  const niceStep = (raw: number) => {
    const pow = Math.pow(10, Math.floor(Math.log10(raw)))
    const n = raw / pow
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow
  }
  const step = niceStep(Math.max(maxUp, 1) / 3)
  const upTicks = Math.max(1, Math.ceil(maxUp / step))
  const dnTicks = maxDn > 0 ? Math.max(1, Math.ceil(maxDn / step)) : 0
  const pxPer = plotH / ((upTicks + dnTicks) * step)
  const zeroY = padT + upTicks * step * pxPer
  const yOf = (v: number) => zeroY - v * pxPer

  const monthLabel = (m: string) => {
    const [y, mo] = m.split("-")
    return `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(mo) - 1]}/${y.slice(2)}`
  }
  // Intervalo do bucket pro tooltip: "01/05/24 - 01/06/24" (como a referência).
  const rangeLabel = (m: string) => {
    const [y, mo] = m.split("-").map(Number)
    const f = (yy: number, mm: number) => `01/${String(mm).padStart(2, "0")}/${String(yy).slice(2)}`
    return mo === 12 ? `${f(y, 12)} - ${f(y + 1, 1)}` : `${f(y, mo)} - ${f(y, mo + 1)}`
  }
  const axisLabel = (v: number) => (v === 0 ? "R$ 0,00" : `${v < 0 ? "-" : ""}${brlK(Math.abs(v))}`)

  const n = data.length
  const slot = n > 0 ? plotW / n : 0
  const bw = Math.min(64, Math.max(14, slot * 0.55))
  const ticks: number[] = []
  for (let t = upTicks; t >= -dnTicks; t--) ticks.push(t * step)

  const hovered = hover != null ? data[hover] : null
  const tipLeft = hover != null ? padL + slot * hover + slot / 2 : 0
  const tipFlip = hover != null && w > 0 && tipLeft > w - 190

  return (
    <div ref={ref} className="mt-3 relative">
      {w > 0 && (
        <svg
          width={w} height={H} className="block"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const x = e.clientX - e.currentTarget.getBoundingClientRect().left
            const i = Math.floor((x - padL) / slot)
            setHover(i >= 0 && i < n ? i : null)
          }}
        >
          {/* coluna destacada no hover (atrás de tudo) */}
          {hover != null && (
            <rect x={padL + slot * hover} y={padT} width={slot} height={plotH} fill="#eef1f6" opacity={0.8} />
          )}
          {/* gridlines + labels do eixo Y */}
          {ticks.map((v) => (
            <g key={v}>
              <line x1={padL} y1={yOf(v)} x2={w - padR} y2={yOf(v)} stroke={v === 0 ? "#cbd5e1" : "#eef1f5"} strokeWidth={1} />
              <text x={padL - 8} y={yOf(v) + 3.5} textAnchor="end" className="fill-slate-400" fontSize={10}>{axisLabel(v)}</text>
            </g>
          ))}
          {/* barras */}
          {data.map((d, i) => {
            const cx = padL + slot * i + slot / 2
            const hC = d.created * pxPer, hW = d.won * pxPer, hL = d.lost * pxPer
            return (
              <g key={d.month}>
                {d.created > 0 && <rect x={cx - bw / 2} y={zeroY - hC} width={bw} height={Math.max(2, hC)} fill="#3b82f6" />}
                {d.won > 0 && <rect x={cx - bw / 2} y={zeroY - hC - hW} width={bw} height={Math.max(2, hW)} fill="#10b981" />}
                {d.lost > 0 && <rect x={cx - bw / 2} y={zeroY + 1} width={bw} height={Math.max(2, hL)} fill="#ef4444" />}
                <text x={cx} y={H - 7} textAnchor="middle" className="fill-slate-400" fontSize={10}>{monthLabel(d.month)}</text>
              </g>
            )
          })}
        </svg>
      )}
      {/* tooltip (HTML sobre o SVG, flipa perto da borda direita) */}
      {hovered && (
        <div
          className="absolute z-10 pointer-events-none bg-white rounded-lg border border-slate-200 shadow-lg px-3 py-2 min-w-[176px]"
          style={{ left: tipLeft, top: padT + 12, transform: tipFlip ? "translateX(calc(-100% - 10px))" : "translateX(10px)" }}
        >
          <p className="text-[11px] font-bold text-slate-800 tabular-nums">{rangeLabel(hovered.month)}</p>
          <div className="mt-1.5 space-y-1">
            {([
              ["Criados", hovered.created, "#3b82f6", false],
              ["Ganhos", hovered.won, "#10b981", false],
              ["Perdidos", hovered.lost, "#ef4444", true],
            ] as [string, number, string, boolean][]).map(([label, v, color, neg]) => (
              <p key={label} className="flex items-center justify-between gap-4 text-[11px]">
                <span className="inline-flex items-center gap-1.5 text-slate-500">
                  <span className="w-1 h-3 rounded-full shrink-0" style={{ background: color }} />{label}
                </span>
                <span className="tabular-nums font-semibold text-slate-800">{neg ? "-" : ""}{brl(v)}</span>
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Linha da lista de negócios ────────────────────────────────────
function DealRowLine({ d, stages, onOpen }: { d: DashDeal; stages: DashStage[]; onOpen: () => void }) {
  const who = d.contact_name ?? d.name?.trim() ?? "Sem contato"
  const idx = stages.findIndex((s) => s.id === d.stage_id)
  const cells = stages.length || 1
  const filled = d.status === "open" ? (idx >= 0 ? idx + 1 : 0) : cells
  const color = d.status === "won" ? "#10b981" : d.status === "lost" ? "#ef4444" : "#004add"
  const firstItem = d.items[0]
  const closed = d.won_at ?? d.lost_at
  const cycle = closed ? days(d.created_at, closed) : days(d.created_at, new Date().toISOString())
  const inStage = d.stage_entered_at ? days(d.stage_entered_at, closed ?? new Date().toISOString()) : null

  return (
    <tr onClick={onOpen} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors cursor-pointer">
      <td className="py-2.5 px-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="size-7 rounded-full overflow-hidden grid place-items-center text-[10px] font-bold text-white shrink-0" style={{ background: avaColor(who) }}>
            <ContactPic pic={d.contact_pic} imgClass="size-full object-cover" fallback={<span>{initials(who)}</span>} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-800 truncate">{who}</p>
            {d.name?.trim() && <p className="text-[10px] text-primary-600 truncate">{d.name.trim()}</p>}
          </div>
        </div>
      </td>
      <td className="py-2.5 px-3 hidden md:table-cell">
        {firstItem ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <Package className="size-3.5 text-slate-300 shrink-0" />
            <span className="text-xs text-slate-600 truncate">{firstItem.name}{d.items.length > 1 ? ` +${d.items.length - 1}` : ""}</span>
          </div>
        ) : (
          <span className="text-xs text-slate-400">Sem produto{d.value > 0 ? <span className="tabular-nums text-slate-500"> · {brl(d.value)}</span> : ""}</span>
        )}
      </td>
      <td className="py-2.5 px-3 hidden sm:table-cell">
        {d.responsible ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <UserAvatar userId={d.responsible_id} name={d.responsible} size={20} />
            <span className="text-xs text-slate-600 truncate max-w-[140px]">{d.responsible}</span>
          </div>
        ) : <span className="text-xs text-slate-300">—</span>}
      </td>
      <td className="py-2.5 px-3">
        <div className="w-28">
          <p className="text-[10px] font-semibold mb-1" style={{ color }}>{d.status === "won" ? "Ganho" : d.status === "lost" ? "Perdido" : stages[idx]?.name ?? "—"}</p>
          <div className="flex gap-0.5">
            {Array.from({ length: cells }).map((_, i) => (
              <span key={i} className="h-1.5 flex-1 rounded-sm" style={{ background: i < filled ? color : "#e2e8f0" }} />
            ))}
          </div>
        </div>
      </td>
      <td className="py-2.5 px-3">
        {d.status === "won" && <p className="text-[11px] font-semibold text-emerald-600">Ganho em {fmtDays(cycle)}<span className="block text-[10px] font-normal text-slate-400">{new Date(d.won_at as string).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}</span></p>}
        {d.status === "lost" && <p className="text-[11px] font-semibold text-red-600">Perdido em {fmtDays(cycle)}<span className="block text-[10px] font-normal text-slate-400">{d.lost_reason ?? new Date(d.lost_at as string).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}</span></p>}
        {d.status === "open" && (
          <div className="flex items-center gap-3 text-[11px] tabular-nums">
            <span><span className="font-semibold text-slate-700">{brlK(d.value)}</span><span className="block text-[10px] text-slate-400">Em aberto</span></span>
            {inStage != null && <span><span className="font-semibold text-slate-700">{inStage}d</span><span className="block text-[10px] text-slate-400">na etapa</span></span>}
          </div>
        )}
      </td>
    </tr>
  )
}
