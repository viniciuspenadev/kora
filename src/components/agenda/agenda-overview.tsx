"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ChevronLeft, ChevronRight, CalendarDays, ArrowRight, AlertTriangle,
  Check, CheckCheck, X, MessageSquare, UserX,
} from "lucide-react"
import { ContactPic } from "@/components/chat/contact-pic"
import { listAppointments, setAppointmentStatus, cancelAppointment } from "@/lib/actions/agenda"
import { AgendaKpiRow } from "@/components/agenda/agenda-kpi-row"

const TZ = "America/Sao_Paulo"

interface Appt {
  id: string; contact_id: string; conversation_id: string | null
  resource_id: string; service_id: string | null
  starts_at: string; ends_at: string; status: string; source: string; notes: string | null
  busy_only?:        boolean
  chat_contacts?:    { push_name: string | null; custom_name: string | null; phone_number: string | null; profile_pic_url?: string | null } | null
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

function durationLabel(a: Appt): string {
  const mins = Math.max(0, Math.round((new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60_000))
  if (mins < 60) return `${mins}min`
  const h = Math.floor(mins / 60), m = mins % 60
  return m > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`
}

/** "hoje 14:00" · "amanhã 09:00" · "ontem 15:00" · "seg 10:00" */
function relativeLabel(iso: string): string {
  const day = ymdISO(iso)
  const now = new Date()
  const at = (off: number) => { const d = new Date(now); d.setDate(d.getDate() + off); return ymd(d) }
  const prefix =
    day === at(0)  ? "hoje"   :
    day === at(1)  ? "amanhã" :
    day === at(-1) ? "ontem"  :
    new Date(iso).toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short" }).replace(".", "")
  return `${prefix} ${hhmm(iso)}`
}

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
 * Visão geral da Agenda — central de operação do dia: KPIs + fila "Precisa de
 * atenção" (aguardando confirmação / passou do horário, com ação rápida) +
 * mini-calendário (filtro de data) + agenda do dia (linha do agora) + próximos.
 * Busca os próprios dados (reusa `listAppointments`, que já aplica visibilidade).
 */
export function AgendaOverview({ onSeeAll, reloadSignal }: { onSeeAll: () => void; reloadSignal?: number }) {
  const router = useRouter()
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const [selected, setSelected] = useState<Date>(today)
  const [month, setMonth]       = useState<Date>(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [dayItems, setDayItems] = useState<Appt[]>([])
  const [markers, setMarkers]   = useState<Set<string>>(new Set())
  const [windowItems, setWindowItems] = useState<Appt[]>([])   // -48h .. +7d (atenção + próximos)
  const [loading, setLoading]   = useState(true)
  const [now, setNow]           = useState(() => new Date())

  // Relógio da "linha do agora" — atualiza a cada minuto.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

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

  // Janela única: -48h (atrasados) até +7d (próximos + aguardando confirmação).
  const loadWindow = useCallback(async () => {
    const start = new Date(); start.setHours(start.getHours() - 48)
    const end   = new Date(); end.setDate(end.getDate() + 7)
    const data = await listAppointments({ rangeStart: start.toISOString(), rangeEnd: end.toISOString() })
    setWindowItems(data as unknown as Appt[])
  }, [])

  useEffect(() => { void loadDay() }, [loadDay, reloadSignal])
  useEffect(() => { void loadMarkers() }, [loadMarkers, reloadSignal])
  useEffect(() => { void loadWindow() }, [loadWindow, reloadSignal])

  async function act(fn: () => Promise<{ error?: string }>, msg: string) {
    const r = await fn()
    if (r?.error) { toast.error(r.error); return }
    toast.success(msg); void loadDay(); void loadMarkers(); void loadWindow()
  }

  // ── Fila "Precisa de atenção" ──────────────────────────────────
  // Atrasados (passou do horário sem desfecho) + aguardando confirmação hoje/amanhã.
  const attention = useMemo(() => {
    const nowMs = now.getTime()
    const endTomorrow = new Date(now); endTomorrow.setHours(0, 0, 0, 0); endTomorrow.setDate(endTomorrow.getDate() + 2)
    const overdue = windowItems.filter((a) =>
      !a.busy_only && new Date(a.ends_at).getTime() < nowMs && (a.status === "scheduled" || a.status === "confirmed"))
    const awaiting = windowItems.filter((a) =>
      !a.busy_only && a.status === "scheduled" && new Date(a.starts_at).getTime() > nowMs && new Date(a.starts_at) < endTomorrow)
    return [
      ...overdue.map((a) => ({ a, kind: "overdue" as const })),
      ...awaiting.map((a) => ({ a, kind: "awaiting" as const })),
    ].slice(0, 6)
  }, [windowItems, now])

  // ── Próximos compromissos (5 seguintes, sem os já em atenção) ──
  const upcoming = useMemo(() => {
    const nowMs = now.getTime()
    return windowItems
      .filter((a) => !a.busy_only && new Date(a.starts_at).getTime() > nowMs && (a.status === "scheduled" || a.status === "confirmed"))
      .slice(0, 5)
  }, [windowItems, now])
  const upcomingTotal = useMemo(() =>
    windowItems.filter((a) => !a.busy_only && new Date(a.starts_at).getTime() > now.getTime() && a.status !== "canceled" && a.status !== "done").length,
  [windowItems, now])

  const isToday  = ymd(selected) === ymd(today)
  const dayLabel = (isToday ? "Hoje · " : "") + cap(selected.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "long" }))

  // Índice da linha do agora (só quando o dia selecionado é hoje).
  const nowIndex = useMemo(() => {
    if (!isToday) return -1
    return dayItems.findIndex((a) => new Date(a.starts_at).getTime() > now.getTime())
  }, [dayItems, isToday, now])

  return (
    <div className="space-y-4">
      {/* KPIs — fileira única no topo (o cartão "Hoje" absorveu a antiga linha do dia);
          escopo resolvido server-side */}
      <AgendaKpiRow />

      {/* Precisa de atenção — o motivo de abrir esta aba todo dia */}
      {attention.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-white overflow-hidden">
          <div className="flex items-center gap-2 px-4 h-11 bg-amber-50/60 border-b border-amber-100">
            <AlertTriangle className="size-4 text-amber-600 shrink-0" />
            <h2 className="text-sm font-semibold text-slate-900">Precisa de atenção</h2>
            <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full tabular-nums">{attention.length}</span>
          </div>
          <div className="divide-y divide-slate-100">
            {attention.map(({ a, kind }) => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="text-xs font-semibold text-slate-600 tabular-nums w-24 shrink-0">{relativeLabel(a.starts_at)}</span>
                <ContactAvatar a={a} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800 truncate">{contactName(a)}</p>
                  <p className="text-xs text-slate-400 truncate">{a.tenant_resources?.name}{a.tenant_services?.name ? ` · ${a.tenant_services.name}` : ""}</p>
                </div>
                <span className={`hidden sm:inline text-[10px] font-medium px-1.5 py-0.5 rounded-full border shrink-0 ${
                  kind === "overdue" ? "bg-red-50 text-red-700 border-red-100" : "bg-amber-50 text-amber-700 border-amber-100"
                }`}>
                  {kind === "overdue" ? "Passou do horário" : "Aguardando confirmação"}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  {kind === "awaiting" && <IconBtn title="Confirmar" onClick={() => act(() => setAppointmentStatus(a.id, "confirmed"), "Confirmado")}><Check className="size-4" /></IconBtn>}
                  {kind === "overdue" && <IconBtn title="Concluir" onClick={() => act(() => setAppointmentStatus(a.id, "done"), "Concluído")}><CheckCheck className="size-4" /></IconBtn>}
                  {kind === "overdue" && <IconBtn title="Faltou" onClick={() => act(() => setAppointmentStatus(a.id, "no_show"), "Marcado como falta")}><UserX className="size-4" /></IconBtn>}
                  {a.conversation_id && <IconBtn title="Abrir conversa" onClick={() => router.push(`/inbox?conversation=${a.conversation_id}`)}><MessageSquare className="size-4 text-primary-600" /></IconBtn>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
        {/* Esquerda: calendário (filtro de data) + próximos compromissos */}
        <div className="space-y-4">
          <MiniCalendar
            month={month} selected={selected} today={today} markers={markers}
            onPrev={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
            onNext={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
            onSelect={setSelected}
          />

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between px-4 h-11 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-900">Próximos</h2>
              {upcomingTotal > 0 && <span className="text-[11px] text-slate-400 tabular-nums">{upcomingTotal} em 7 dias</span>}
            </div>
            {upcoming.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6 px-4">Nada agendado pros próximos 7 dias.</p>
            ) : (
              <div className="divide-y divide-slate-50">
                {upcoming.map((a) => (
                  <button key={a.id} onClick={onSeeAll} className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50/60 text-left transition-colors">
                    <span className="text-[11px] font-semibold text-primary-700 tabular-nums w-20 shrink-0 capitalize">{relativeLabel(a.starts_at)}</span>
                    <ContactAvatar a={a} size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-800 truncate">{contactName(a)}</p>
                      {a.tenant_services?.name && <p className="text-[11px] text-slate-400 truncate">{a.tenant_services.name}</p>}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <button onClick={onSeeAll} className="w-full flex items-center justify-center gap-1.5 h-9 text-xs font-semibold text-primary-600 hover:text-primary-700 hover:bg-primary-50/40 border-t border-slate-100 transition-colors">
              Ver agenda completa <ArrowRight className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Direita: agenda do dia (linha do agora + próximo destacado) */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden min-h-[460px] flex flex-col">
          <div className="flex items-center justify-between px-4 h-12 border-b border-slate-100 shrink-0">
            <h2 className="text-sm font-semibold text-slate-900 truncate">{dayLabel}</h2>
            <button onClick={onSeeAll} className="text-xs text-primary-600 hover:text-primary-700 font-medium shrink-0">Ver completa</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="animate-pulse rounded-lg bg-slate-200/70 h-8 w-12" />
                    <div className="animate-pulse rounded-full bg-slate-200/70 size-9" />
                    <div className="flex-1 space-y-1.5">
                      <div className="animate-pulse rounded bg-slate-200/70 h-3 w-1/3" />
                      <div className="animate-pulse rounded bg-slate-200/70 h-2 w-1/4" />
                    </div>
                  </div>
                ))}
              </div>
            ) : dayItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center px-4 text-center py-16">
                <CalendarDays className="size-8 text-slate-200 mb-2" strokeWidth={1.5} />
                <p className="text-sm font-medium text-slate-500">Nada agendado{isToday ? " hoje" : " neste dia"}</p>
                <p className="text-xs text-slate-400 mt-0.5">Aproveite, ou marque um novo compromisso na agenda.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {dayItems.map((a, i) => {
                  const st = STATUS[a.status] ?? STATUS.scheduled
                  const closed = a.status === "canceled" || a.status === "done"
                  const isNext = isToday && i === nowIndex
                  return (
                    <div key={a.id}>
                      {/* Linha do agora — antes do primeiro compromisso futuro */}
                      {isToday && i === nowIndex && (
                        <div className="flex items-center gap-2 px-4 py-1">
                          <span className="size-1.5 rounded-full bg-red-500 shrink-0" />
                          <span className="text-[10px] font-bold text-red-500 tabular-nums shrink-0">{hhmm(now.toISOString())}</span>
                          <span className="h-px flex-1 bg-red-200" />
                        </div>
                      )}
                      <div className={`flex items-center gap-3 px-4 py-3 transition-colors ${isNext ? "bg-primary-50/40" : "hover:bg-slate-50/50"}`}>
                        <div className="flex flex-col items-center w-12 shrink-0">
                          <span className="text-sm font-bold text-slate-900 tabular-nums">{hhmm(a.starts_at)}</span>
                          <span className="text-[11px] text-slate-400 tabular-nums">{hhmm(a.ends_at)}</span>
                        </div>
                        <div className={`w-1 self-stretch rounded-full ${isNext ? "bg-primary" : "bg-primary/20"}`} />
                        {a.busy_only ? (
                          <div className="min-w-0 flex-1">
                            <span className="text-sm font-medium text-slate-500">Ocupado</span>
                            <p className="text-xs text-slate-400 truncate mt-0.5">{a.tenant_resources?.name}</p>
                          </div>
                        ) : (
                          <>
                            <ContactAvatar a={a} size={36} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-slate-800 truncate">{contactName(a)}</span>
                                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border shrink-0 ${st.chip}`}>{st.label}</span>
                                {isNext && <span className="text-[10px] font-bold text-primary-700 bg-primary-100 px-1.5 py-0.5 rounded-full shrink-0">Próximo</span>}
                              </div>
                              <p className="text-xs text-slate-500 truncate mt-0.5">
                                {a.tenant_resources?.name}{a.tenant_services?.name ? ` · ${a.tenant_services.name}` : ""}
                                <span className="text-slate-300"> · </span><span className="tabular-nums">{durationLabel(a)}</span>
                              </p>
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
                    </div>
                  )
                })}
                {/* Linha do agora depois do último (todos já passaram) */}
                {isToday && nowIndex === -1 && dayItems.length > 0 && (
                  <div className="flex items-center gap-2 px-4 py-1">
                    <span className="size-1.5 rounded-full bg-red-500 shrink-0" />
                    <span className="text-[10px] font-bold text-red-500 tabular-nums shrink-0">{hhmm(now.toISOString())}</span>
                    <span className="h-px flex-1 bg-red-200" />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Avatar do contato — degradê branco padrão (design-system §9) ──
function ContactAvatar({ a, size }: { a: Appt; size: number }) {
  const name = contactName(a)
  return (
    <span
      className="shrink-0 rounded-full overflow-hidden flex items-center justify-center bg-gradient-to-br from-white to-slate-200 text-slate-400 ring-1 ring-inset ring-slate-200/70"
      style={{ width: size, height: size }}
    >
      <ContactPic
        pic={a.chat_contacts?.profile_pic_url}
        imgClass="size-full object-cover"
        fallback={<span className="font-bold leading-none" style={{ fontSize: Math.round(size * 0.4) }}>{(name[0] ?? "?").toUpperCase()}</span>}
      />
    </span>
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


// Ações neutras por padrão, azul no hover (sem verde/vermelho). Tooltip dá o sentido.
function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" title={title} onClick={onClick} className="size-8 grid place-items-center rounded-lg text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-colors">{children}</button>
}
