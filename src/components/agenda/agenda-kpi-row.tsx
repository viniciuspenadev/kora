"use client"

import { useEffect, useState } from "react"
import { getAgendaKpis, type AgendaKpis } from "@/lib/actions/agenda"

// ═══════════════════════════════════════════════════════════════
// Fileira de KPIs estratégicos da Agenda (F4) — topo da Visão Geral
// ═══════════════════════════════════════════════════════════════
// Escopo de segurança é 100% server-side (getAgendaKpis: admin = tenant;
// atendente = só as agendas dele). null = módulo off → nem renderiza. Valor
// null num KPI vira "—" (não inventa zero). Grid 6 → 3 → 2 colunas.

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v)}%`)

const GRID = "grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3"

export function AgendaKpiRow() {
  const [kpis, setKpis] = useState<AgendaKpis | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let on = true
    void getAgendaKpis().then((k) => { if (on) { setKpis(k); setLoading(false) } })
    return () => { on = false }
  }, [])

  if (loading) return <KpiSkeleton />
  if (!kpis) return null   // módulo off

  const tiles: { label: string; value: string; sub: string; bar?: number | null }[] = [
    { label: "Ocupação",         value: pct(kpis.occupancyPct), sub: "da capacidade · semana atual", bar: kpis.occupancyPct },
    { label: "No-show",          value: pct(kpis.noShowPct),    sub: `últimos 30 dias · ${kpis.noShowCount} de ${kpis.finishedCount}` },
    { label: "Confirmação",      value: pct(kpis.confirmPct),   sub: `próximos 7 dias · ${kpis.pendingUpcoming} aguardando` },
    { label: "Remarcações",      value: String(kpis.reschedules7d), sub: "últimos 7 dias" },
    { label: "Via IA",           value: pct(kpis.aiSharePct),   sub: "dos criados em 30 dias" },
    { label: "Receita prevista", value: BRL.format(kpis.expectedRevenue), sub: "semana atual" },
  ]

  return (
    <div className={GRID}>
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t.label}</p>
          <p className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">{t.value}</p>
          {t.bar != null && (
            <div className="h-1 rounded-full bg-slate-100 mt-1.5 overflow-hidden">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, t.bar))}%` }} />
            </div>
          )}
          <p className="text-[11px] text-slate-400 mt-1 truncate">{t.sub}</p>
        </div>
      ))}
    </div>
  )
}

function KpiSkeleton() {
  return (
    <div className={GRID}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="h-2.5 w-16 rounded bg-slate-200/70 animate-pulse" />
          <div className="h-5 w-12 rounded bg-slate-200/70 animate-pulse mt-2" />
          <div className="h-2 w-20 rounded bg-slate-200/70 animate-pulse mt-2" />
        </div>
      ))}
    </div>
  )
}
