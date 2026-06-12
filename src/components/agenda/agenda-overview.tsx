"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ChevronLeft, ChevronRight, CalendarDays, ArrowRight,
  Check, CheckCheck, X, MessageSquare, CalendarClock,
} from "lucide-react"
import { listAppointments, setAppointmentStatus, cancelAppointment } from "@/lib/actions/agenda"

const TZ = "America/Sao_Paulo"

interface Appt {
  id: string; contact_id: string; conversation_id: string | null
  resource_id: string; service_id: string | null
  starts_at: string; ends_at: string; status: string; source: string; notes: string | null
  busy_only?:        boolean
  chat_contacts?:    { push_name: string | null; custom_name: string | null; phone_number: string | null } | null
  tenant_services?:  { name: string } | null
  tenant_resources?: { name: string } | null
}

// Badges mantêm a cor semântica (decisão do user: só elas têm cor). O resto é azul/neutro.
const STATUS: Record<string, { label: string; chip: string }> = {
  scheduled: { label: "Agendado",   chip: "bg-primary-50 text-primary-700 border-primary-100" },
  confirmed: { label: "Confirmado", chip: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  done:      { label: "Concluído",  chip: "bg-slate-100 text-slate-600 border-slate-200" },
  no_show:   { label: "Faltou",     chip: "bg-amber-50 text-amber-700 border-amber-100" },
  canceled:  { label: "Cancelado",  chip: "bg-red-50 text-red-700 border-red-100" },
}

const contactName = (a: Appt) => a.busy_only ? "Ocupado" : (a.chat_contacts?.custom_name || a.chat_contacts?.push_name || a.chat_contacts?.phone_number || "Contato")
const hhmm   = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })
const ymd    = (d: Date)     => d.toLocaleDateString("en-CA", { timeZone: TZ })
const ymdISO = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ })
const cap    = (s: string)   => s.charAt(0).toUpperCase() + s.slice(1)

function dayBounds(day: Date) {
  const start = new Date(day); start.setHours(0, 0, 0, 0)
  const end = new Date(start); end.setDate(end.getDate() + 1)
  return { start, end }
}
function buildMonthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const gridStart = new Date(first); gridStart.setDate(1 - first.getDay())   // semana começa no domingo
  return Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d })
}

/**
 * Visão geral da Agenda (aba "Visão geral"): mini-calendário como filtro de data +
 * agenda do dia selecionado + KPIs + próximos compromissos. Busca os próprios dados
 * (reusa `listAppointments`, que já aplica visibilidade). `onSeeAll` leva à lista.
 */
export function AgendaOverview({ onSeeAll, reloadSignal }: { onSeeAll: () => void; reloadSignal?: number }) {
  const router = useRouter()
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const [selected, setSelected] = useState<Date>(today)
  const [month, setMonth]       = useState<Date>(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [dayItems, setDayItems] = useState<Appt[]>([])
  const [markers, setMarkers]   = useState<Set<string>>(new Set())
  const [upcoming, setUpcoming] = useState(0)
  const [loading, setLoading]   = useState(true)

  const loadDay = useCallback(async () => {
    setLoading(true)
    const { start, end } = dayBounds(selected)
    const data = await listAppointments({ rangeStart: start.toISOString(), rangeEnd: end.toISOString() })
    setDayItems(data as unknown as Appt[])
    setLoading(false)
  }, [selected])

  const loadMarkers = useCallback(async () => {
    const grid = buildMonthGrid(month)
    const rangeStart = new Date(grid[0]);  rangeStart.setHours(0, 0, 0, 0)
    const rangeEnd   = new Date(grid[41]); rangeEnd.setHours(0, 0, 0, 0); rangeEnd.setDate(rangeEnd.getDate() + 1)
    const data = await listAppointments({ rangeStart: rangeStart.toISOString(), rangeEnd: rangeEnd.toISOString() })
    const s = new Set<string>()
    for (const a of data as unknown as Appt[]) if (a.status !== "canceled") s.add(ymdISO(a.starts_at))
    setMarkers(s)
  }, [month])

  const loadUpcoming = useCallback(async () => {
    const now = new Date()
    const end = new Date(now); end.setDate(end.getDate() + 7)
    const data = await listAppointments({ rangeStart: now.toISOString(), rangeEnd: end.toISOString() })
    setUpcoming((data as unknown as Appt[]).filter((a) => a.status !== "canceled" && a.status !== "done").length)
  }, [])

  useEffect(() => { void loadDay() }, [loadDay, reloadSignal])
  useEffect(() => { void loadMarkers() }, [loadMarkers, reloadSignal])
  useEffect(() => { void loadUpcoming() }, [loadUpcoming, reloadSignal])

  async function act(fn: () => Promise<{ error?: string }>, msg: string) {
    const r = await fn()
    if (r?.error) { toast.error(r.error); return }
    toast.success(msg); void loadDay(); void loadMarkers(); void loadUpcoming()
  }

  const kpis = useMemo(() => {
    const c = (s: string) => dayItems.filter((a) => a.status === s).length
    return { total: dayItems.length, confirmed: c("confirmed"), waiting: c("scheduled"), done: c("done") }
  }, [dayItems])

  const isToday  = ymd(selected) === ymd(today)
  const dayLabel = (isToday ? "Hoje · " : "") + cap(selected.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "long" }))

  return (
    <div className="space-y-4">
      {/* KPIs do dia — faixa no topo (tudo azul; sem verde/âmbar) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="No dia"      value={kpis.total} />
        <Kpi label="Confirmados" value={kpis.confirmed} />
        <Kpi label="Aguardando"  value={kpis.waiting} />
        <Kpi label="Concluídos"  value={kpis.done} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
        {/* Esquerda: calendário (filtro de data) + próximos */}
        <div className="space-y-4">
          <MiniCalendar
            month={month} selected={selected} today={today} markers={markers}
            onPrev={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
            onNext={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
            onSelect={setSelected}
          />

          <button onClick={onSeeAll} className="w-full flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-primary-200 hover:bg-primary-50/40 transition-colors text-left">
            <div className="size-10 rounded-lg bg-primary-50 grid place-items-center shrink-0"><CalendarClock className="size-5 text-primary-600" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 leading-tight"><span className="tabular-nums">{upcoming}</span> compromisso{upcoming === 1 ? "" : "s"}</p>
              <p className="text-xs text-slate-400">nos próximos 7 dias</p>
            </div>
            <ArrowRight className="size-4 text-slate-300 shrink-0" />
          </button>
        </div>

        {/* Direita: agenda do dia */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden min-h-[460px] flex flex-col">
          <div className="flex items-center justify-between px-4 h-12 border-b border-slate-100 shrink-0">
            <h2 className="text-sm font-semibold text-slate-900 truncate">{dayLabel}</h2>
            <button onClick={onSeeAll} className="text-xs text-primary-600 hover:text-primary-700 font-medium shrink-0">Ver completa</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="h-full grid place-items-center text-sm text-slate-400">Carregando…</div>
            ) : dayItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center px-4 text-center py-16">
                <CalendarDays className="size-8 text-slate-200 mb-2" strokeWidth={1.5} />
                <p className="text-sm font-medium text-slate-500">Nada agendado{isToday ? " hoje" : " neste dia"}</p>
                <p className="text-xs text-slate-400 mt-0.5">Aproveite, ou marque um novo compromisso na agenda.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {dayItems.map((a) => {
                  const st = STATUS[a.status] ?? STATUS.scheduled
                  const closed = a.status === "canceled" || a.status === "done"
                  return (
                    <div key={a.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/50 transition-colors">
                      <div className="flex flex-col items-center w-12 shrink-0">
                        <span className="text-sm font-bold text-slate-900 tabular-nums">{hhmm(a.starts_at)}</span>
                        <span className="text-[11px] text-slate-400 tabular-nums">{hhmm(a.ends_at)}</span>
                      </div>
                      <div className="w-1 self-stretch rounded-full bg-primary/20" />
                      {a.busy_only ? (
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-medium text-slate-500">Ocupado</span>
                          <p className="text-xs text-slate-400 truncate mt-0.5">{a.tenant_resources?.name}</p>
                        </div>
                      ) : (
                        <>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-slate-800 truncate">{contactName(a)}</span>
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${st.chip}`}>{st.label}</span>
                            </div>
                            <p className="text-xs text-slate-500 truncate mt-0.5">{a.tenant_resources?.name}{a.tenant_services?.name ? ` · ${a.tenant_services.name}` : ""}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {!closed && a.status !== "confirmed" && <IconBtn title="Confirmar" onClick={() => act(() => setAppointmentStatus(a.id, "confirmed"), "Confirmado")}><Check className="size-4" /></IconBtn>}
                            {!closed && <IconBtn title="Concluir" onClick={() => act(() => setAppointmentStatus(a.id, "done"), "Concluído")}><CheckCheck className="size-4" /></IconBtn>}
                            {!closed && <IconBtn title="Cancelar" onClick={() => act(() => cancelAppointment(a.id), "Cancelado")}><X className="size-4" /></IconBtn>}
                            {a.conversation_id && <IconBtn title="Abrir conversa" onClick={() => router.push(`/inbox?conversation=${a.conversation_id}`)}><MessageSquare className="size-4 text-primary-600" /></IconBtn>}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Mini-calendário (também é o filtro de data) ──────────────
function MiniCalendar({ month, selected, today, markers, onPrev, onNext, onSelect }: {
  month: Date; selected: Date; today: Date; markers: Set<string>
  onPrev: () => void; onNext: () => void; onSelect: (d: Date) => void
}) {
  const grid = buildMonthGrid(month)
  const selKey = ymd(selected), todayKey = ymd(today)
  const monthLabel = cap(month.toLocaleDateString("pt-BR", { timeZone: TZ, month: "long", year: "numeric" }))
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <button onClick={onPrev} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><ChevronLeft className="size-4" /></button>
        <span className="text-sm font-semibold text-slate-800">{monthLabel}</span>
        <button onClick={onNext} className="size-7 grid place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><ChevronRight className="size-4" /></button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => <span key={i} className="text-center text-[10px] font-semibold text-slate-400 py-1">{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {grid.map((d) => {
          const k = ymd(d)
          const inMonth = d.getMonth() === month.getMonth()
          const isSel = k === selKey
          const isTodayCell = k === todayKey
          const has = markers.has(k)
          return (
            <button
              key={k} onClick={() => onSelect(d)}
              className={`relative h-8 grid place-items-center text-xs rounded-lg transition-colors ${
                isSel ? "bg-primary text-white font-semibold"
                : inMonth ? "text-slate-700 hover:bg-slate-100"
                : "text-slate-300 hover:bg-slate-50"
              } ${isTodayCell && !isSel ? "ring-1 ring-primary-300 font-semibold text-primary-700" : ""}`}
            >
              <span className="tabular-nums">{d.getDate()}</span>
              {has && <span className={`absolute bottom-1 size-1 rounded-full ${isSel ? "bg-white" : "bg-primary-500"}`} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-xl font-bold tabular-nums leading-none text-primary-700">{value}</p>
      <p className="text-[11px] text-slate-400 mt-1 truncate">{label}</p>
    </div>
  )
}

// Ações neutras por padrão, azul no hover (sem verde/vermelho). Tooltip dá o sentido.
function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" title={title} onClick={onClick} className="size-8 grid place-items-center rounded-lg text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-colors">{children}</button>
}
