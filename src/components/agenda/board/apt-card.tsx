"use client"

import { statusStyle, minutesToLabel, initial, PX_PER_MIN, type LanePos } from "./lanes"
import { fmtBRL, type BoardAppt } from "./types"

// ═══════════════════════════════════════════════════════════════
// Cartão do compromisso na grade — cor CHEIA por status
// ═══════════════════════════════════════════════════════════════
// Posição absoluta: top/height pelo horário, left/width pela faixa (lane).
// • busy_only → bloco neutro "Ocupado", SEM clique nem gesto (livre/ocupado).
// • cancelado → visível, nome riscado, clicável, mas SEM drag/resize.
// • gestos (drag/resize) são captados pelo controller via delegação (data-appt-id
//   / data-resize / data-role=time); o onClick abre o modal em toque e clique-simples.
// • selos: ✦ IA (source ai) · 👥 capacidade N · 📝 nota.

const PILL = "text-[8.5px] font-bold px-1.5 py-px rounded-full border whitespace-nowrap"
const PILL_STYLE = { background: "rgba(255,255,255,.32)", borderColor: "rgba(255,255,255,.5)", color: "inherit" }

export function AptCard({
  a, pos, gridStartMin, showWho, onOpen,
}: {
  a: BoardAppt
  pos: LanePos | undefined
  gridStartMin: number        // startHour*60 — origem da grade
  showWho: boolean            // semana-equipe: bolinha da inicial do recurso
  onOpen: (id: string) => void
}) {
  const lanes = pos?.lanes ?? 1, lane = pos?.lane ?? 0
  const top = (a.startMin - gridStartMin) * PX_PER_MIN
  const height = Math.max(a.durMin * PX_PER_MIN - 2, 26)
  const left = `calc(${((lane / lanes) * 100).toFixed(3)}% + 4px)`
  const width = `calc(${(100 / lanes).toFixed(3)}% - 8px)`

  // Nível livre/ocupado: bloco neutro, sem PII, sem clique/gesto nem cor de status.
  if (a.busyOnly) {
    return (
      <div
        className="absolute rounded-lg border border-slate-200 bg-slate-100 text-slate-400 px-2 py-1 overflow-hidden pointer-events-none select-none"
        style={{ top, height, left, width }}
      >
        <div className="text-[9.5px] font-semibold tabular-nums leading-tight">{minutesToLabel(a.startMin)}–{minutesToLabel(a.startMin + a.durMin)}</div>
        <div className="text-[11px] font-medium leading-tight">Ocupado</div>
      </div>
    )
  }

  const st = statusStyle(a.status)
  const cx = a.status === "canceled"

  return (
    <button
      type="button"
      data-appt-id={a.id}
      data-status={a.status}
      onClick={() => onOpen(a.id)}
      title={`${a.contactName} · ${minutesToLabel(a.startMin)}–${minutesToLabel(a.startMin + a.durMin)}`}
      className={`group absolute rounded-lg border overflow-hidden text-left px-2 pt-1 pb-0.5 transition-shadow hover:shadow-md ${cx ? "opacity-85 cursor-pointer" : "cursor-grab"}`}
      style={{ top, height, left, width, background: st.bg, borderColor: st.bd, color: st.fg, boxShadow: "0 1px 2px rgba(15,23,42,.05)" }}
    >
      {showWho && a.resourceName && (
        <span
          title={a.resourceName}
          className="absolute top-1 right-1 size-[17px] rounded-full grid place-items-center text-[9px] font-bold text-slate-900 bg-white/90 z-10"
          style={{ boxShadow: "0 0 0 1px rgba(15,23,42,.18)" }}
        >
          {initial(a.resourceName)}
        </span>
      )}
      <div data-role="time" className="text-[9.5px] font-semibold tabular-nums leading-tight opacity-75">{minutesToLabel(a.startMin)}–{minutesToLabel(a.startMin + a.durMin)}</div>
      <div className={`text-[12px] font-semibold leading-snug truncate ${cx ? "line-through" : ""}`}>{a.contactName}</div>
      {a.serviceName && (
        <div className="text-[10.5px] leading-tight truncate opacity-85">
          {a.serviceName}{a.servicePrice != null ? ` · ${fmtBRL(a.servicePrice)}` : ""}
        </div>
      )}
      {(a.source === "ai" || a.resourceCapacity > 1 || a.hasNotes) && (
        <div className="flex gap-1 mt-0.5 flex-wrap">
          {a.source === "ai" && <span className={PILL} style={PILL_STYLE}>✦ IA</span>}
          {a.resourceCapacity > 1 && <span className={PILL} style={PILL_STYLE}>👥 {a.resourceCapacity}</span>}
          {a.hasNotes && <span className={PILL} style={PILL_STYLE}>📝 nota</span>}
        </div>
      )}
      {!cx && (
        <span data-resize className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100 flex items-end justify-center">
          <span className="mb-0.5 h-[3px] w-6 rounded-full bg-current opacity-40" />
        </span>
      )}
    </button>
  )
}
