"use client"

import { TimeGrid, type GridColumn } from "./time-grid"
import { initial } from "./lanes"
import { resourceSubLabel, blackoutBlockForDay, type BoardAppt, type RawBlackout } from "./types"
import type { GestureApi } from "./use-grid-gestures"
import type { ResourceRow } from "@/lib/actions/agenda"

// ═══════════════════════════════════════════════════════════════
// Visão DIA — colunas por recurso (avatar + nome + tipo)
// ═══════════════════════════════════════════════════════════════
// Todas as colunas são o mesmo dia (o anchor). Soltar um card noutra coluna =
// troca de agenda (a coluna define o recurso). Tinta de "hoje" quando é hoje.

export function DayView({
  resources, appts, blackouts, dayKey, todayKey, startHour, endHour, now, onOpen, gestures, onSlotClick,
}: {
  resources: ResourceRow[]
  appts: BoardAppt[]              // só do dia ancorado (todos os recursos)
  blackouts: RawBlackout[]
  dayKey: string
  todayKey: string
  startHour: number
  endHour: number
  now: Date
  onOpen: (id: string) => void
  gestures: GestureApi | null
  onSlotClick: (resourceId: string | undefined, dateKey: string, startMin: number) => void
}) {
  const isToday = dayKey === todayKey
  const columns: GridColumn[] = resources.map((r) => ({
    key: r.id,
    isToday,
    showWho: false,
    dateKey: dayKey,
    resourceId: r.id,
    appts: appts.filter((a) => a.resourceId === r.id && a.dateKey === dayKey),
    blackouts: blackouts
      .filter((b) => b.resource_id === r.id || b.resource_id === null)
      .map((b) => blackoutBlockForDay(b, dayKey))
      .filter((b): b is NonNullable<typeof b> => b !== null),
    header: (
      <div className="flex items-center gap-2">
        <span className="size-8 shrink-0 rounded-full grid place-items-center text-[12px] font-bold text-slate-500 bg-gradient-to-br from-white to-slate-200 ring-1 ring-inset ring-slate-200/70">
          {initial(r.name)}
        </span>
        <div className="min-w-0">
          <p className={`text-[12.5px] font-semibold leading-tight truncate ${isToday ? "text-primary-700" : "text-slate-800"}`}>{r.name}</p>
          <p className="text-[10.5px] text-slate-400 leading-tight truncate">{resourceSubLabel(r)}</p>
        </div>
      </div>
    ),
  }))

  if (columns.length === 0) {
    return <div className="rounded-xl border border-slate-200 bg-white py-24 text-center text-sm text-slate-400">Nenhuma agenda pra mostrar neste escopo.</div>
  }

  return <TimeGrid columns={columns} startHour={startHour} endHour={endHour} now={now} onOpen={onOpen} gestures={gestures} onSlotClick={onSlotClick} colMinWidth={190} />
}
