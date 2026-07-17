"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { SimpleSelect } from "@/components/ui/select"
import {
  listAppointments, listAppointmentAgents, getAppointmentNoteFlags, listBlackouts,
  rescheduleAppointment, resizeAppointment,
  type ResourceRow, type ServiceRow,
} from "@/lib/actions/agenda"
import { TZ, cap, ymdInTz } from "./lanes"
import { normalizeAppt, type BoardAppt, type RawAppt, type RawBlackout } from "./types"
import { DayView } from "./day-view"
import { WeekView } from "./week-view"
import { MonthView, buildMonthGrid } from "./month-view"
import { AppointmentModal } from "./appointment-modal"
import type { GestureApi } from "./use-grid-gestures"
import type { BookingInitial } from "./booking-modal"

// ═══════════════════════════════════════════════════════════════
// Board da Agenda 2.0 — casca full-bleed + toolbar + Dia/Semana/Mês
// ═══════════════════════════════════════════════════════════════
// Toda leitura via listAppointments (escada de visibilidade + redação free_busy
// no servidor). Refresh: poll 30s silencioso + refetch ao trocar de visão/dia.
// Gestos (F2): drag remarca (Dia troca agenda; Semana nunca troca a pessoa) e
// resize muda duração, pela porta única; Mês sem gesto. SEM KPIs (F4), SEM criar
// por clique no slot (F3). Clique no card → modal; card busy_only não clica.

type View = "day" | "week" | "month"

function startOfWeek(base: Date): Date {
  const d = new Date(base); const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day); d.setHours(0, 0, 0, 0); return d
}

// Janela de horas da grade: DIA INTEIRO (00–24), decisão do owner 2026-07-17 —
// a janela dinâmica escondia horários e confundia. O auto-scroll do TimeGrid
// já pousa ~1h antes do "agora", então ninguém cai na madrugada.
const GRID_HOURS = { startHour: 0, endHour: 24 }

export function AgendaBoard({
  resources, services, userId, reloadSignal, onRequestBooking,
}: {
  resources: ResourceRow[]     // ativos
  services: ServiceRow[]
  isAdmin: boolean
  userId: string
  reloadSignal?: number
  /** Clique em slot vazio → pede o modal de novo agendamento (dono é o agenda-client). */
  onRequestBooking?: (init: BookingInitial) => void
}) {
  const myResources = useMemo(() => resources.filter((r) => r.assigned_agent_id === userId), [resources, userId])
  const myResourceIds = useMemo(() => new Set(myResources.map((r) => r.id)), [myResources])
  const resMap = useMemo(() => new Map(resources.map((r) => [r.id, r])), [resources])
  const svcMap = useMemo(() => new Map(services.map((s) => [s.id, s])), [services])

  const [view, setView] = useState<View>("day")
  const [anchor, setAnchor] = useState(() => new Date())
  const [scope, setScope] = useState<"all" | "mine">("all")
  const [weekRes, setWeekRes] = useState<string>(() => myResources[0]?.id ?? resources[0]?.id ?? "all")
  const [items, setItems] = useState<BoardAppt[]>([])
  const [blackouts, setBlackouts] = useState<RawBlackout[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => new Date())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [agentNames, setAgentNames] = useState<Map<string, string>>(new Map())

  const todayKey = ymdInTz(now)

  // Relógio (linha do agora + tinta de hoje) — 1min.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  // Nomes de autor (Origem no modal).
  useEffect(() => {
    void listAppointmentAgents().then((list) => setAgentNames(new Map(list.map((a) => [a.user_id, a.full_name ?? "—"]))))
  }, [])

  const rangeFor = useCallback((v: View, a: Date): { start: Date; end: Date } => {
    if (v === "week") { const start = startOfWeek(a); const end = new Date(start); end.setDate(end.getDate() + 7); return { start, end } }
    if (v === "month") {
      const grid = buildMonthGrid(new Date(a.getFullYear(), a.getMonth(), 1))
      const start = new Date(grid[0]); start.setHours(0, 0, 0, 0)
      const end = new Date(grid[grid.length - 1]); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() + 1)
      return { start, end }
    }
    const start = new Date(a); start.setHours(0, 0, 0, 0)
    const end = new Date(start); end.setDate(end.getDate() + 1)
    return { start, end }
  }, [])

  const doFetch = useCallback(async (showLoading: boolean) => {
    if (showLoading) setLoading(true)
    const { start, end } = rangeFor(view, anchor)
    const [raw, bl] = await Promise.all([
      listAppointments({ rangeStart: start.toISOString(), rangeEnd: end.toISOString() }) as unknown as Promise<RawAppt[]>,
      listBlackouts(),
    ])
    const noted = new Set(await getAppointmentNoteFlags(raw.map((r) => r.id)))
    setItems(raw.map((r) => normalizeAppt(r, resMap, svcMap, noted)))
    setBlackouts(bl as RawBlackout[])
    if (showLoading) setLoading(false)
  }, [rangeFor, view, anchor, resMap, svcMap])

  useEffect(() => { void doFetch(true) }, [doFetch, reloadSignal])
  useEffect(() => { const t = setInterval(() => void doFetch(false), 30_000); return () => clearInterval(t) }, [doFetch])

  const { startHour, endHour } = GRID_HOURS

  // API de gestos (drag/resize): actions da porta única + reload + nome do recurso.
  const gestures = useMemo<GestureApi>(() => ({
    reschedule: (id, startISO, resourceId) => rescheduleAppointment(id, startISO, resourceId),
    resize: (id, durMin) => resizeAppointment(id, durMin),
    reload: () => { void doFetch(false) },
    resourceName: (id) => resMap.get(id)?.name ?? "agenda",
  }), [doFetch, resMap])
  const resourceName = useCallback((id: string) => resMap.get(id)?.name ?? "", [resMap])

  // Slot vazio → resolve a agenda (Dia usa a coluna; Semana usa a selecionada, ou 1º recurso no modo equipe) e pede o modal.
  const handleSlot = useCallback((resId: string | undefined, dateKey: string, startMin: number) => {
    const resourceId = resId ?? (weekRes !== "all" ? weekRes : resources[0]?.id)
    if (!resourceId) return
    onRequestBooking?.({ resourceId, dateKey, startMin })
  }, [weekRes, resources, onRequestBooking])

  // Escopo p/ Dia (colunas) e Mês (pool).
  const dayResources = scope === "mine" ? myResources : resources
  const monthPool = scope === "mine" ? items.filter((a) => myResourceIds.has(a.resourceId)) : items

  const weekDays = useMemo(() => {
    const ws = startOfWeek(anchor)
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(ws); d.setDate(ws.getDate() + i); return d })
  }, [anchor])

  function shift(dir: number) {
    setAnchor((d) => {
      const n = new Date(d)
      if (view === "month") n.setMonth(n.getMonth() + dir)
      else n.setDate(n.getDate() + dir * (view === "week" ? 7 : 1))
      return n
    })
  }

  const dateLabel = useMemo(() => {
    if (view === "week") {
      const ws = startOfWeek(anchor); const we = new Date(ws); we.setDate(we.getDate() + 6)
      return `${ws.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" })} – ${we.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" })}`
    }
    if (view === "month") return cap(anchor.toLocaleDateString("pt-BR", { timeZone: TZ, month: "long", year: "numeric" }))
    const isToday = ymdInTz(anchor) === todayKey
    return (isToday ? "Hoje · " : "") + cap(anchor.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "long" }))
  }, [view, anchor, todayKey])

  const detail = detailId ? items.find((a) => a.id === detailId) ?? null : null

  return (
    <div className="space-y-3">
      {/* Toolbar compacta (board §2.3 — sem header de canvas) */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center h-9 rounded-lg border border-slate-200 bg-white">
          <button onClick={() => shift(-1)} className="size-9 grid place-items-center text-slate-500 hover:bg-slate-50 rounded-l-lg transition-colors" aria-label="Anterior"><ChevronLeft className="size-4" /></button>
          <button onClick={() => setAnchor(new Date())} className="px-3 h-9 text-xs font-semibold text-slate-600 hover:bg-slate-50 border-x border-slate-200 transition-colors">Hoje</button>
          <button onClick={() => shift(1)} className="size-9 grid place-items-center text-slate-500 hover:bg-slate-50 rounded-r-lg transition-colors" aria-label="Próximo"><ChevronRight className="size-4" /></button>
        </div>
        <span className="text-sm font-semibold text-slate-800 capitalize hidden sm:inline">{dateLabel}</span>

        <div className="inline-flex items-center h-9 rounded-lg border border-slate-200 bg-white p-0.5">
          {([["day", "Dia"], ["week", "Semana"], ["month", "Mês"]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)}
              className={`h-full px-3 text-xs font-semibold rounded-md transition-colors ${view === v ? "bg-primary-50 text-primary-700" : "text-slate-500 hover:text-slate-800"}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {view === "week" ? (
            <div className="w-52"><SimpleSelect value={weekRes} onChange={setWeekRes} className="h-9 text-xs"
              options={[{ value: "all", label: "Todas (equipe)" }, ...resources.map((r) => ({ value: r.id, label: r.name }))]} /></div>
          ) : (
            myResources.length > 0 && resources.length > myResources.length && (
              <div className="w-40"><SimpleSelect value={scope} onChange={(v) => setScope(v as "all" | "mine")} className="h-9 text-xs"
                options={[{ value: "all", label: "Equipe" }, { value: "mine", label: "Minha agenda" }]} /></div>
            )
          )}
          <Legend />
        </div>
      </div>

      {/* Conteúdo */}
      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white py-24 text-center text-sm text-slate-400">Carregando…</div>
      ) : view === "day" ? (
        <DayView resources={dayResources} appts={items} blackouts={blackouts} dayKey={ymdInTz(anchor)} todayKey={todayKey} startHour={startHour} endHour={endHour} now={now} onOpen={setDetailId} gestures={gestures} onSlotClick={handleSlot} />
      ) : view === "week" ? (
        <WeekView weekDays={weekDays} appts={items} blackouts={blackouts} weekRes={weekRes} resourceName={resourceName} todayKey={todayKey} startHour={startHour} endHour={endHour} now={now} onOpen={setDetailId} gestures={gestures} onSlotClick={handleSlot} />
      ) : (
        <MonthView month={new Date(anchor.getFullYear(), anchor.getMonth(), 1)} appts={monthPool} todayKey={todayKey}
          onOpenDay={(d) => { setAnchor(d); setView("day") }} />
      )}

      {detail && (
        <AppointmentModal appt={detail} agentNames={agentNames} services={services} resources={resources} onClose={() => setDetailId(null)} onChanged={() => void doFetch(false)} />
      )}
    </div>
  )
}

// Legenda de cores (hexes exatos do protótipo).
function Legend() {
  const items: [string, React.CSSProperties][] = [
    ["Confirmado", { background: "#059669" }],
    ["Aguarda", { background: "#fbbf24" }],
    ["Concluído", { background: "#cbd5e1" }],
    ["Faltou", { background: "#ef4444" }],
    ["Cancelado", { background: "#fee2e2", border: "1px solid #fecaca" }],
  ]
  return (
    <div className="hidden lg:flex items-center gap-3 text-[11px] text-slate-500">
      {items.map(([label, style]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <i className="size-2.5 rounded-[3px] inline-block" style={style} />{label}
        </span>
      ))}
    </div>
  )
}
