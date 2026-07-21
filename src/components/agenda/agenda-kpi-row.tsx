"use client"

import { useEffect, useState } from "react"
import { CalendarDays, Gauge, CalendarCheck, UserX, CalendarClock, type LucideIcon } from "lucide-react"
import { getAgendaKpis, type AgendaKpis } from "@/lib/actions/agenda"
import { STATUS_COLORS } from "@/components/agenda/board/lanes"

// ═══════════════════════════════════════════════════════════════
// Fileira de KPIs da Agenda — topo da Visão Geral (redesign 2026-07-18)
// ═══════════════════════════════════════════════════════════════
// Anatomia da referência aprovada pelo owner: ícone + rótulo (muted) em cima,
// número grande no meio, legenda embaixo — tudo alinhado à esquerda.
// 1º cartão = "Hoje" (pulso do DIA CORRENTE, sempre — absorve a antiga linha
// No dia/Confirmados/Aguardando/Concluídos como chips coloridos, mesma
// linguagem de cor do calendário e do filtro). Receita/Via IA saíram da tela
// (cálculo permanece no servidor). Escopo de segurança 100% server-side
// (admin = tenant; atendente = só as agendas dele). null = módulo off → some.

// Sem histórico (denominador zero no servidor) → mostra 0%, nunca "—" (owner 2026-07-18).
const pct = (v: number | null) => `${Math.round(v ?? 0)}%`

const GRID = "grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3"

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

  return (
    <div className={GRID}>
      <Tile icon={CalendarDays} iconClass="text-primary-600" label="Hoje" value={String(kpis.todayTotal)}
        caption={
          <span className="flex items-center gap-2.5 flex-wrap">
            <Chip color={STATUS_COLORS.confirmed.bg} n={kpis.todayConfirmed} txt="confirmados" />
            <Chip color={STATUS_COLORS.scheduled.bg} n={kpis.todayPending} txt="aguardando" />
            <Chip color={STATUS_COLORS.done.bg} n={kpis.todayDone} txt="concluídos" />
            {kpis.todayNoShow > 0 && <Chip color={STATUS_COLORS.no_show.bg} n={kpis.todayNoShow} txt="faltas" />}
          </span>
        }
      />
      <Tile icon={Gauge} iconClass="text-sky-500" label="Ocupação" value={pct(kpis.occupancyPct)} bar={kpis.occupancyPct ?? 0}
        caption="da capacidade · semana atual" />
      <Tile icon={CalendarCheck} iconClass="text-emerald-600" label="Confirmação" value={pct(kpis.confirmPct)}
        caption={`próximos 7 dias · ${kpis.pendingUpcoming} aguardando`} />
      <Tile icon={UserX} iconClass="text-red-600" label="No-show" value={pct(kpis.noShowPct)}
        caption={`últimos 30 dias · ${kpis.noShowCount} de ${kpis.finishedCount}`} />
      <Tile icon={CalendarClock} iconClass="text-amber-600" label="Remarcações" value={String(kpis.reschedules7d)}
        caption="últimos 7 dias" />
    </div>
  )
}

function Tile({ icon: Icon, iconClass, label, value, caption, bar }: {
  icon: LucideIcon; iconClass: string; label: string; value: string
  caption: React.ReactNode; bar?: number | null
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <Icon className={`size-3.5 shrink-0 ${iconClass}`} />
        {label}
      </p>
      <p className="text-2xl font-bold text-slate-900 tabular-nums leading-none mt-2">{value}</p>
      {bar != null && (
        <div className="h-1 rounded-full bg-slate-100 mt-2 overflow-hidden">
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} />
        </div>
      )}
      <div className="text-[11px] text-slate-400 mt-2 leading-snug">{caption}</div>
    </div>
  )
}

/** Mini-chip do pulso do dia: bolinha na cor OFICIAL do status + contagem. */
function Chip({ color, n, txt }: { color: string; n: number; txt: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="size-2 rounded-full shrink-0" style={{ background: color }} />
      <span className="tabular-nums font-semibold text-slate-600">{n}</span> {txt}
    </span>
  )
}

function KpiSkeleton() {
  return (
    <div className={GRID}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white px-4 py-3.5">
          <div className="h-3 w-20 rounded bg-slate-200/70 animate-pulse" />
          <div className="h-6 w-14 rounded bg-slate-200/70 animate-pulse mt-2.5" />
          <div className="h-2.5 w-24 rounded bg-slate-200/70 animate-pulse mt-2.5" />
        </div>
      ))}
    </div>
  )
}
