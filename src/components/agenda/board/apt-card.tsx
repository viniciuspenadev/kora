"use client"

import { statusStyle, minutesToLabel, type LanePos } from "./lanes"
import { UserAvatar } from "@/components/ui/user-avatar"
import { fmtBRL, type BoardAppt } from "./types"

// ═══════════════════════════════════════════════════════════════
// Cartão do compromisso na grade — cor CHEIA por status, "colado" (sem radius)
// ═══════════════════════════════════════════════════════════════
// Pedido do owner: sem arredondamento e sem margens — o card ocupa 100% da
// largura da faixa (lane) e da altura do slot, colado nas bordas da coluna.
// Separação por hairline BRANCA de 1px (inset box-shadow à direita e embaixo),
// pra faixas/empilhamentos adjacentes não virarem uma mancha só. Posições/altura
// derivam de `pxPerMin` (densidade dinâmica 48/72/96 px/h).
// • busy_only → bloco neutro "Ocupado", sem clique/gesto.
// • cancelado → visível, riscado, clicável, sem drag/resize.
// • gestos captados pelo controller via delegação (data-appt-id / data-resize /
//   data-role=time); o onClick abre o modal em toque e clique-simples.

const PILL = "text-[8.5px] font-bold px-1.5 py-px rounded-full border whitespace-nowrap"
const PILL_STYLE = { background: "rgba(255,255,255,.32)", borderColor: "rgba(255,255,255,.5)", color: "inherit" }
// Hairlines brancas (1px) que separam faixas adjacentes e empilhamentos verticais.
const SEPARATORS = "inset -1px 0 0 #ffffff, inset 0 -1px 0 #ffffff"

export function AptCard({
  a, pos, gridStartMin, pxPerMin, showWho, onOpen,
}: {
  a: BoardAppt
  pos: LanePos | undefined
  gridStartMin: number        // startHour*60 — origem da grade
  pxPerMin: number            // densidade dinâmica (48/72/96 px/h ÷ 60)
  showWho: boolean            // semana-equipe: bolinha da inicial do recurso
  onOpen: (id: string) => void
}) {
  const lanes = pos?.lanes ?? 1, lane = pos?.lane ?? 0
  const top = (a.startMin - gridStartMin) * pxPerMin
  const height = Math.max(a.durMin * pxPerMin, 14)
  const left = `${((lane / lanes) * 100).toFixed(3)}%`
  const width = `${(100 / lanes).toFixed(3)}%`

  // Nível livre/ocupado: bloco neutro, sem PII, sem clique/gesto nem cor de status.
  if (a.busyOnly) {
    return (
      <div
        className="absolute bg-slate-100 text-slate-400 px-2 py-1 overflow-hidden pointer-events-none select-none"
        style={{ top, height, left, width, boxShadow: SEPARATORS }}
      >
        <div className="text-[9.5px] font-semibold tabular-nums leading-tight">{minutesToLabel(a.startMin)}–{minutesToLabel(a.startMin + a.durMin)}</div>
        <div className="text-[11px] font-medium leading-tight">Ocupado</div>
      </div>
    )
  }

  // Bloco INTERNO (evento do time ou follow-up): não é venda, então não tem
  // status, telefone nem serviço — e NÃO ocupa a agenda (decisão do dono). O
  // tracejado é o que diz isso sem legenda: dá pra marcar cliente por cima.
  if (a.kind !== "appointment") {
    const followup = a.kind === "followup" || a.kind === "task"
    return (
      <button
        type="button"
        // 🔑 `data-appt-id` é como a GRADE reconhece "clicou num cartão" e não num
        //    slot vazio. Sem isto, o clique atravessava e abria o "Novo agendamento"
        //    por cima da ficha — o dono via dois modais empilhados.
        data-appt-id={a.id}
        // Abre a FICHA, como qualquer bloco do quadro. Pular direto pra conversa
        // tirava a pessoa do calendário sem ela pedir (defeito apontado pelo dono).
        onClick={() => onOpen(a.id)}
        title={`${a.contactName} · ${minutesToLabel(a.startMin)}–${minutesToLabel(a.startMin + a.durMin)}`}
        className={`group absolute overflow-hidden text-left px-2 pt-1 pb-0.5 rounded-md border border-dashed transition-colors cursor-pointer ${
          a.done
            ? "bg-emerald-50/60 border-emerald-300 text-emerald-900 hover:bg-emerald-50"
            : followup
              ? "bg-primary-50/70 border-primary-300 text-primary-900 hover:bg-primary-50"
              : "bg-violet-50/70 border-violet-300 text-violet-900 hover:bg-violet-50"
        }`}
        style={{ top, height, left, width }}
      >
        <div className="text-[9.5px] font-semibold tabular-nums leading-tight opacity-70">
          {a.done ? "✓" : followup ? "⏰" : "◆"} {minutesToLabel(a.startMin)}
        </div>
        {/* Cumprido fica no lugar, riscado — o dono pediu histórico visual, e sumir
            era o defeito: "cliquei em cumpri e sumiu, até da agenda". */}
        <div className={`text-[12px] font-semibold leading-snug truncate ${a.done ? "line-through opacity-80" : ""}`}>{a.contactName}</div>
        {a.serviceName && <div className="text-[10.5px] leading-tight truncate opacity-80">{a.serviceName}</div>}
      </button>
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
      className={`group absolute overflow-hidden text-left px-2 pt-1 pb-0.5 transition-[filter] hover:brightness-95 ${cx ? "opacity-85 cursor-pointer" : "cursor-grab"}`}
      style={{ top, height, left, width, background: st.bg, color: st.fg, boxShadow: SEPARATORS }}
    >
      {showWho && a.resourceName && (
        // "De quem é": FOTO real do dono da agenda (primitiva única; sem foto → degradê+inicial).
        <span
          title={a.resourceName}
          className="absolute top-1 right-1 rounded-full z-10"
          style={{ boxShadow: "0 0 0 1.5px rgba(255,255,255,.9)" }}
        >
          <UserAvatar userId={a.resourceAgentId} name={a.resourceName} size={18} />
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
