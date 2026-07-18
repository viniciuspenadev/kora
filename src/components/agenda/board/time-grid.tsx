"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { AptCard } from "./apt-card"
import { layoutLanes, minutesInTz, minutesToLabel, snap15, SNAP_MIN, GRID_HOUR, GRID_HALF, GRID_VERT } from "./lanes"
import { useGridGestures, type GestureApi, type ColMeta } from "./use-grid-gestures"
import type { BoardAppt, BlackoutBlock } from "./types"

// ═══════════════════════════════════════════════════════════════
// Grade de tempo — casca compartilhada por Dia e Semana
// ═══════════════════════════════════════════════════════════════
// Colunas genéricas (o header muda: Dia=recurso, Semana=dia). Cada coluna posiciona
// cards por faixa (lanes) e bloqueios listrados (atrás dos cards, não-interativos).
// Linha do "agora" por coluna quando a coluna é hoje. Scroll horizontal em telas
// estreitas; toque no card abre o modal. Drag/resize via useGridGestures (quando
// `gestures` presente); read-only quando ausente.

export interface GridColumn {
  key: string
  header: React.ReactNode
  isToday: boolean
  accent?: boolean            // Dia: coluna da agenda do PRÓPRIO usuário logado
  appts: BoardAppt[]
  showWho: boolean            // semana-equipe → foto do dono da agenda no card
  dateKey: string             // dia que a coluna representa (pro gesto compor o ISO)
  resourceId?: string         // recurso da coluna (Dia) — soltar aqui troca de agenda
  blackouts: BlackoutBlock[]
}

const usePrefersReducedMotion = () =>
  useState(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true)[0]

export function TimeGrid({
  columns, startHour, endHour, hourPx, now, onOpen, gestures, onSlotClick, colMinWidth = 160,
}: {
  columns: GridColumn[]
  startHour: number
  endHour: number
  hourPx: number              // densidade dinâmica (48 · 72 · 96 px/h)
  now: Date
  onOpen: (id: string) => void
  gestures?: GestureApi | null
  /** Clique em área VAZIA da coluna → cria (Dia/Semana). Bloqueio recusa com toast. */
  onSlotClick?: (resourceId: string | undefined, dateKey: string, startMin: number) => void
  colMinWidth?: number
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const gridStartMin = startHour * 60
  const gridEndMin = endHour * 60
  const pxPerMin = hourPx / 60
  const totalH = (endHour - startHour) * hourPx
  // Sem o rótulo da borda final (24h → "00:00" duplicado no rodapé).
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)
  const reducedMotion = usePrefersReducedMotion()

  const nowMin = minutesInTz(now)
  const nowTop = (nowMin - gridStartMin) * pxPerMin
  const nowVisible = nowMin >= gridStartMin && nowMin <= gridEndMin

  // Auto-scroll pra ~1h antes do "agora" ao montar.
  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = Math.max(0, (minutesInTz(new Date()) - gridStartMin) * pxPerMin - hourPx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Índices pro controller de gestos: card por id + meta por coluna (ocupação = cards
  // ativos + bloqueios, pro pré-check visual de conflito).
  const apptMap = useMemo(() => {
    const m = new Map<string, BoardAppt>()
    for (const c of columns) for (const a of c.appts) m.set(a.id, a)
    return m
  }, [columns])
  const metaMap = useMemo(() => {
    const m = new Map<string, ColMeta>()
    for (const c of columns) {
      const occupied = [
        ...c.appts.filter((a) => a.status !== "canceled").map((a) => ({ id: a.id, startMin: a.startMin, durMin: a.durMin })),
        ...c.blackouts.filter((b) => b.blocking).map((b) => ({ id: b.id, startMin: b.startMin, durMin: b.durMin })),
      ]
      m.set(c.key, { dateKey: c.dateKey, resourceId: c.resourceId, occupied })
    }
    return m
  }, [columns])

  const { onPointerDown } = useGridGestures({
    containerRef: scrollRef,
    gridStartMin, gridEndMin, pxPerMin, reducedMotion,
    getAppt: (id) => apptMap.get(id),
    getMeta: (k) => metaMap.get(k),
    api: gestures ?? null,
    onOpen,
  })

  const gridBg = {
    backgroundImage:
      `repeating-linear-gradient(to bottom, ${GRID_HALF} 0 1px, transparent 1px ${hourPx / 2}px),` +
      `repeating-linear-gradient(to bottom, ${GRID_HOUR} 0 1px, transparent 1px ${hourPx}px)`,
  }

  // Clique em área vazia da coluna → novo agendamento (o supressor pós-arrasto do
  // controller de gestos já barra o click sintético que segue um drag).
  function handleColClick(e: React.MouseEvent<HTMLDivElement>, c: GridColumn) {
    if (!onSlotClick) return
    if ((e.target as HTMLElement).closest("[data-appt-id]")) return   // clicou num card
    const rect = e.currentTarget.getBoundingClientRect()
    const raw = (e.clientY - rect.top) / pxPerMin + gridStartMin
    const startMin = Math.max(gridStartMin, Math.min(gridEndMin - SNAP_MIN, snap15(raw)))
    // Só bloqueio APLICÁVEL ao alvo trava o clique (colega na Semana-equipe = informativo).
    const blocked = c.blackouts.find((b) => b.blocking && startMin >= b.startMin && startMin < b.startMin + b.durMin)
    if (blocked) { toast.error("Esse horário está bloqueado (folga/feriado)"); return }
    onSlotClick(c.resourceId, c.dateKey, startMin)
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Cabeçalho — FORA do rolador vertical (a barra de rolagem nasce ABAIXO dele,
          nunca por cima dos títulos). O scroll horizontal do corpo é espelhado aqui
          via scrollLeft; o gutter reservado ([scrollbar-gutter:stable]) nos dois
          mantém as colunas alinhadas com ou sem barra. */}
      <div ref={headerRef} className="overflow-hidden [scrollbar-gutter:stable] bg-canvas border-b border-slate-200">
        <div className="flex min-w-fit">
          <div className="w-14 shrink-0 sticky left-0 z-[2] bg-canvas" />
          {columns.map((c) => (
            <div key={c.key} className={`flex-1 border-l px-3 py-2 ${c.accent ? "bg-primary-50/70 shadow-[inset_0_2px_0_0_var(--color-primary)]" : ""}`} style={{ minWidth: colMinWidth, borderLeftColor: GRID_VERT }}>
              {c.header}
            </div>
          ))}
        </div>
      </div>

      {/* Corpo — único rolador (V+H); H é espelhado pro cabeçalho acima. */}
      <div
        ref={scrollRef}
        onPointerDown={onPointerDown}
        onScroll={(e) => { if (headerRef.current) headerRef.current.scrollLeft = e.currentTarget.scrollLeft }}
        className="overflow-auto [scrollbar-gutter:stable]"
        style={{ maxHeight: "calc(100dvh - 15.5rem)" }}
      >
      <div className="flex min-w-fit">
        {/* Gutter de horas */}
        <div className="w-14 shrink-0 sticky left-0 z-10 bg-canvas relative" style={{ height: totalH }}>
          {hours.map((h) => (
            <span key={h} className="absolute right-2 -translate-y-1/2 text-[10px] text-slate-400 tabular-nums" style={{ top: (h - startHour) * hourPx }}>
              {minutesToLabel(h * 60)}
            </span>
          ))}
        </div>

        {/* Colunas */}
        {columns.map((c) => {
          const pos = layoutLanes(c.appts.map((a) => ({ id: a.id, startMin: a.startMin, durMin: a.durMin })))
          return (
            <div
              key={c.key}
              data-col-key={c.key}
              data-resid={c.resourceId ?? ""}
              onClick={(e) => handleColClick(e, c)}
              className={`flex-1 border-l relative ${onSlotClick ? "cursor-copy" : ""}`}
              style={{ minWidth: colMinWidth, height: totalH, borderLeftColor: GRID_VERT, ...gridBg }}
            >
              {c.isToday && <div className="absolute inset-0 bg-primary-50/40 pointer-events-none" />}
              {c.accent && <div className="absolute inset-0 bg-primary-50/40 pointer-events-none" />}

              {/* Bloqueios (folga/feriado/manutenção) — full-width, sem radius (consistência), atrás dos cards */}
              {c.blackouts.map((b) => {
                const vTop = (Math.max(b.startMin, gridStartMin) - gridStartMin) * pxPerMin
                const vBottom = (Math.min(b.startMin + b.durMin, gridEndMin) - gridStartMin) * pxPerMin
                if (vBottom <= vTop) return null
                return (
                  <div
                    key={b.id}
                    className="absolute left-0 right-0 border-y border-dashed border-slate-300 text-slate-400 text-[10.5px] font-semibold px-2 py-1.5 overflow-hidden pointer-events-none z-[1]"
                    style={{ top: vTop, height: vBottom - vTop, backgroundImage: "repeating-linear-gradient(45deg, #e2e8f0 0 8px, transparent 8px 16px)" }}
                  >
                    {b.label}
                  </div>
                )
              })}

              {c.appts.map((a) => (
                <AptCard key={a.id} a={a} pos={pos.get(a.id)} gridStartMin={gridStartMin} pxPerMin={pxPerMin} showWho={c.showWho} onOpen={onOpen} />
              ))}

              {c.isToday && nowVisible && (
                <div className="absolute inset-x-0 z-30 pointer-events-none" style={{ top: nowTop }}>
                  <div className="h-0 border-t-2 border-red-500" />
                  <span className="absolute -left-1 -top-[5px] size-2 rounded-full bg-red-500" />
                </div>
              )}
            </div>
          )
        })}
      </div>
      </div>
    </div>
  )
}
