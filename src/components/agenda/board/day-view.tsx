"use client"

import { TimeGrid, type GridColumn, type GhostMark } from "./time-grid"
import type { DayItem } from "@/lib/actions/my-day"
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
  resources, appts, blackouts, dayKey, todayKey, startHour, endHour, hourPx, now, onOpen, gestures, onSlotClick, userId, followUps = [],
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
  /** Compromissos internos (follow-ups) da janela — viram BANDA: no Dia as colunas
   *  são recursos, e a promessa não é de recurso nenhum. */
  followUps?: DayItem[]
}) {
  const isToday = dayKey === todayKey
  // A banda abre a FICHA da promessa, igual ao bloco na coluna — antes ela pulava
  // direto pra conversa, e o dono cobrou a inconsistência (sair do calendário sem pedir).
  const band: GhostMark[] = followUps
    .filter((f) => ymdInTzLocal(f.at) === dayKey)
    .map((f) => ({
      id: f.id, dateKey: dayKey, startMin: minutesOf(f.at),
      label: f.title, onClick: () => onOpen(f.id),
    }))
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
    return <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500"><p>Nenhuma agenda neste escopo.</p>{band.map(item=><button key={item.id} onClick={item.onClick} className="mt-3 block w-full rounded-lg border border-slate-200 p-3 text-left text-slate-700">{item.label}</button>)}</div>
  }

  return <TimeGrid columns={columns} startHour={startHour} endHour={endHour} hourPx={hourPx} now={now} onOpen={onOpen} gestures={gestures} onSlotClick={onSlotClick} colMinWidth={190} bandGhosts={band} />
}

const TZ_BOARD = "America/Sao_Paulo"
const ymdInTzLocal = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ_BOARD })
/** Minuto do dia no fuso do negócio — mesma base que a grade usa pra posicionar. */
function minutesOf(iso: string): number {
  const [h, m] = new Date(iso)
    .toLocaleTimeString("en-GB", { timeZone: TZ_BOARD, hour: "2-digit", minute: "2-digit" })
    .split(":")
  return Number(h) * 60 + Number(m)
}
