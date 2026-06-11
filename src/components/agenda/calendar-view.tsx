"use client"

import { useMemo, useRef, useEffect, useState } from "react"

// ═══════════════════════════════════════════════════════════════
// Calendário de grade (time-grid) — o coração visual da Agenda
// ═══════════════════════════════════════════════════════════════
// Dois modos partilham o mesmo eixo de horas:
//   • "dia"    → colunas = RECURSOS (raias por recurso)
//   • "semana" → colunas = DIAS
// Blocos posicionados por horário; linha do "agora"; clique no vazio
// cria (com a hora aproximada); clique no bloco abre o detalhe.

const TZ = "America/Sao_Paulo"
const HOUR_PX = 52
const SNAP_MIN = 15

export interface CalEvent {
  id: string; start: Date; end: Date; status: string
  title: string; subtitle?: string
  resourceId: string; conversationId: string | null
}
export interface CalColumn {
  key: string; label: string; sublabel?: string
  day: Date            // dia que a coluna representa (p/ posicionar o "agora" e criar)
  resourceId?: string  // setado no modo "dia"
}

const BLOCK: Record<string, string> = {
  scheduled: "bg-primary-50 border-l-primary-500 text-primary-900 hover:bg-primary-100",
  confirmed: "bg-emerald-50 border-l-emerald-500 text-emerald-900 hover:bg-emerald-100",
  done:      "bg-slate-100 border-l-slate-400 text-slate-600 hover:bg-slate-200",
  no_show:   "bg-amber-50 border-l-amber-500 text-amber-900 hover:bg-amber-100",
  canceled:  "bg-red-50 border-l-red-300 text-red-500 line-through opacity-70 hover:opacity-100",
}

function minutesInTz(d: Date): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d)
  const h = +(p.find((x) => x.type === "hour")?.value ?? "0") % 24
  const m = +(p.find((x) => x.type === "minute")?.value ?? "0")
  return h * 60 + m
}
function ymd(d: Date): string { return d.toLocaleDateString("en-CA", { timeZone: TZ }) }
function sameDayTz(a: Date, b: Date): boolean { return ymd(a) === ymd(b) }

// Reparte eventos sobrepostos em "lanes" (colunas internas) p/ não empilharem.
function layout(events: CalEvent[]): { ev: CalEvent; lane: number; lanes: number }[] {
  const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime())
  const out: { ev: CalEvent; lane: number; lanes: number }[] = []
  let cluster: typeof out = []
  let clusterEnd = 0
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1))
    cluster.forEach((c) => (c.lanes = lanes))
    cluster = []
  }
  for (const ev of sorted) {
    if (cluster.length && ev.start.getTime() >= clusterEnd) flush()
    const used = new Set(cluster.filter((c) => c.ev.end.getTime() > ev.start.getTime()).map((c) => c.lane))
    let lane = 0
    while (used.has(lane)) lane++
    cluster.push({ ev, lane, lanes: 1 })
    out.push(cluster[cluster.length - 1])
    clusterEnd = Math.max(clusterEnd, ev.end.getTime())
  }
  flush()
  return out
}

export function CalendarView({
  columns, events, startHour, endHour, onSelect, onCreateAt,
}: {
  columns: CalColumn[]
  events: CalEvent[]
  startHour: number
  endHour: number
  onSelect: (id: string) => void
  onCreateAt: (col: CalColumn, hour: number, minute: number) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => new Date())
  const totalH = (endHour - startHour) * HOUR_PX
  const hours = useMemo(() => Array.from({ length: endHour - startHour }, (_, i) => startHour + i), [startHour, endHour])

  // Tick da linha do "agora" a cada minuto.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  // Auto-scroll pra ~1h antes do "agora" (ou início) ao montar.
  useEffect(() => {
    if (!scrollRef.current) return
    const nowMin = minutesInTz(new Date())
    const target = Math.max(0, (nowMin - startHour * 60) / 60 - 1) * HOUR_PX
    scrollRef.current.scrollTop = target
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const nowMin = minutesInTz(now)
  const nowTop = ((nowMin - startHour * 60) / 60) * HOUR_PX
  const nowVisible = nowMin >= startHour * 60 && nowMin <= endHour * 60

  function handleColClick(e: React.MouseEvent<HTMLDivElement>, col: CalColumn) {
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const totalMin = startHour * 60 + Math.round((y / HOUR_PX) * 60 / SNAP_MIN) * SNAP_MIN
    onCreateAt(col, Math.floor(totalMin / 60), totalMin % 60)
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col">
      {/* Cabeçalho das colunas (sticky) */}
      <div className="flex border-b border-slate-200 bg-slate-50/80 backdrop-blur">
        <div className="w-14 shrink-0 border-r border-slate-100" />
        <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0,1fr))` }}>
          {columns.map((c) => {
            const isToday = sameDayTz(c.day, now)
            return (
              <div key={c.key} className="px-2 py-2 text-center border-l border-slate-100 first:border-l-0">
                <p className={`text-xs font-semibold truncate ${isToday ? "text-primary-700" : "text-slate-700"}`}>{c.label}</p>
                {c.sublabel && <p className="text-[11px] text-slate-400 truncate">{c.sublabel}</p>}
              </div>
            )
          })}
        </div>
      </div>

      {/* Grade rolável */}
      <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: "calc(100dvh - 19rem)" }}>
        <div className="flex" style={{ height: totalH }}>
          {/* Eixo de horas */}
          <div className="w-14 shrink-0 border-r border-slate-100 relative">
            {hours.map((h) => (
              <div key={h} className="absolute right-1.5 -translate-y-1/2 text-[10px] font-medium text-slate-400 tabular-nums" style={{ top: (h - startHour) * HOUR_PX }}>
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {/* Colunas */}
          <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0,1fr))` }}>
            {columns.map((col) => {
              const colEvents = events.filter((e) =>
                col.resourceId ? e.resourceId === col.resourceId && sameDayTz(e.start, col.day) : sameDayTz(e.start, col.day),
              )
              const placed = layout(colEvents)
              const isToday = sameDayTz(col.day, now)
              return (
                <div
                  key={col.key}
                  onClick={(e) => handleColClick(e, col)}
                  className="relative border-l border-slate-100 first:border-l-0 cursor-copy group"
                >
                  {/* linhas de hora */}
                  {hours.map((h) => (
                    <div key={h} className="absolute inset-x-0 border-t border-slate-100" style={{ top: (h - startHour) * HOUR_PX }} />
                  ))}
                  {/* meia-hora (sutil) */}
                  {hours.map((h) => (
                    <div key={`half-${h}`} className="absolute inset-x-0 border-t border-dashed border-slate-50" style={{ top: (h - startHour) * HOUR_PX + HOUR_PX / 2 }} />
                  ))}

                  {/* linha do "agora" */}
                  {isToday && nowVisible && (
                    <div className="absolute inset-x-0 z-20 pointer-events-none" style={{ top: nowTop }}>
                      <div className="h-px bg-red-500" />
                      <div className="absolute -left-1 -top-[3px] size-1.5 rounded-full bg-red-500" />
                    </div>
                  )}

                  {/* eventos */}
                  {placed.map(({ ev, lane, lanes }) => {
                    const startM = minutesInTz(ev.start)
                    const endM = Math.max(startM + 15, minutesInTz(ev.end) || startM + 15)
                    const top = ((startM - startHour * 60) / 60) * HOUR_PX
                    const height = Math.max(20, ((endM - startM) / 60) * HOUR_PX - 2)
                    const width = `calc(${100 / lanes}% - 4px)`
                    const left = `calc(${(100 / lanes) * lane}% + 2px)`
                    return (
                      <button
                        key={ev.id}
                        onClick={(e) => { e.stopPropagation(); onSelect(ev.id) }}
                        style={{ top, height, left, width }}
                        className={`absolute z-10 rounded-md border-l-[3px] px-1.5 py-1 text-left overflow-hidden transition-colors ${BLOCK[ev.status] ?? BLOCK.scheduled}`}
                      >
                        <p className="text-[11px] font-semibold leading-tight truncate">{ev.title}</p>
                        {height > 34 && ev.subtitle && <p className="text-[10px] leading-tight truncate opacity-80">{ev.subtitle}</p>}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
