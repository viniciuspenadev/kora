"use client"

import { useCallback, useRef, type RefObject, type PointerEvent as ReactPointerEvent } from "react"
import { toast } from "sonner"
import {
  PX_PER_MIN, SNAP_MIN, snap15, minutesToLabel, isoFromDayMinute, rangesOverlap,
} from "./lanes"
import type { BoardAppt } from "./types"

// ═══════════════════════════════════════════════════════════════
// Gestos da grade — drag (remarcar) + resize (duração)
// ═══════════════════════════════════════════════════════════════
// Feel portado do protótipo aprovado: pointer capture, threshold 5px pra separar
// clique de arrasto, snap 15min, card com "lift", fantasma tracejado azul (alvo)
// / vermelho (colisão visual — só HINT; a autoridade é o servidor). Manipulação
// imperativa do DOM durante o gesto (zero re-render) → 60fps. Ao soltar chama a
// action e RECARREGA (o servidor é a verdade; sem estado otimista permanente).
//
// Desabilitado em: touch (pointer coarse → clique nativo abre o modal), cancelado,
// busy_only e quando não há `api` (read-only). prefers-reduced-motion desliga
// lift/snapback (o movimento do arrasto em si continua).

const GHOST_VALID = { border: "var(--color-primary)", bg: "var(--color-primary-50)" }
const GHOST_BAD = { border: "#ef4444", bg: "rgba(239,68,68,.12)" }  // #ef4444 = no_show (status aprovado)

export interface ColMeta {
  dateKey: string
  resourceId?: string
  occupied: { id: string; startMin: number; durMin: number }[]   // cards ativos + bloqueios
}
export interface GestureApi {
  reschedule: (id: string, startISO: string, resourceId?: string) => Promise<{ error?: string }>
  resize: (id: string, durMin: number) => Promise<{ error?: string }>
  reload: () => void
  resourceName: (id: string) => string
}
export interface GestureOpts {
  containerRef: RefObject<HTMLDivElement | null>
  gridStartMin: number
  gridEndMin: number
  reducedMotion: boolean
  getAppt: (id: string) => BoardAppt | undefined
  getMeta: (colKey: string) => ColMeta | undefined
  api: GestureApi | null
  onOpen: (id: string) => void
}

interface DragState {
  id: string; appt: BoardAppt; cardEl: HTMLElement; colEl: HTMLElement
  mode: "move" | "resize"
  startX: number; startY: number; moved: boolean
  grabOffset: number
  ghost: HTMLElement | null
  target: { colEl?: HTMLElement; dateKey?: string; startMin?: number; resourceId?: string; durMin?: number } | null
  conflict: boolean
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const hasConflict = (occ: ColMeta["occupied"], startMin: number, durMin: number, selfId: string) =>
  occ.some((o) => o.id !== selfId && rangesOverlap(startMin, durMin, o.startMin, o.durMin))

function clearLift(el: HTMLElement) {
  el.style.boxShadow = ""; el.style.opacity = ""; el.style.zIndex = ""; el.style.cursor = ""
}
/** Suprime o click sintético que segue o arrasto (senão o modal abriria). */
function suppressNextClick() {
  const handler = (e: MouseEvent) => { e.stopPropagation(); e.preventDefault(); window.removeEventListener("click", handler, true) }
  window.addEventListener("click", handler, true)
  setTimeout(() => window.removeEventListener("click", handler, true), 350)
}

export function useGridGestures(opts: GestureOpts) {
  const ref = useRef(opts); ref.current = opts

  const nearestCol = (cols: HTMLElement[], x: number): HTMLElement | undefined =>
    cols.reduce<{ el: HTMLElement; d: number } | null>((best, c) => {
      const r = c.getBoundingClientRect()
      const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0
      return !best || d < best.d ? { el: c, d } : best
    }, null)?.el

  function placeGhost(d: DragState, col: HTMLElement, top: number, height: number, conflict: boolean) {
    if (!d.ghost) {
      const g = document.createElement("div")
      g.style.cssText = "position:absolute;left:5px;right:5px;border-radius:9px;border:2px dashed;z-index:25;pointer-events:none;"
      d.ghost = g
    }
    const c = conflict ? GHOST_BAD : GHOST_VALID
    if (d.ghost.parentElement !== col) col.appendChild(d.ghost)
    d.ghost.style.top = `${top}px`
    d.ghost.style.height = `${Math.max(height, 20)}px`
    d.ghost.style.borderColor = c.border
    d.ghost.style.background = c.bg
  }
  const removeGhost = (d: DragState) => { d.ghost?.remove(); d.ghost = null }

  function handleMove(ev: PointerEvent, d: DragState) {
    const o = ref.current
    const dx = ev.clientX - d.startX, dy = ev.clientY - d.startY
    if (!d.moved && Math.hypot(dx, dy) < 5) return
    d.moved = true

    if (d.mode === "move") {
      if (!o.reducedMotion) { d.cardEl.style.boxShadow = "0 12px 28px rgba(15,23,42,.18)"; d.cardEl.style.opacity = ".92" }
      d.cardEl.style.zIndex = "30"; d.cardEl.style.cursor = "grabbing"; d.cardEl.style.transition = "none"
      d.cardEl.style.transform = `translate(${dx}px, ${dy}px)`

      const cols = Array.from(o.containerRef.current?.querySelectorAll<HTMLElement>("[data-col-key]") ?? [])
      const col = cols.find((c) => { const r = c.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right }) ?? nearestCol(cols, ev.clientX)
      if (!col) return
      const meta = o.getMeta(col.dataset.colKey ?? "")
      if (!meta) return
      const r = col.getBoundingClientRect()
      const rawMin = (ev.clientY - r.top - d.grabOffset) / PX_PER_MIN + o.gridStartMin
      const span = Math.min(d.appt.durMin, o.gridEndMin - o.gridStartMin)
      const startMin = clamp(snap15(rawMin), o.gridStartMin, o.gridEndMin - span)
      const resourceId = col.dataset.resid || undefined      // coluna define recurso (Dia) → troca; Semana não tem → mantém
      d.target = { colEl: col, dateKey: meta.dateKey, startMin, resourceId }
      d.conflict = hasConflict(meta.occupied, startMin, d.appt.durMin, d.id)
      placeGhost(d, col, (startMin - o.gridStartMin) * PX_PER_MIN, d.appt.durMin * PX_PER_MIN - 2, d.conflict)
    } else {
      const meta = o.getMeta(d.colEl.dataset.colKey ?? "")
      const newDur = clamp(snap15(d.appt.durMin + dy / PX_PER_MIN), SNAP_MIN, 720)
      d.target = { durMin: newDur }
      d.conflict = meta ? hasConflict(meta.occupied, d.appt.startMin, newDur, d.id) : false
      d.cardEl.style.height = `${Math.max(newDur * PX_PER_MIN - 2, 26)}px`
      d.cardEl.style.outline = d.conflict ? "2px dashed #ef4444" : ""
      d.cardEl.style.outlineOffset = "-1px"
      const t = d.cardEl.querySelector<HTMLElement>("[data-role=time]")
      if (t) t.textContent = `${minutesToLabel(d.appt.startMin)}–${minutesToLabel(d.appt.startMin + newDur)}`
    }
  }

  function snapback(d: DragState) {
    const o = ref.current
    clearLift(d.cardEl)
    if (o.reducedMotion) { d.cardEl.style.transform = ""; o.api?.reload() ; return }
    d.cardEl.style.transition = "transform .2s ease"
    d.cardEl.style.transform = ""
    setTimeout(() => o.api?.reload(), 210)
  }
  function landCard(d: DragState) {
    const o = ref.current
    if (!d.target?.colEl) return
    const hDelta = d.target.colEl.getBoundingClientRect().left - d.colEl.getBoundingClientRect().left
    const vDelta = ((d.target.startMin ?? d.appt.startMin) - d.appt.startMin) * PX_PER_MIN
    clearLift(d.cardEl)
    d.cardEl.style.transition = o.reducedMotion ? "none" : "transform .18s ease"
    d.cardEl.style.transform = `translate(${hDelta}px, ${vDelta}px)`
  }
  function resetResize(d: DragState, animate = false) {
    const o = ref.current
    d.cardEl.style.transition = animate && !o.reducedMotion ? "height .18s ease" : "none"
    d.cardEl.style.height = `${Math.max(d.appt.durMin * PX_PER_MIN - 2, 26)}px`
    d.cardEl.style.outline = ""
    const t = d.cardEl.querySelector<HTMLElement>("[data-role=time]")
    if (t) t.textContent = `${minutesToLabel(d.appt.startMin)}–${minutesToLabel(d.appt.startMin + d.appt.durMin)}`
  }

  async function handleUp(ev: PointerEvent, d: DragState, cleanup: () => void) {
    const o = ref.current
    cleanup()
    try { d.cardEl.releasePointerCapture(ev.pointerId) } catch { /* já solto */ }
    removeGhost(d)

    if (!d.moved) { o.onOpen(d.id); return }
    suppressNextClick()
    if (!o.api) { snapback(d); return }

    if (d.mode === "move") {
      const t = d.target
      const changed = !!t && (t.startMin !== d.appt.startMin || t.dateKey !== d.appt.dateKey || (!!t.resourceId && t.resourceId !== d.appt.resourceId))
      if (!t || !changed) { snapback(d); return }
      const newResource = t.resourceId && t.resourceId !== d.appt.resourceId ? t.resourceId : undefined
      const wasConfirmed = d.appt.status === "confirmed"
      landCard(d)   // pousa no alvo (feel); servidor confirma logo abaixo
      const r = await o.api.reschedule(d.id, isoFromDayMinute(t.dateKey!, t.startMin!), newResource)
      if (r?.error) { toast.error(r.error); snapback(d); o.api.reload(); return }
      const bits = [`pra ${minutesToLabel(t.startMin!)}`]
      if (newResource) bits.push(`agenda ${o.api.resourceName(newResource)}`)
      toast.success(`✓ Remarcado ${bits.join(" · ")}${wasConfirmed ? " · re-confirmação enviada ao cliente" : ""}`)
      o.api.reload()
    } else {
      const t = d.target
      if (!t || t.durMin === d.appt.durMin) { resetResize(d); return }
      const r = await o.api.resize(d.id, t.durMin!)
      if (r?.error) { toast.error(r.error); resetResize(d, true); o.api.reload(); return }
      toast.success(`✓ Duração ajustada pra ${t.durMin} min`)
      o.api.reload()
    }
  }

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    const o = ref.current
    if (e.pointerType === "mouse" && e.button !== 0) return
    const target = e.target as HTMLElement
    const cardEl = target.closest<HTMLElement>("[data-appt-id]")
    if (!cardEl) return
    const id = cardEl.dataset.apptId
    if (!id) return
    const appt = o.getAppt(id)
    if (!appt || appt.busyOnly) return

    // touch / cancelado / read-only → não arrasta; o click nativo (AptCard) abre o modal.
    if (!o.api || e.pointerType === "touch" || appt.status === "canceled") return

    const colEl = cardEl.closest<HTMLElement>("[data-col-key]")
    if (!colEl) return
    e.preventDefault()
    try { cardEl.setPointerCapture(e.pointerId) } catch { /* noop */ }

    const drag: DragState = {
      id, appt, cardEl, colEl,
      mode: target.closest("[data-resize]") ? "resize" : "move",
      startX: e.clientX, startY: e.clientY, moved: false,
      grabOffset: e.clientY - cardEl.getBoundingClientRect().top,
      ghost: null, target: null, conflict: false,
    }
    const onMove = (ev: PointerEvent) => handleMove(ev, drag)
    const cleanup = () => {
      cardEl.removeEventListener("pointermove", onMove)
      cardEl.removeEventListener("pointerup", onUp)
      cardEl.removeEventListener("pointercancel", onUp)
    }
    const onUp = (ev: PointerEvent) => handleUp(ev, drag, cleanup)
    cardEl.addEventListener("pointermove", onMove)
    cardEl.addEventListener("pointerup", onUp)
    cardEl.addEventListener("pointercancel", onUp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { onPointerDown }
}
