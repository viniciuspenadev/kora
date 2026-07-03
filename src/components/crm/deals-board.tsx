"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { SimpleSelect } from "@/components/ui/select"
import { useRouter } from "next/navigation"
import {
  Trophy, XCircle, FileText, Clock, User, Loader2, MessageCircle, Plus, Calendar,
  DollarSign, Tag, ExternalLink, ListPlus, Sparkles,
} from "lucide-react"
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
  type DragStartEvent, type DragEndEvent, type DraggableAttributes,
} from "@dnd-kit/core"
import type { DealPipeline, DealRow } from "@/lib/actions/deals"
import { moveDealById, updateDeal } from "@/lib/actions/deals"
import { createTask } from "@/lib/actions/tasks"
import { applyTag, removeTag } from "@/lib/actions/tags"
import { ContactPic } from "@/components/chat/contact-pic"
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu"
import { MoveDealDialog, type MoveDealResult } from "./move-deal-dialog"
import { AddDealDialog, type AddDealTarget } from "./add-deal-dialog"
import { ContactSheet } from "./contact-sheet"

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
const initials = (n: string) => n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?"
const AVA = ["#004add", "#0d9488", "#7c3aed", "#db2777", "#d97706", "#059669", "#e11d48", "#2563eb"]
const avaColor = (n: string) => AVA[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % AVA.length]
type Stage = DealPipeline["stages"][number]
type TagLite = { id: string; name: string; color: string }

function aging(d: DealRow): number | null {
  if (d.status !== "open" || !d.stage_entered_at) return null
  const days = Math.floor((Date.now() - new Date(d.stage_entered_at).getTime()) / 86_400_000)
  return days >= 3 ? days : null
}

export function DealsBoard({ pipelines, deals: initial, allTags, urlPipelineId }: {
  pipelines: DealPipeline[]; deals: DealRow[]; allTags: TagLite[]
  /** Deep-link do menu: seleciona o funil via /negocios?pipeline=<id>. */
  urlPipelineId?: string | null
}) {
  const router = useRouter()
  const [deals, setDeals]   = useState(initial)
  const [pipeId, setPipeId] = useState(() => {
    if (urlPipelineId && pipelines.some((p) => p.id === urlPipelineId)) return urlPipelineId
    return (pipelines.find((p) => p.is_default) ?? pipelines[0])?.id ?? ""
  })
  const [activeId, setActiveId]     = useState<string | null>(null)
  const [pending, startTransition]  = useTransition()
  const [moveDialog, setMoveDialog] = useState<{ dealId: string; stageId: string; toName: string; fromName: string | null; fromDays: number | null; dealName: string | null; currentValue: number | null } | null>(null)
  const [addTarget, setAddTarget]   = useState<AddDealTarget | null>(null)
  const [sheetContact, setSheetContact] = useState<string | null>(null)   // Contato 360 (clicar no nome)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const draggedRef = useRef(false)

  useEffect(() => { setDeals(initial) }, [initial])

  // Menu → board: troca de funil via querystring (client nav não remonta o componente).
  useEffect(() => {
    if (urlPipelineId && urlPipelineId !== pipeId && pipelines.some((p) => p.id === urlPipelineId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPipeId(urlPipelineId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlPipelineId])

  // Board → menu: seleção interna reflete na URL (destaque do switcher acompanha).
  function selectPipeline(id: string) {
    setPipeId(id)
    window.history.replaceState(null, "", `/negocios?pipeline=${id}`)
  }

  const pipeline = useMemo(() => pipelines.find((p) => p.id === pipeId) ?? pipelines[0], [pipelines, pipeId])
  const columns  = useMemo(() => (pipeline?.stages ?? []).filter((s) => s.show_in_kanban), [pipeline])

  function cardsFor(stageId: string): DealRow[] {
    return deals
      .filter((d) => d.pipeline_id === pipeId && d.stage?.id === stageId)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  }

  // Navegar só quando foi CLIQUE — nunca no clique-fantasma após um drag.
  function openDeal(id: string) { if (draggedRef.current) return; router.push(`/negocios/${id}`) }

  function onDragStart(e: DragStartEvent) { draggedRef.current = true; setActiveId(String(e.active.id)) }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null)
    setTimeout(() => { draggedRef.current = false }, 0)
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

  // Toggle de tag do CONTATO (otimista). taggable = contact (deal tags virão depois).
  function toggleTag(deal: DealRow, tag: TagLite, next: boolean) {
    const cid = deal.contact_id
    if (!cid) return
    // Otimista: aplica em TODOS os cards do mesmo contato (tag é do contato).
    setDeals((prev) => prev.map((x) => x.contact_id === cid
      ? { ...x, tags: next ? [...x.tags.filter((t) => t.id !== tag.id), tag] : x.tags.filter((t) => t.id !== tag.id) }
      : x))
    startTransition(async () => {
      try {
        if (next) await applyTag(tag.id, "contact", cid)
        else await removeTag(tag.id, "contact", cid)
      } catch { router.refresh() }   // reverte via reload
    })
  }

  const activeCard = activeId ? deals.find((d) => d.id === activeId) ?? null : null

  if (pipelines.length === 0) {
    return <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">Nenhum funil de vendas configurado ainda.</div>
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {pipelines.length > 1 && (
        <div className="flex items-center gap-2 px-4 sm:px-6 pt-3 shrink-0">
          <span className="text-xs text-slate-400">Funil:</span>
          <div className="w-48"><SimpleSelect value={pipeId} onChange={selectPipeline} className="h-8 text-xs"
            options={pipelines.map((p) => ({ value: p.id, label: p.name + (p.is_default ? " · padrão" : "") }))} /></div>
        </div>
      )}

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex-1 min-h-0 flex gap-3 overflow-x-auto px-4 sm:px-6 py-3">
          {columns.map((stage) => (
            <DealColumn
              key={stage.id} stage={stage} list={cardsFor(stage.id)} dragging={!!activeId}
              allTags={allTags} onToggleTag={toggleTag} onOpen={openDeal} onOpenContact={setSheetContact}
              onAdd={() => setAddTarget({ pipelineId: pipeId, stageId: stage.id, stageName: stage.name, stageColor: stage.color ?? "#64748b" })}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeCard ? <DealCard d={activeCard} allTags={allTags} onToggleTag={toggleTag} onOpen={openDeal} onOpenContact={setSheetContact} overlay /> : null}
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

      <AddDealDialog target={addTarget} onClose={() => setAddTarget(null)} />
      <ContactSheet contactId={sheetContact} onClose={() => setSheetContact(null)} />
    </div>
  )
}

// ── Coluna ───────────────────────────────────────────────────────
function DealColumn({ stage, list, dragging, allTags, onToggleTag, onOpen, onOpenContact, onAdd }: {
  stage: Stage; list: DealRow[]; dragging: boolean
  allTags: TagLite[]; onToggleTag: (d: DealRow, t: TagLite, next: boolean) => void; onOpen: (id: string) => void
  onOpenContact: (contactId: string) => void; onAdd: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const color     = stage.color ?? "#94a3b8"
  const total     = list.reduce((s, d) => s + Number(d.estimated_value ?? 0), 0)
  const StageIcon = stage.is_won ? Trophy : stage.is_lost ? XCircle : null
  const highlight = isOver && dragging
  const solid     = `color-mix(in srgb, ${color} 7%, #eff4fd)`   // fundo "sólido" pro fade do rodapé

  return (
    <div
      ref={setNodeRef}
      style={{ borderTop: `3px solid ${color}`, backgroundColor: highlight ? undefined : `color-mix(in srgb, ${color} 7%, transparent)` }}
      className={`shrink-0 w-80 flex flex-col rounded-xl overflow-hidden transition-all duration-150 ${highlight ? "bg-primary-50 ring-2 ring-inset ring-primary-300" : ""}`}
    >
      {/* header (fixo) */}
      <div className="shrink-0">
        <div className="px-3.5 pt-3 pb-1 flex items-center gap-2">
          <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <span className="text-sm font-semibold text-slate-800 flex-1 truncate">{stage.name}</span>
          {StageIcon && <StageIcon className={`size-4 ${stage.is_won ? "text-emerald-500" : "text-red-400"}`} />}
        </div>
        <div className="px-3.5 pb-2.5 pl-[26px] flex items-baseline gap-1.5">
          <span className="text-[12.5px] font-bold text-slate-700 tabular-nums">{BRL(total)}</span>
          <span className="text-[11px] font-semibold text-slate-400">· {list.length} {list.length === 1 ? "negócio" : "negócios"}</span>
        </div>
      </div>

      {/* corpo com scroll + rodapé sticky (cards passam por baixo com fade) */}
      <div className="relative flex-1 min-h-0">
        <div className="absolute inset-0 overflow-y-auto px-2.5 pt-0.5 pb-20 space-y-2.5">
          {list.map((d) => <DraggableDeal key={d.id} d={d} allTags={allTags} onToggleTag={onToggleTag} onOpen={onOpen} onOpenContact={onOpenContact} />)}
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

        {/* rodapé: fade por cima dos cards + botão Adicionar */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 px-2.5 pb-2.5 pt-7"
          style={{ backgroundImage: `linear-gradient(to top, ${solid} 58%, transparent)` }}>
          <button type="button" onClick={onAdd} disabled={stage.is_won || stage.is_lost}
            title={stage.is_won || stage.is_lost ? "Negócios chegam aqui pelo funil, não manualmente" : "Adicionar negócio nesta etapa"}
            className="pointer-events-auto w-full h-9 rounded-lg border border-dashed border-slate-300 bg-white/85 backdrop-blur-sm hover:bg-white hover:border-primary/50 hover:text-primary text-slate-500 text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-sm transition-colors disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:text-slate-500 disabled:cursor-not-allowed">
            <Plus className="size-3.5" /> Adicionar negócio
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Card ─────────────────────────────────────────────────────────
function DraggableDeal({ d, allTags, onToggleTag, onOpen, onOpenContact }: { d: DealRow; allTags: TagLite[]; onToggleTag: (d: DealRow, t: TagLite, next: boolean) => void; onOpen: (id: string) => void; onOpenContact: (contactId: string) => void }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: d.id })
  return <DealCard d={d} allTags={allTags} onToggleTag={onToggleTag} onOpen={onOpen} onOpenContact={onOpenContact} dragRef={setNodeRef} listeners={listeners} attributes={attributes} isDragging={isDragging} />
}

function DealCard({ d, allTags, onToggleTag, onOpen, onOpenContact, dragRef, listeners, attributes, isDragging = false, overlay = false }: {
  d: DealRow
  allTags: TagLite[]
  onToggleTag: (d: DealRow, t: TagLite, next: boolean) => void
  onOpen: (id: string) => void
  onOpenContact: (contactId: string) => void
  dragRef?: (el: HTMLElement | null) => void
  listeners?: Record<string, unknown>
  attributes?: DraggableAttributes
  isDragging?: boolean
  overlay?: boolean
}) {
  const router   = useRouter()
  const ag       = aging(d)
  const hasValue = !!(d.estimated_value && d.estimated_value > 0)
  const value    = hasValue ? BRL(Number(d.estimated_value)) : "R$ 0"
  const won      = d.status === "won", lost = d.status === "lost"
  const dateStr  = d.stage_entered_at ? new Date(d.stage_entered_at).toLocaleDateString("pt-BR") : null
  const who      = d.contact_name || d.name?.trim() || "Sem contato"
  const tagIds   = new Set(d.tags.map((t) => t.id))

  const cls = `group relative bg-white rounded-xl border transition-all ${
    overlay ? "border-primary-300 shadow-2xl rotate-2 cursor-grabbing"
            : `border-slate-200/80 hover:border-slate-300 hover:shadow-soft cursor-grab ${isDragging ? "opacity-40 scale-[0.97]" : ""}`
  }`
  const stop = (e: React.MouseEvent | React.PointerEvent) => e.stopPropagation()

  return (
    <div
      ref={dragRef} {...listeners} {...attributes}
      onClick={overlay ? undefined : () => onOpen(d.id)}
      className={cls}
    >
      <div className="p-3 pr-11">
        {/* topo: foto · contato (clica → Contato 360) · interesse */}
        <div className="flex items-start gap-2">
          {overlay || !d.contact_id ? (
            <>
              <span className="size-8 rounded-full overflow-hidden grid place-items-center text-[10px] font-bold text-white shrink-0" style={{ background: avaColor(who) }}>
                <ContactPic pic={d.contact_pic} imgClass="size-full object-cover" fallback={<span>{initials(who)}</span>} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold text-slate-900 leading-tight truncate">{who}</p>
                {d.name?.trim()
                  ? <p className="text-[11px] font-semibold text-primary-600 truncate">{d.name.trim()}</p>
                  : <p className="text-[11px] font-medium text-slate-400 truncate">Sem interesse</p>}
              </div>
            </>
          ) : (
            <button
              type="button" title="Ver contato (360)"
              onPointerDown={stop}
              onClick={(e) => { stop(e); onOpenContact(d.contact_id as string) }}
              className="group/who flex items-start gap-2 min-w-0 flex-1 text-left"
            >
              <span className="size-8 rounded-full overflow-hidden grid place-items-center text-[10px] font-bold text-white shrink-0 ring-2 ring-transparent group-hover/who:ring-primary-200 transition-shadow" style={{ background: avaColor(who) }}>
                <ContactPic pic={d.contact_pic} imgClass="size-full object-cover" fallback={<span>{initials(who)}</span>} />
              </span>
              <span className="min-w-0 flex-1 block">
                <span className="block text-[13px] font-bold text-slate-900 leading-tight truncate group-hover/who:text-primary-700 group-hover/who:underline decoration-primary-200 underline-offset-2 transition-colors">{who}</span>
                {d.name?.trim()
                  ? <span className="block text-[11px] font-semibold text-primary-600 truncate">{d.name.trim()}</span>
                  : <span className="block text-[11px] font-medium text-slate-400 truncate">Sem interesse</span>}
              </span>
            </button>
          )}
          <span className="text-[10px] font-bold text-slate-400 tabular-nums shrink-0">#{d.id.slice(0, 4).toUpperCase()}</span>
        </div>

        {/* linhas: responsável · valor · data · atividade */}
        <div className="mt-2.5 space-y-1.5">
          {d.responsible ? (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-600 min-w-0">
              <span className="size-4 rounded-full grid place-items-center text-[7px] font-bold text-white shrink-0" style={{ background: avaColor(d.responsible) }}>{initials(d.responsible)}</span>
              <span className="truncate">{d.responsible}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400"><User className="size-3.5 shrink-0" /> Sem responsável</div>
          )}
          <div className="flex items-center gap-1.5 text-[11px]">
            <DollarSign className="size-3.5 text-slate-400 shrink-0" />
            <span className={hasValue ? "font-bold text-primary-600 tabular-nums" : "text-slate-400 tabular-nums"}>{value}</span>
          </div>
          {dateStr && <div className="flex items-center gap-1.5 text-[11px] text-slate-500"><Calendar className="size-3.5 text-slate-400 shrink-0" /> {dateStr}</div>}
          <div className={`flex items-center gap-1.5 text-[11px] min-w-0 ${d.next_task ? "text-slate-600" : "text-slate-400"}`}>
            <Clock className="size-3.5 text-slate-400 shrink-0" /> <span className="truncate">{d.next_task?.title ?? "Sem atividades"}</span>
          </div>
        </div>

        {/* tags do contato + status/aging */}
        {(d.tags.length > 0 || won || lost || ag) && (
          <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
            {d.tags.slice(0, 3).map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${t.color} 16%, transparent)`, color: t.color }}>
                <span className="size-1.5 rounded-full" style={{ backgroundColor: t.color }} />{t.name}
              </span>
            ))}
            {d.tags.length > 3 && <span className="text-[10px] font-semibold text-slate-400">+{d.tags.length - 3}</span>}
            {won && <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">🏆 Ganho</span>}
            {lost && <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">✕ Perdido</span>}
            {ag && <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700" title={`${ag} dias nesta etapa`}><Clock className="size-2.5" /> {ag}d</span>}
          </div>
        )}
      </div>

      {/* ações (coluna à direita) */}
      {!overlay && (
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex flex-col gap-2">
          {/* WhatsApp — abre a conversa REAL; bolinha vermelha pulsando = cliente chamou */}
          {d.conversation_id && (
            <button type="button" title={d.conversation_unread ? "Cliente chamou no WhatsApp" : "Abrir conversa"}
              onPointerDown={stop}
              onClick={(e) => { stop(e); router.push(`/inbox?conversation=${d.conversation_id}`) }}
              className="relative size-7 rounded-full grid place-items-center bg-white border-[1.5px] border-emerald-200 text-emerald-500 hover:bg-emerald-50 transition-colors">
              <MessageCircle className="size-3.5" />
              {d.conversation_unread && (
                <span className="absolute -top-0.5 -right-0.5 flex size-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-red-500 ring-2 ring-white" />
                </span>
              )}
            </button>
          )}

          {/* Tags — menu pra adicionar/remover */}
          <DropdownMenu>
            <DropdownMenuTrigger
              onPointerDown={stop} onClick={stop} title="Tags"
              className="relative size-7 rounded-full grid place-items-center bg-white border-[1.5px] border-slate-200 text-slate-400 hover:border-primary hover:text-primary transition-colors data-[popup-open]:border-primary data-[popup-open]:text-primary">
              <Tag className="size-3.5" />
              {d.tags.length > 0 && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary ring-2 ring-white" />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="left" className="w-56">
              <div className="px-1.5 py-1 text-xs font-medium text-slate-400">Tags do contato</div>
              {allTags.length === 0 && <p className="px-2 py-1.5 text-[11px] text-slate-400">Nenhuma tag criada ainda.</p>}
              {allTags.map((t) => (
                <DropdownMenuCheckboxItem key={t.id} checked={tagIds.has(t.id)} closeOnClick={false}
                  onCheckedChange={(v) => onToggleTag(d, t, v)}>
                  <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                  <span className="truncate">{t.name}</span>
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <div className="flex items-center gap-1.5 px-2 py-1 text-[10.5px] text-slate-400">
                <Sparkles className="size-3 text-violet-400" /> Tags de negócio chegam em breve
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* + — menu de ações */}
          <DropdownMenu>
            <DropdownMenuTrigger
              onPointerDown={stop} onClick={stop} title="Ações"
              className="size-7 rounded-full grid place-items-center bg-white border-[1.5px] border-slate-200 text-slate-400 hover:border-primary hover:text-primary transition-colors data-[popup-open]:border-primary data-[popup-open]:text-primary">
              <Plus className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="left" className="w-48">
              <DropdownMenuItem onClick={() => onOpen(d.id)}><ExternalLink className="size-3.5 text-slate-400" /> Abrir negócio</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onOpen(d.id)}><ListPlus className="size-3.5 text-slate-400" /> Nova atividade</DropdownMenuItem>
              {d.conversation_id && (
                <DropdownMenuItem onClick={() => router.push(`/inbox?conversation=${d.conversation_id}`)}>
                  <MessageCircle className="size-3.5 text-emerald-500" /> Ver conversa
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  )
}
