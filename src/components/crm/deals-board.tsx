"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Trophy, XCircle, FileText, Clock, User, Bell, Loader2 } from "lucide-react"
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
  type DragStartEvent, type DragEndEvent, type DraggableAttributes,
} from "@dnd-kit/core"
import type { DealPipeline, DealRow } from "@/lib/actions/deals"
import { moveDealById, updateDeal } from "@/lib/actions/deals"
import { createTask } from "@/lib/actions/tasks"
import { MoveDealDialog, type MoveDealResult } from "./move-deal-dialog"

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
type Stage = DealPipeline["stages"][number]

function aging(d: DealRow): number | null {
  if (d.status !== "open" || !d.stage_entered_at) return null
  const days = Math.floor((Date.now() - new Date(d.stage_entered_at).getTime()) / 86_400_000)
  return days >= 3 ? days : null
}

export function DealsBoard({ pipelines, deals: initial }: { pipelines: DealPipeline[]; deals: DealRow[] }) {
  const router = useRouter()
  const [deals, setDeals]   = useState(initial)
  const [pipeId, setPipeId] = useState(() => (pipelines.find((p) => p.is_default) ?? pipelines[0])?.id ?? "")
  const [activeId, setActiveId]     = useState<string | null>(null)
  const [pending, startTransition]  = useTransition()
  const [moveDialog, setMoveDialog] = useState<{ dealId: string; stageId: string; toName: string; fromName: string | null; fromDays: number | null; dealName: string | null; currentValue: number | null } | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  useEffect(() => { setDeals(initial) }, [initial])

  const pipeline = useMemo(() => pipelines.find((p) => p.id === pipeId) ?? pipelines[0], [pipelines, pipeId])
  const columns  = useMemo(() => (pipeline?.stages ?? []).filter((s) => s.show_in_kanban), [pipeline])

  function cardsFor(stageId: string): DealRow[] {
    return deals
      .filter((d) => d.pipeline_id === pipeId && d.stage?.id === stageId)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  }

  function onDragStart(e: DragStartEvent) { setActiveId(String(e.active.id)) }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const dealId  = String(active.id)
    const stageId = String(over.id)
    const d = deals.find((x) => x.id === dealId)
    if (!d || d.stage?.id === stageId) return
    const target = columns.find((s) => s.id === stageId)
    if (!target) return

    // Otimista: pinta o card na coluna nova. O commit + narrativa vai no confirmMove.
    const status = target.is_won ? "won" : target.is_lost ? "lost" : "open"
    setDeals((prev) => prev.map((x) => x.id === dealId
      ? { ...x, stage: { id: target.id, name: target.name, color: target.color, is_won: target.is_won, is_lost: target.is_lost }, status, stage_entered_at: new Date().toISOString() }
      : x))
    setMoveDialog({
      dealId, stageId, toName: target.name,
      fromName: d.stage?.name ?? null,
      fromDays: d.stage_entered_at ? Math.floor((Date.now() - new Date(d.stage_entered_at).getTime()) / 86_400_000) : null,
      dealName: d.name, currentValue: d.estimated_value,
    })
  }

  function confirmMove(res: MoveDealResult) {
    if (!moveDialog) return
    const { dealId, stageId, currentValue } = moveDialog
    setMoveDialog(null)
    startTransition(async () => {
      const valueChanged = res.value != null && res.value !== (currentValue ?? null)
      const extras = {
        valueChange: valueChanged ? { from: currentValue != null && currentValue > 0 ? BRL(currentValue) : "—", to: BRL(res.value as number) } : null,
        followUp: res.task ? { title: res.task.title, due: res.task.dueAt ? new Date(res.task.dueAt).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : null } : null,
      }
      const r = await moveDealById(dealId, stageId, { note: res.note || null, extras })
      if ("error" in r) { alert(r.error); router.refresh(); return }
      if (valueChanged) await updateDeal(dealId, { estimatedValue: res.value }, { silentCard: true })
      if (res.task) await createTask({ dealId, title: res.task.title, dueAt: res.task.dueAt })
      router.refresh()
    })
  }
  function cancelMove() { setMoveDialog(null); router.refresh() }   // reverte o otimista

  const activeCard = activeId ? deals.find((d) => d.id === activeId) ?? null : null

  if (pipelines.length === 0) {
    return <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">Nenhum funil de vendas configurado ainda.</div>
  }

  return (
    <div className="space-y-3">
      {pipelines.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Funil:</span>
          <select value={pipeId} onChange={(e) => setPipeId(e.target.value)}
            className="h-8 px-2.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40">
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}{p.is_default ? " · padrão" : ""}</option>)}
          </select>
        </div>
      )}

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {columns.map((stage) => (
            <DealColumn key={stage.id} stage={stage} list={cardsFor(stage.id)} dragging={!!activeId} />
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeCard ? <DealCard d={activeCard} overlay /> : null}
        </DragOverlay>
      </DndContext>

      {pending && (
        <div className="fixed top-20 right-4 bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-lg flex items-center gap-2 text-xs text-slate-600 z-50">
          <Loader2 className="size-3.5 animate-spin text-primary-600" /> Salvando…
        </div>
      )}

      {moveDialog && (
        <MoveDealDialog
          dealName={moveDialog.dealName} fromStageName={moveDialog.fromName} fromStageDays={moveDialog.fromDays}
          toStageName={moveDialog.toName} currentValue={moveDialog.currentValue}
          pending={pending} onConfirm={confirmMove} onClose={cancelMove}
        />
      )}
    </div>
  )
}

// ── Coluna ───────────────────────────────────────────────────────
function DealColumn({ stage, list, dragging }: { stage: Stage; list: DealRow[]; dragging: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const color     = stage.color ?? "#94a3b8"
  const total     = list.reduce((s, d) => s + Number(d.estimated_value ?? 0), 0)
  const StageIcon = stage.is_won ? Trophy : stage.is_lost ? XCircle : null
  const highlight = isOver && dragging
  return (
    <div
      ref={setNodeRef}
      style={{ borderTop: `3px solid ${color}`, backgroundColor: highlight ? undefined : `color-mix(in srgb, ${color} 7%, transparent)` }}
      className={`shrink-0 w-80 flex flex-col rounded-xl overflow-hidden transition-all duration-150 ${highlight ? "bg-primary-50 ring-2 ring-inset ring-primary-300" : ""}`}
    >
      <div className="px-3.5 py-3 flex items-center gap-2">
        <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="text-sm font-semibold text-slate-800 flex-1 truncate">{stage.name}</span>
        {StageIcon && <StageIcon className={`size-4 ${stage.is_won ? "text-emerald-500" : "text-red-400"}`} />}
        <span className="text-[11px] font-semibold text-slate-500 tabular-nums bg-white/80 ring-1 ring-inset ring-slate-200/80 rounded-full px-2 py-0.5 min-w-[22px] text-center">{list.length}</span>
      </div>
      {total > 0 && (
        <div className="px-3.5 -mt-1.5 pb-1.5 text-[11px] font-semibold text-slate-500 tabular-nums">{BRL(total)}</div>
      )}

      <div className="flex-1 min-h-0 px-2.5 pb-2 space-y-2.5 overflow-y-auto">
        {list.map((d) => <DraggableDeal key={d.id} d={d} />)}
        {highlight && (
          <div className="rounded-xl border-2 border-dashed border-primary-300 bg-primary-50/60 h-16 flex items-center justify-center text-[11px] font-semibold text-primary-600 shrink-0">Soltar aqui</div>
        )}
        {list.length === 0 && !highlight && (
          <div className="flex flex-col items-center justify-center text-center gap-2 px-4 py-10 select-none">
            <div className={`size-11 rounded-full grid place-items-center ${stage.is_won ? "text-emerald-500 bg-emerald-50" : stage.is_lost ? "text-red-400 bg-red-50" : "text-slate-300 bg-slate-100"}`}>
              {(() => { const I = StageIcon ?? FileText; return <I className="size-5" /> })()}
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed max-w-[180px]">
              {stage.is_won ? "Negócios ganhos aparecerão aqui." : stage.is_lost ? "Negócios perdidos aparecerão aqui." : "Nenhum negócio nesta etapa."}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Card ─────────────────────────────────────────────────────────
function DraggableDeal({ d }: { d: DealRow }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: d.id })
  return <DealCard d={d} dragRef={setNodeRef} listeners={listeners} attributes={attributes} isDragging={isDragging} />
}

function DealCard({ d, dragRef, listeners, attributes, isDragging = false, overlay = false }: {
  d: DealRow
  dragRef?: (el: HTMLElement | null) => void
  listeners?: Record<string, unknown>
  attributes?: DraggableAttributes
  isDragging?: boolean
  overlay?: boolean
}) {
  const ag    = aging(d)
  const value = d.estimated_value && d.estimated_value > 0 ? BRL(Number(d.estimated_value)) : null
  const won   = d.status === "won", lost = d.status === "lost"

  const cls = `block group bg-white rounded-xl border transition-all ${
    overlay ? "border-primary-300 shadow-2xl rotate-2 cursor-grabbing"
            : `border-slate-200/80 hover:border-slate-300 hover:shadow-soft cursor-grab ${isDragging ? "opacity-40 scale-[0.97]" : ""}`
  }`

  const body = (
    <div className="p-3.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-semibold text-slate-900 leading-snug line-clamp-2 min-w-0">{d.name?.trim() || "Negócio sem nome"}</p>
        {value && <span className="text-[13px] font-bold text-slate-800 tabular-nums shrink-0">{value}</span>}
      </div>

      {d.contact_name && (
        <p className="text-[11px] text-slate-500 flex items-center gap-1 min-w-0">
          <User className="size-3 shrink-0" /> <span className="truncate">{d.contact_name}</span>
        </p>
      )}

      {d.next_task && (
        <p className="text-[11px] text-slate-500 flex items-center gap-1.5 min-w-0 bg-slate-50 rounded-md px-2 py-1">
          <Bell className="size-3 text-primary-500 shrink-0" /> <span className="truncate">{d.next_task.title}</span>
        </p>
      )}

      <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
        {won && <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">🏆 Ganho</span>}
        {lost && <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">✕ Perdido</span>}
        {ag && (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700" title={`${ag} dias nesta etapa`}>
            <Clock className="size-2.5" /> {ag}d
          </span>
        )}
        {d.responsible && <span className="text-[10px] text-slate-400 ml-auto truncate max-w-[100px]">{d.responsible}</span>}
      </div>
    </div>
  )

  if (overlay) return <div className={cls}>{body}</div>
  return (
    <Link href={`/negocios/${d.id}`} ref={dragRef as React.Ref<HTMLAnchorElement>} {...listeners} {...attributes} className={cls}>
      {body}
    </Link>
  )
}
