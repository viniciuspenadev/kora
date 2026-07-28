"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Filter, Lock } from "lucide-react"
import { SimpleSelect } from "@/components/ui/select"
import {
  listAppointments, listAppointmentAgents, getAppointmentNoteFlags, listBlackouts,
  rescheduleAppointment, resizeAppointment,
  type ResourceRow, type ServiceRow,
} from "@/lib/actions/agenda"
import { TZ, cap, ymdInTz, STATUS_COLORS } from "./lanes"
import { normalizeAppt, type BoardAppt, type RawAppt, type RawBlackout } from "./types"
import { DayView } from "./day-view"
import { WeekView } from "./week-view"
import { MonthView, buildMonthGrid } from "./month-view"
import { AppointmentModal } from "./appointment-modal"
import type { GestureApi } from "./use-grid-gestures"
import type { BookingInitial } from "./booking-modal"

// ═══════════════════════════════════════════════════════════════
// Board da Agenda 2.0 — casca full-bleed + BARRA ÚNICA + Dia/Semana/Mês
// ═══════════════════════════════════════════════════════════════
// Toda leitura via listAppointments (visibilidade de SEGURANÇA já aplicada no
// servidor). O filtro do funil é LENTE VISUAL client-side POR CIMA disso (nunca
// esconde nada server-side). Refresh: poll 30s + refetch ao trocar de visão/dia.

type View = "day" | "week" | "month"

// Filtro de status (fonte de cor = STATUS_COLORS, única). Ordem fixa.
const STATUS_FILTER: { key: string; label: string }[] = [
  { key: "confirmed", label: "Confirmado" },
  { key: "scheduled", label: "Aguarda" },
  { key: "done", label: "Concluído" },
  { key: "no_show", label: "Faltou" },
  { key: "canceled", label: "Cancelado" },
]

function startOfWeek(base: Date): Date {
  const d = new Date(base); const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day); d.setHours(0, 0, 0, 0); return d
}

// Janela de horas da grade: DIA INTEIRO (00–24), decisão do owner 2026-07-17 —
// a janela dinâmica escondia horários. O auto-scroll do TimeGrid pousa ~1h antes do agora.
const GRID_HOURS = { startHour: 0, endHour: 24 }

export function AgendaBoard({
  resources, services, userId, reloadSignal, onRequestBooking, leading,
}: {
  resources: ResourceRow[]     // ativos
  services: ServiceRow[]
  isAdmin: boolean
  userId: string
  reloadSignal?: number
  /** Clique em slot vazio → pede o modal de novo agendamento (dono é o agenda-client). */
  onRequestBooking?: (init: BookingInitial) => void
  /** Switch Visão Geral|Calendário fundido como 1º item da barra. */
  leading?: React.ReactNode
}) {
  const myResources = useMemo(() => resources.filter((r) => r.assigned_agent_id === userId), [resources, userId])
  const myResourceIds = useMemo(() => new Set(myResources.map((r) => r.id)), [myResources])
  const resMap = useMemo(() => new Map(resources.map((r) => [r.id, r])), [resources])
  const svcMap = useMemo(() => new Map(services.map((s) => [s.id, s])), [services])

  const [view, setView] = useState<View>("day")
  const [anchor, setAnchor] = useState(() => new Date())
  const [weekRes, setWeekRes] = useState<string>(() => myResources[0]?.id ?? resources[0]?.id ?? "all")
  const [items, setItems] = useState<BoardAppt[]>([])
  const [blackouts, setBlackouts] = useState<RawBlackout[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => new Date())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [agentNames, setAgentNames] = useState<Map<string, string>>(new Map())
  const [hourPx, setHourPx] = useState(72)   // densidade vertical (48/72/96) — persiste por atendente

  // Filtro (lente): status + agendas ocultos + bloqueios. Persistido em localStorage.
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<string>>(new Set())
  const [hiddenResources, setHiddenResources] = useState<Set<string>>(new Set())
  const [hideBlackouts, setHideBlackouts] = useState(false)
  // Popover aberto (date | filter) + rect do trigger (fixed, imune ao overflow da barra).
  const [pop, setPop] = useState<{ kind: "date" | "filter"; rect: DOMRect } | null>(null)

  const todayKey = ymdInTz(now)

  // Densidade persistida (precedente do zoom do kanban). Lê no mount.
  useEffect(() => {
    const stored = Number(localStorage.getItem("agenda:densidade"))
    if (stored === 48 || stored === 72 || stored === 96) setHourPx(stored)
  }, [])
  const setDensity = (px: number) => { setHourPx(px); try { localStorage.setItem("agenda:densidade", String(px)) } catch { /* modo privado */ } }

  // Filtros persistidos — lê no mount; escrita nas mutações (evita clobber de ordem de efeito).
  useEffect(() => {
    try {
      const raw = localStorage.getItem("agenda:filtros")
      if (!raw) return
      const p = JSON.parse(raw) as { hiddenStatuses?: string[]; hiddenResources?: string[]; hideBlackouts?: boolean }
      if (Array.isArray(p.hiddenStatuses)) setHiddenStatuses(new Set(p.hiddenStatuses))
      if (Array.isArray(p.hiddenResources)) setHiddenResources(new Set(p.hiddenResources))
      if (typeof p.hideBlackouts === "boolean") setHideBlackouts(p.hideBlackouts)
    } catch { /* ignore */ }
  }, [])
  const persistFilters = (hs: Set<string>, hr: Set<string>, hb: boolean) => {
    try { localStorage.setItem("agenda:filtros", JSON.stringify({ hiddenStatuses: [...hs], hiddenResources: [...hr], hideBlackouts: hb })) } catch { /* ignore */ }
  }
  function toggleStatus(key: string) {
    setHiddenStatuses((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); persistFilters(n, hiddenResources, hideBlackouts); return n })
  }
  function toggleResource(id: string) {
    setHiddenResources((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); persistFilters(hiddenStatuses, n, hideBlackouts); return n })
  }
  function onlyMine() {
    const n = new Set(resources.filter((r) => !myResourceIds.has(r.id)).map((r) => r.id))
    setHiddenResources(n); persistFilters(hiddenStatuses, n, hideBlackouts)
  }
  function allResources() { setHiddenResources(new Set()); persistFilters(hiddenStatuses, new Set(), hideBlackouts) }
  function allStatuses() { setHiddenStatuses(new Set()); persistFilters(new Set(), hiddenResources, hideBlackouts) }
  function toggleBlackouts() { setHideBlackouts((v) => { persistFilters(hiddenStatuses, hiddenResources, !v); return !v }) }
  function clearFilters() { setHiddenStatuses(new Set()); setHiddenResources(new Set()); setHideBlackouts(false); persistFilters(new Set(), new Set(), false) }

  // Relógio (linha do agora + tinta de hoje) — 1min.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  // Nomes de autor (Origem no modal).
  useEffect(() => {
    void listAppointmentAgents().then((list) => setAgentNames(new Map(list.map((a) => [a.user_id, a.full_name ?? "—"]))))
  }, [])

  // Fecha popover no Esc.
  useEffect(() => {
    if (!pop) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPop(null) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [pop])

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

  // ── LENTE do filtro (client-side, por cima da visibilidade do servidor) ──
  const statusVisible = useMemo(
    () => items.filter((a) => a.busyOnly || !hiddenStatuses.has(a.status)),
    [items, hiddenStatuses],
  )
  const dayResources = useMemo(() => resources.filter((r) => !hiddenResources.has(r.id)), [resources, hiddenResources])
  const monthPool = useMemo(() => statusVisible.filter((a) => !hiddenResources.has(a.resourceId)), [statusVisible, hiddenResources])
  // Bloqueios ocultos = lente VISUAL; o servidor continua recusando marcação em cima deles.
  const visibleBlackouts = useMemo(() => (hideBlackouts ? [] : blackouts), [hideBlackouts, blackouts])
  const resourceFilterActive = view === "day" || view === "month"
  const hiddenCount = hiddenStatuses.size + (resourceFilterActive ? hiddenResources.size : 0) + (hideBlackouts ? 1 : 0)

  const weekDays = useMemo(() => {
    const ws = startOfWeek(anchor)
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(ws); d.setDate(ws.getDate() + i); return d })
  }, [anchor])

  function shift(dir: number) {
    setPop(null)
    setAnchor((d) => {
      const n = new Date(d)
      if (view === "month") n.setMonth(n.getMonth() + dir)
      else n.setDate(n.getDate() + dir * (view === "week" ? 7 : 1))
      return n
    })
  }
  function jumpTo(d: Date) { setAnchor(d); setPop(null) }
  function changeView(v: View) { setView(v); setPop(null) }
  function togglePop(kind: "date" | "filter", e: React.MouseEvent) {
    const rect = e.currentTarget.getBoundingClientRect()
    setPop((p) => (p?.kind === kind ? null : { kind, rect }))
  }

  // Rótulo de data CURTO (sem ano no dia/semana).
  const dateLabel = useMemo(() => {
    if (view === "week") {
      const ws = startOfWeek(anchor); const we = new Date(ws); we.setDate(we.getDate() + 6)
      const d1 = ws.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit" })
      const d2 = we.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit" })
      const m1 = ws.toLocaleDateString("pt-BR", { timeZone: TZ, month: "short" }).replace(".", "")
      const m2 = we.toLocaleDateString("pt-BR", { timeZone: TZ, month: "short" }).replace(".", "")
      return ws.getMonth() === we.getMonth() ? `${d1}–${d2} ${m2}` : `${d1} ${m1} – ${d2} ${m2}`
    }
    if (view === "month") return cap(anchor.toLocaleDateString("pt-BR", { timeZone: TZ, month: "long", year: "numeric" }))
    const wd = anchor.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short" }).replace(".", "")
    const dm = anchor.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" }).replace(".", "")
    return `${wd} ${dm}`
  }, [view, anchor])

  const detail = detailId ? items.find((a) => a.id === detailId) ?? null : null
  const PILL = "inline-flex items-center h-9 rounded-lg border border-slate-200 bg-white shrink-0"

  return (
    <div className="space-y-3">
      {/* BARRA ÚNICA — rola na horizontal em telas estreitas, nunca quebra */}
      <div className="relative z-40 flex items-center gap-2 flex-nowrap overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {leading && <div className="shrink-0">{leading}</div>}

        <div className={PILL}>
          <button onClick={() => shift(-1)} className="size-9 grid place-items-center text-slate-500 hover:bg-slate-50 rounded-l-lg transition-colors" aria-label="Anterior"><ChevronLeft className="size-4" /></button>
          <button onClick={() => jumpTo(new Date())} className="px-3 h-9 text-xs font-semibold text-slate-600 hover:bg-slate-50 border-x border-slate-200 transition-colors">Hoje</button>
          <button onClick={() => shift(1)} className="size-9 grid place-items-center text-slate-500 hover:bg-slate-50 rounded-r-lg transition-colors" aria-label="Próximo"><ChevronRight className="size-4" /></button>
        </div>

        {/* Rótulo curto CLICÁVEL → popover mini-calendário */}
        <button onClick={(e) => togglePop("date", e)}
          className={`px-3 h-9 text-xs font-semibold capitalize transition-colors ${PILL} ${pop?.kind === "date" ? "text-primary-700 border-primary-200 bg-primary-50" : "text-slate-700 hover:bg-slate-50"}`}>
          {dateLabel}
        </button>

        <div className="inline-flex items-center h-9 rounded-lg border border-slate-200 bg-white p-0.5 shrink-0">
          {([["day", "Dia"], ["week", "Semana"], ["month", "Mês"]] as const).map(([v, label]) => (
            <button key={v} onClick={() => changeView(v)}
              className={`h-full px-3 text-xs font-semibold rounded-md transition-colors ${view === v ? "bg-primary-50 text-primary-700" : "text-slate-500 hover:text-slate-800"}`}>
              {label}
            </button>
          ))}
        </div>

        {view === "week" && (
          <div className="w-44 shrink-0"><SimpleSelect value={weekRes} onChange={setWeekRes} className="h-9 text-xs"
            options={[{ value: "all", label: "Todas (equipe)" }, ...resources.map((r) => ({ value: r.id, label: r.name }))]} /></div>
        )}

        <div className="ml-auto shrink-0" />

        {view !== "month" && <DensityControl value={hourPx} onChange={setDensity} />}

        {/* FILTRO (funil) — substitui a legenda; badge quando há algo oculto */}
        <button onClick={(e) => togglePop("filter", e)} aria-label="Filtrar"
          className={`relative size-9 grid place-items-center rounded-lg border transition-colors shrink-0 ${pop?.kind === "filter" || hiddenCount > 0 ? "border-primary-200 bg-primary-50 text-primary-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>
          <Filter className="size-4" />
          {hiddenCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 grid place-items-center text-[10px] font-bold text-white bg-primary rounded-full tabular-nums">{hiddenCount}</span>
          )}
        </button>
      </div>

      {/* Conteúdo */}
      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white py-24 text-center text-sm text-slate-400">Carregando…</div>
      ) : view === "day" ? (
        <DayView resources={dayResources} userId={userId} appts={statusVisible} blackouts={visibleBlackouts} dayKey={ymdInTz(anchor)} todayKey={todayKey} startHour={startHour} endHour={endHour} hourPx={hourPx} now={now} onOpen={setDetailId} gestures={gestures} onSlotClick={handleSlot} />
      ) : view === "week" ? (
        <WeekView weekDays={weekDays} appts={statusVisible} blackouts={visibleBlackouts} weekRes={weekRes} resourceName={resourceName} todayKey={todayKey} startHour={startHour} endHour={endHour} hourPx={hourPx} now={now} onOpen={setDetailId} gestures={gestures} onSlotClick={handleSlot} />
      ) : (
        <MonthView month={new Date(anchor.getFullYear(), anchor.getMonth(), 1)} appts={monthPool} todayKey={todayKey}
          onOpenDay={(d) => { setAnchor(d); setView("day") }} />
      )}

      {detail && (
        <AppointmentModal appt={detail} agentNames={agentNames} services={services} resources={resources} onClose={() => setDetailId(null)} onChanged={() => void doFetch(false)} />
      )}

      {/* Popovers (fixed, ancorados no trigger — imunes ao overflow da barra) */}
      {pop && <div className="fixed inset-0 z-30" onClick={() => setPop(null)} />}
      {pop?.kind === "date" && (
        <PopoverPanel rect={pop.rect} width={260}>
          <MiniCal anchor={anchor} todayKey={todayKey} onPick={jumpTo} onToday={() => jumpTo(new Date())} />
        </PopoverPanel>
      )}
      {pop?.kind === "filter" && (
        <PopoverPanel rect={pop.rect} width={224}>
          <FilterPanel
            hiddenStatuses={hiddenStatuses} onToggleStatus={toggleStatus} onAllStatuses={allStatuses}
            showResources={resourceFilterActive} resources={resources} hiddenResources={hiddenResources} onToggleResource={toggleResource}
            canOnlyMine={myResources.length > 0 && resources.length > myResources.length}
            onOnlyMine={onlyMine} onAllResources={allResources}
            hideBlackouts={hideBlackouts} onToggleBlackouts={toggleBlackouts}
            hiddenCount={hiddenCount} onClear={clearFilters}
          />
        </PopoverPanel>
      )}
    </div>
  )
}

// ── Popover (fixed) posicionado abaixo do trigger, clampeado à viewport ──
function PopoverPanel({ rect, width, children }: { rect: DOMRect; width: number; children: React.ReactNode }) {
  const left = Math.max(8, Math.min(rect.left, (typeof window !== "undefined" ? window.innerWidth : 1024) - width - 8))
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="fixed z-50 rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 ring-1 ring-slate-900/[0.04] animate-in fade-in-0 zoom-in-95 duration-150"
      style={{ top: rect.bottom + 6, left, width }}
    >
      {children}
    </div>
  )
}

// ── Mini-calendário do popover de data ──
function MiniCal({ anchor, todayKey, onPick, onToday }: { anchor: Date; todayKey: string; onPick: (d: Date) => void; onToday: () => void }) {
  const [month, setMonth] = useState(() => new Date(anchor.getFullYear(), anchor.getMonth(), 1))
  const grid = useMemo(() => buildMonthGrid(month), [month])
  const anchorKey = ymdInTz(anchor)
  const monthLabel = cap(month.toLocaleDateString("pt-BR", { timeZone: TZ, month: "long", year: "numeric" }))
  const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ })
  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><ChevronLeft className="size-4" /></button>
        <span className="text-sm font-semibold text-slate-800 capitalize">{monthLabel}</span>
        <button onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><ChevronRight className="size-4" /></button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => <span key={i} className="text-center text-[10px] font-semibold text-slate-400 py-1">{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {grid.map((d) => {
          const k = ymd(d)
          const inMonth = d.getMonth() === month.getMonth()
          const isSel = k === anchorKey
          const isToday = k === todayKey
          return (
            <button key={k} onClick={() => onPick(d)}
              className={`h-8 grid place-items-center text-xs rounded-lg transition-colors ${
                isSel ? "bg-primary text-white font-semibold"
                : inMonth ? "text-slate-700 hover:bg-slate-100"
                : "text-slate-300 hover:bg-slate-50"
              } ${isToday && !isSel ? "ring-1 ring-primary-300 font-semibold text-primary-700" : ""}`}>
              <span className="tabular-nums">{d.getDate()}</span>
            </button>
          )
        })}
      </div>
      <button onClick={onToday} className="w-full mt-2 h-8 text-xs font-semibold text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">Hoje</button>
    </div>
  )
}

// ── Painel do filtro (funil) — 2 NÍVEIS (owner 2026-07-18) ──
// Raiz enxuta: Status · Agendas · Bloqueios. Clicar numa categoria abre um
// painel-EXTENSÃO ao lado (flyout) com os checkboxes + atalhos (Todas/Só as
// minhas). O funil fica à direita da tela → o flyout abre pra ESQUERDA.
function FilterPanel({
  hiddenStatuses, onToggleStatus, onAllStatuses, showResources, resources, hiddenResources, onToggleResource,
  canOnlyMine, onOnlyMine, onAllResources, hideBlackouts, onToggleBlackouts, hiddenCount, onClear,
}: {
  hiddenStatuses: Set<string>; onToggleStatus: (k: string) => void; onAllStatuses: () => void
  showResources: boolean; resources: ResourceRow[]; hiddenResources: Set<string>; onToggleResource: (id: string) => void
  canOnlyMine: boolean; onOnlyMine: () => void; onAllResources: () => void
  hideBlackouts: boolean; onToggleBlackouts: () => void
  hiddenCount: number; onClear: () => void
}) {
  const [sub, setSub] = useState<"status" | "resources" | null>(null)
  const statusSummary = hiddenStatuses.size > 0 ? `${hiddenStatuses.size} oculto${hiddenStatuses.size > 1 ? "s" : ""}` : "Todos"
  const resSummary = hiddenResources.size > 0 ? `${hiddenResources.size} oculta${hiddenResources.size > 1 ? "s" : ""}` : "Todas"

  return (
    <div className="py-1.5">
      {/* Nível 1 — categorias */}
      <CatRow label="Status" summary={statusSummary} dirty={hiddenStatuses.size > 0} open={sub === "status"}
        onClick={() => setSub((s) => (s === "status" ? null : "status"))}
        swatch={<span className="flex -space-x-0.5">{STATUS_FILTER.slice(0, 4).map((s) => (
          <span key={s.key} className="size-2 rounded-full ring-1 ring-white" style={{ background: STATUS_COLORS[s.key].bg }} />
        ))}</span>}
      />
      {showResources && resources.length > 0 && (
        <CatRow label="Agendas" summary={resSummary} dirty={hiddenResources.size > 0} open={sub === "resources"}
          onClick={() => setSub((s) => (s === "resources" ? null : "resources"))} />
      )}
      <button onClick={onToggleBlackouts} className="flex items-center gap-2.5 w-full px-3 py-2 hover:bg-slate-50 transition-colors">
        <CheckBox on={!hideBlackouts} />
        <Lock className="size-3.5 text-slate-400 shrink-0" />
        <span className={`text-[12.5px] ${hideBlackouts ? "text-slate-400" : "text-slate-700"}`}>Bloqueios</span>
      </button>

      {hiddenCount > 0 && (
        <div className="border-t border-slate-100 mt-1.5 pt-1.5 px-2">
          <button onClick={onClear} className="w-full h-8 text-[12px] font-semibold text-slate-500 hover:bg-slate-50 rounded-lg transition-colors">Limpar filtros</button>
        </div>
      )}

      {/* Nível 2 — extensão (flyout à esquerda do painel) */}
      {sub === "status" && (
        <Flyout title="Status" shortcuts={<FlyLink onClick={onAllStatuses}>Todos</FlyLink>}>
          {STATUS_FILTER.map((s) => {
            const visible = !hiddenStatuses.has(s.key)
            const c = STATUS_COLORS[s.key]
            return (
              <button key={s.key} onClick={() => onToggleStatus(s.key)} className="flex items-center gap-2.5 w-full px-3 py-1.5 hover:bg-slate-50 transition-colors">
                <CheckBox on={visible} />
                <span className="size-2.5 rounded-full inline-block shrink-0" style={{ background: c.bg, border: s.key === "canceled" ? "1px solid #fecaca" : undefined }} />
                <span className={`text-[12.5px] ${visible ? "text-slate-700" : "text-slate-400"}`}>{s.label}</span>
              </button>
            )
          })}
        </Flyout>
      )}
      {sub === "resources" && (
        <Flyout title="Agendas" shortcuts={<>
          {canOnlyMine && <FlyLink primary onClick={onOnlyMine}>Só as minhas</FlyLink>}
          <FlyLink onClick={onAllResources}>Todas</FlyLink>
        </>}>
          {resources.map((r) => {
            const visible = !hiddenResources.has(r.id)
            return (
              <button key={r.id} onClick={() => onToggleResource(r.id)} className="flex items-center gap-2.5 w-full px-3 py-1.5 hover:bg-slate-50 transition-colors">
                <CheckBox on={visible} />
                <span className={`text-[12.5px] truncate ${visible ? "text-slate-700" : "text-slate-400"}`}>{r.name}</span>
              </button>
            )
          })}
        </Flyout>
      )}
    </div>
  )
}

/** Linha de categoria do nível 1: rótulo + resumo do estado + seta de extensão. */
function CatRow({ label, summary, dirty, open, onClick, swatch }: {
  label: string; summary: string; dirty: boolean; open: boolean; onClick: () => void; swatch?: React.ReactNode
}) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2.5 w-full px-3 py-2 transition-colors ${open ? "bg-primary-50/60" : "hover:bg-slate-50"}`}>
      {swatch}
      <span className={`text-[12.5px] font-medium ${open ? "text-primary-700" : "text-slate-700"}`}>{label}</span>
      <span className={`ml-auto text-[10.5px] font-semibold ${dirty ? "text-primary-600" : "text-slate-400"}`}>{summary}</span>
      <ChevronLeft className={`size-3.5 shrink-0 transition-transform ${open ? "text-primary-600" : "text-slate-300"}`} />
    </button>
  )
}

/** Painel-extensão (nível 2), ancorado à ESQUERDA do painel raiz. */
function Flyout({ title, shortcuts, children }: { title: string; shortcuts: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="absolute right-full top-0 mr-1.5 w-56 rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 ring-1 ring-slate-900/[0.04] animate-in fade-in-0 slide-in-from-right-1 duration-150 py-1.5">
      <div className="flex items-center justify-between px-3 pt-1 pb-1.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</p>
        <div className="flex items-center gap-2">{shortcuts}</div>
      </div>
      <div className="max-h-[55vh] overflow-y-auto">{children}</div>
    </div>
  )
}
function FlyLink({ primary, onClick, children }: { primary?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`text-[10.5px] font-semibold ${primary ? "text-primary-600 hover:text-primary-700" : "text-slate-400 hover:text-slate-600"}`}>
      {children}
    </button>
  )
}
function CheckBox({ on }: { on: boolean }) {
  return (
    <span className={`size-4 shrink-0 rounded-[5px] border grid place-items-center transition-colors ${on ? "bg-primary border-primary text-white" : "border-slate-300 bg-white"}`}>
      {on && (
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5l2.5 2.5 4.5-5" /></svg>
      )}
    </span>
  )
}

// Densidade vertical: Compacta 48 · Padrão 72 · Ampla 96 (px por hora).
function DensityControl({ value, onChange }: { value: number; onChange: (px: number) => void }) {
  const levels: { px: number; label: string; level: 0 | 1 | 2 }[] = [
    { px: 48, label: "Compacta", level: 0 },
    { px: 72, label: "Padrão", level: 1 },
    { px: 96, label: "Ampla", level: 2 },
  ]
  return (
    <div className="inline-flex items-center h-9 rounded-lg border border-slate-200 bg-white p-0.5 shrink-0" role="group" aria-label="Densidade das células">
      {levels.map((l) => (
        <button key={l.px} type="button" title={`Densidade: ${l.label}`} aria-label={l.label} aria-pressed={value === l.px} onClick={() => onChange(l.px)}
          className={`size-8 grid place-items-center rounded-md transition-colors ${value === l.px ? "bg-primary-50 text-primary-700" : "text-slate-400 hover:text-slate-700"}`}>
          <DensityIcon level={l.level} />
        </button>
      ))}
    </div>
  )
}
function DensityIcon({ level }: { level: 0 | 1 | 2 }) {
  const ys = level === 0 ? [5, 8, 11] : level === 1 ? [4, 8, 12] : [3, 8, 13]
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      {ys.map((y) => <line key={y} x1="3.5" y1={y} x2="12.5" y2={y} />)}
    </svg>
  )
}
