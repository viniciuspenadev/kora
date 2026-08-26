"use client"

import { useRouter } from "next/navigation"
import { TimeGrid, type GridColumn, type GhostMark } from "./time-grid"
import type { DayItem } from "@/lib/actions/my-day"
import { TZ, cap } from "./lanes"
import { blackoutBlockForDay, type BoardAppt, type RawBlackout } from "./types"
import type { GestureApi } from "./use-grid-gestures"

// ═══════════════════════════════════════════════════════════════
// Visão SEMANA — colunas seg–dom de UMA agenda (ou "Todas (equipe)")
// ═══════════════════════════════════════════════════════════════
// weekRes === "all" combina as agendas: os cards ganham a bolinha da inicial do
// recurso (cor continua sendo do STATUS). Arrastar muda hora/dia — NUNCA a pessoa
// (a coluna é um dia, não define recurso). Coluna de hoje com tinta primary.

const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ })
const ymdISO = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ })
/** Minuto do dia no fuso do negócio — mesma base que a grade usa pra posicionar. */
function minutesOf(iso: string): number {
  const [h, m] = new Date(iso)
    .toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })
    .split(":")
  return Number(h) * 60 + Number(m)
}

export function WeekView({
  weekDays, appts, blackouts, weekRes, resourceName, todayKey, startHour, endHour, hourPx, now, onOpen, gestures, onSlotClick, followUps = [],
}: {
  weekDays: Date[]                // 7 dias (seg→dom)
  appts: BoardAppt[]              // da semana inteira (todos os recursos visíveis)
  blackouts: RawBlackout[]
  weekRes: string                 // "all" ou resourceId
  resourceName: (id: string) => string
  todayKey: string
  startHour: number
  endHour: number
  hourPx: number
  now: Date
  onOpen: (id: string) => void
  gestures: GestureApi | null
  onSlotClick: (resourceId: string | undefined, dateKey: string, startMin: number) => void
  /** Compromissos internos (follow-ups): aqui a coluna É um dia, então cada marca
   *  entra na coluna do seu dia — sem ambiguidade e sem recurso. */
  followUps?: DayItem[]
}) {
  const router = useRouter()
  const all = weekRes === "all"
  const columns: GridColumn[] = weekDays.map((d) => {
    const key = ymd(d)
    const dayAppts = appts.filter((a) => a.dateKey === key && (all || a.resourceId === weekRes))
    // Modo equipe: bloqueio de COLEGA é informativo (blocking=false) — só o
    // tenant-wide trava a coluna inteira. Agenda específica: tudo trava (é dela).
    const dayBlackouts = blackouts
      .filter((b) => all || b.resource_id === weekRes || b.resource_id === null)
      .map((b) => blackoutBlockForDay(b, key, {
        prefix: all && b.resource_id ? resourceName(b.resource_id) : undefined,
        blocking: all ? b.resource_id === null : true,
      }))
      .filter((b): b is NonNullable<typeof b> => b !== null)
    const count = dayAppts.filter((a) => a.status !== "canceled" && !a.busyOnly).length
    const isToday = key === todayKey
    return {
      key,
      isToday,
      showWho: all,
      dateKey: key,
      resourceId: undefined,       // Semana nunca troca a pessoa via coluna
      appts: dayAppts,
      blackouts: dayBlackouts,
      ghosts: followUps
        .filter((f) => ymdISO(f.at) === key)
        .map<GhostMark>((f) => ({
          id: f.id, dateKey: key, startMin: minutesOf(f.at),
          label: f.title, onClick: () => router.push(f.href),
        })),
      header: (
        <div className="min-w-0">
          <p className={`text-[12.5px] font-semibold leading-tight truncate ${isToday ? "text-primary-700" : "text-slate-800"}`}>
            {cap(d.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short" }).replace(".", ""))} {d.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit" })}
            {isToday ? " · hoje" : ""}
          </p>
          <p className="text-[10.5px] text-slate-400 leading-tight truncate tabular-nums">{count} agendamento{count === 1 ? "" : "s"}</p>
        </div>
      ),
    }
  })

  return <TimeGrid columns={columns} startHour={startHour} endHour={endHour} hourPx={hourPx} now={now} onOpen={onOpen} gestures={gestures} onSlotClick={onSlotClick} colMinWidth={150} />
}
