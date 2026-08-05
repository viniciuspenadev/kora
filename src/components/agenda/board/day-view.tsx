"use client"

import { TimeGrid, type GridColumn } from "./time-grid"
import { UserAvatar } from "@/components/ui/user-avatar"
import { resourceSubLabel, blackoutBlockForDay, type BoardAppt, type RawBlackout } from "./types"
import type { GestureApi } from "./use-grid-gestures"
import type { ResourceRow } from "@/lib/actions/agenda"

// ═══════════════════════════════════════════════════════════════
// Visão DIA — colunas por recurso (avatar + nome + tipo)
// ═══════════════════════════════════════════════════════════════
// Todas as colunas são o mesmo dia (o anchor). Soltar um card noutra coluna =
// troca de agenda (a coluna define o recurso). Tinta de "hoje" quando é hoje.

export function DayView({
  resources, appts, blackouts, dayKey, todayKey, startHour, endHour, hourPx, now, onOpen, gestures, onSlotClick, userId,
}: {
  resources: ResourceRow[]
  userId: string
  appts: BoardAppt[]              // só do dia ancorado (todos os recursos)
  blackouts: RawBlackout[]
  dayKey: string
  todayKey: string
  startHour: number
  endHour: number
  hourPx: number
  now: Date
  onOpen: (id: string) => void
  gestures: GestureApi | null
  onSlotClick: (resourceId: string | undefined, dateKey: string, startMin: number) => void
}) {
  const isToday = dayKey === todayKey
  const columns: GridColumn[] = resources.map((r) => {
    const mine = r.assigned_agent_id === userId   // destaque: "essa coluna é a SUA agenda"
    return {
      key: r.id,
      isToday,
      accent: mine,
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
          {/* Foto REAL do dono da agenda (pedido do owner); sem atendente/foto → degradê+inicial (primitiva única). */}
          <UserAvatar userId={r.assigned_agent_id} name={r.name} size={32} />
          <div className="min-w-0">
            <p className={`flex items-center gap-1.5 text-[12.5px] font-semibold leading-tight ${mine || isToday ? "text-primary-700" : "text-slate-800"}`}>
              <span className="truncate">{r.name}</span>
              {mine && <span className="shrink-0 text-[8.5px] font-bold uppercase tracking-wide text-primary-700 bg-primary-100/80 rounded-full px-1.5 py-px">você</span>}
            </p>
            <p className="text-[10.5px] text-slate-400 leading-tight truncate">{resourceSubLabel(r)}</p>
          </div>
        </div>
      ),
    }
  })

  if (columns.length === 0) {
    return <div className="rounded-xl border border-slate-200 bg-white py-24 text-center text-sm text-slate-400">Nenhuma agenda pra mostrar neste escopo.</div>
  }

  return <TimeGrid columns={columns} startHour={startHour} endHour={endHour} hourPx={hourPx} now={now} onOpen={onOpen} gestures={gestures} onSlotClick={onSlotClick} colMinWidth={190} />
}
