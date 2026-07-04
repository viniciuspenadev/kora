"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft, Loader2, BarChart3, TrendingUp, TrendingDown, Activity, ChartColumn,
  Package,
} from "lucide-react"
import { SimpleSelect } from "@/components/ui/select"
import { ContactPic } from "@/components/chat/contact-pic"
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

/** Linha das listas Produtos/Atendentes — colunas FIXAS (nome flexível + Vendas ·
    Ticket médio · Total) → tudo alinhado verticalmente, como a referência. */
const STAT_ROW = "grid grid-cols-[minmax(0,1fr)_56px_108px_84px] items-center gap-3 py-2.5"

const PERIODS = [
  { value: "30",  label: "Últimos 30 dias" },
  { value: "90",  label: "Últimos 90 dias" },
  { value: "180", label: "Últimos 6 meses" },
  { value: "365", label: "Último ano" },
]

export function PainelClient({ initial, initialPeriod }: { initial: PipelineDashboardData; initialPeriod: string }) {
  const router = useRouter()
  const [data, setData]     = useState(initial)
  const [period, setPeriod] = useState(initialPeriod)
  const [lens, setLens]     = useState<Lens>("all")
  const [byQty, setByQty]   = useState(false)   // donuts: Valor | Quantidade
  const [pending, start]    = useTransition()

  function refetch(pipelineId: string, p: string) {
    start(async () => {
      const to   = new Date()
      const from = new Date(Date.now() - Number(p) * 86_400_000)
      const r = await getPipelineDashboard({ pipelineId, from: from.toISOString(), to: to.toISOString() })
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

  // Conjunto da lente (KPIs = sempre sobre TODOS os criados no período).
  const set = useMemo(() => {
    if (lens === "won")  return deals.filter((d) => d.status === "won")
    if (lens === "lost") return deals.filter((d) => d.status === "lost")
    if (lens === "open") return deals.filter((d) => d.status === "open")
    return deals
  }, [deals, lens])

  const kpi = useMemo(() => {
    const sum = (ds: DashDeal[]) => ds.reduce((s, d) => s + d.value, 0)
    const won = deals.filter((d) => d.status === "won"), lost = deals.filter((d) => d.status === "lost"), open = deals.filter((d) => d.status === "open")
    return {
      all:  { value: sum(deals), count: deals.length },
      won:  { value: sum(won),   count: won.length },
      lost: { value: sum(lost),  count: lost.length },
      open: { value: sum(open),  count: open.length },
    }
  }, [deals])

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
    return [...g.entries()].map(([label, ds]) => ({ label, value: metric(ds), color: avaColor(label) }))
      .filter((x) => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 8)
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
    const months = Math.min(12, Math.max(1, Math.ceil(Number(period) / 30)))
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i)
      buckets.set(d.toISOString().slice(0, 7), { created: 0, won: 0, lost: 0 })
    }
    for (const d of deals) {
      const bC = buckets.get(key(d.created_at)); if (bC) bC.created += d.value
      if (d.won_at)  { const b = buckets.get(key(d.won_at));  if (b) b.won  += d.value }
      if (d.lost_at) { const b = buckets.get(key(d.lost_at)); if (b) b.lost += d.value }
    }
    return [...buckets.entries()].map(([m, v]) => ({ month: m, ...v }))
  }, [deals, period])

  const listDeals = useMemo(() => set.slice(0, 30), [set])
  const funnelStages = stages.filter((s) => s.show_in_kanban && !s.is_won && !s.is_lost)

  return (
    <div className="min-h-full bg-canvas">
      {/* header — funil + intervalo */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
        <Link href="/negocios" className="size-8 grid place-items-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0" title="Voltar ao pipeline">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex items-center gap-2.5">
          <span className="size-8 rounded-lg bg-primary/10 grid place-items-center shrink-0"><BarChart3 className="size-4 text-primary" /></span>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-slate-900 leading-tight tracking-tight uppercase truncate">{data.pipeline.name}</h1>
            <p className="text-[11px] text-slate-400 leading-tight">Painel do funil · negócios criados no período</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {pending && <Loader2 className="size-4 animate-spin text-slate-400" />}
          {data.pipelines.length > 1 && (
            <div className="w-44">
              <SimpleSelect value={data.pipeline.id} onChange={(v) => refetch(v, period)} className="h-9 text-xs"
                options={data.pipelines.map((p) => ({ value: p.id, label: p.name }))} />
            </div>
          )}
          <div className="w-40">
            <SimpleSelect value={period} onChange={(v) => { setPeriod(v); refetch(data.pipeline.id, v) }} className="h-9 text-xs" options={PERIODS} />
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-5 space-y-4">
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
        <div className={`grid grid-cols-1 lg:grid-cols-2 ${lens === "lost" ? "xl:grid-cols-3" : ""} gap-4 items-stretch`}>
          {lens === "lost" && (
            <section className="bg-white rounded-xl border border-slate-200 p-4">
              <h2 className="text-sm font-bold text-slate-900">Percentual por motivo de perda</h2>
              <p className="text-[11px] text-slate-400">Visualização por {byQty ? "quantidade" : "valor"} dos negócios</p>
              <Donut data={byReason} fmt={byQty ? (v) => String(v) : brlK} empty="Nenhuma perda no período." showValueInLegend />
            </section>
          )}
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
                      <span className="size-9 rounded-full overflow-hidden grid place-items-center text-xs font-bold text-white shrink-0" style={{ background: avaColor(a.name) }}>
                        <ContactPic
                          pic={a.id ? `/api/user-avatar/${a.id}` : null}
                          imgClass="size-full object-cover"
                          fallback={<span>{initials(a.name)}</span>}
                        />
                      </span>
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
              <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-[#004add]" /> Criados</span>
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

// ── Donut ─────────────────────────────────────────────────────────
function Donut({ data, fmt, empty, showValueInLegend = false }: {
  data: { label: string; value: number; color: string }[]
  fmt: (v: number) => string
  empty: string
  showValueInLegend?: boolean
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total <= 0) return <p className="text-xs text-slate-400 py-10 text-center">{empty}</p>
  const R = 54, C = 2 * Math.PI * R
  // Offset acumulado por segmento — pré-computado (sem mutação durante o render).
  const segs = data.reduce<{ frac: number; offset: number }[]>((acc, seg) => {
    const prev = acc[acc.length - 1]
    acc.push({ frac: seg.value / total, offset: prev ? prev.offset + prev.frac : 0 })
    return acc
  }, [])
  return (
    <div className="mt-3 flex flex-col items-center gap-3">
      <svg width={150} height={150} viewBox="0 0 150 150">
        <g transform="rotate(-90 75 75)">
          {data.map((seg, i) => (
            <circle key={i} cx={75} cy={75} r={R} fill="none" stroke={seg.color} strokeWidth={20}
              strokeDasharray={`${Math.max(0.5, segs[i].frac * C - 1.5)} ${C}`} strokeDashoffset={-segs[i].offset * C} />
          ))}
        </g>
      </svg>
      <div className="w-full space-y-1">
        {data.map((seg) => (
          <div key={seg.label} className="flex items-center gap-2 text-[11px]">
            <span className="size-2 rounded-full shrink-0" style={{ background: seg.color }} />
            <span className="text-slate-600 truncate flex-1">{seg.label}{showValueInLegend && <span className="text-slate-400"> · {fmt(seg.value)}</span>}</span>
            <span className="tabular-nums font-semibold text-slate-700 shrink-0">{((seg.value / total) * 100).toFixed(seg.value / total >= 0.1 ? 1 : 2)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Dados mensais (barras: criados / ganhos acima · perdidos abaixo) ─
function MonthlyChart({ data }: { data: { month: string; created: number; won: number; lost: number }[] }) {
  const [ref, w] = useMeasure()
  const H = 210, axis = H * 0.68, padL = 8
  const maxUp = Math.max(1, ...data.map((d) => Math.max(d.created, d.won)))
  const maxDn = Math.max(1, ...data.map((d) => d.lost))
  const monthLabel = (m: string) => {
    const [y, mo] = m.split("-")
    return `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(mo) - 1]}/${y.slice(2)}`
  }
  const n = data.length
  const slot = n > 0 ? (w - padL * 2) / n : 0
  const bw = Math.min(26, Math.max(8, slot * 0.24))

  return (
    <div ref={ref} className="mt-3">
      {w > 0 && (
        <svg width={w} height={H} className="block">
          <line x1={0} y1={axis} x2={w} y2={axis} stroke="#e2e8f0" strokeWidth={1} />
          {data.map((d, i) => {
            const cx = padL + slot * i + slot / 2
            const hC = (d.created / maxUp) * (axis - 18)
            const hW = (d.won / maxUp) * (axis - 18)
            const hL = (d.lost / maxDn) * (H - axis - 22)
            return (
              <g key={d.month}>
                <title>{`${monthLabel(d.month)} — Criados ${brl(d.created)} · Ganhos ${brl(d.won)} · Perdidos ${brl(d.lost)}`}</title>
                <rect x={cx - bw - 2} y={axis - hC} width={bw} height={Math.max(d.created > 0 ? 2 : 0, hC)} rx={2} fill="#004add" opacity={0.9} />
                <rect x={cx + 2} y={axis - hW} width={bw} height={Math.max(d.won > 0 ? 2 : 0, hW)} rx={2} fill="#10b981" opacity={0.9} />
                <rect x={cx - bw / 2} y={axis + 3} width={bw} height={Math.max(d.lost > 0 ? 2 : 0, hL)} rx={2} fill="#ef4444" opacity={0.85} />
                <text x={cx} y={H - 5} textAnchor="middle" className="fill-slate-400" fontSize={10}>{monthLabel(d.month)}</text>
              </g>
            )
          })}
        </svg>
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
            <span className="size-5 rounded-full grid place-items-center text-[8px] font-bold text-white shrink-0" style={{ background: avaColor(d.responsible) }}>{initials(d.responsible)}</span>
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
