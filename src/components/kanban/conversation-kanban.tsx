"use client"

import { useState, useEffect, useMemo, useCallback, useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  GripVertical, Clock, AlertCircle, Trophy, XCircle,
  Phone, DollarSign, Calendar, Loader2, Briefcase, Plus,
  ArrowUpRight, ArrowDownLeft, Smartphone, BadgeCheck,
} from "lucide-react"
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
  type DragStartEvent, type DragEndEvent, type DraggableAttributes,
} from "@dnd-kit/core"
import { moveConversation, getManagementCards } from "@/lib/actions/pipeline"
import { moveDeal, type DealPipeline } from "@/lib/actions/deals"
import { getRealtimeClient } from "@/lib/realtime"
import { lifecycleMeta } from "@/lib/lifecycle"
import { displayContactName, displayContactInitial } from "@/lib/contact"
import { SourceLogo } from "@/components/chat/source-logo"
import { NewDealDialog } from "@/components/chat/new-deal-dialog"

interface Stage {
  id:              string
  name:            string
  color:           string
  position:        number
  probability_pct: number
  is_won:          boolean
  is_lost:         boolean
  show_in_kanban:  boolean
}

interface ChatContact {
  id:              string
  push_name:       string | null
  custom_name:     string | null
  phone_number:    string
  profile_pic_url: string | null
  source:          string | null
  lifecycle_stage: string | null
}

/** Negócio ativo embedado na conversa (left-join). Quando presente, manda no card. */
interface DealMini {
  id:               string
  name:             string | null
  status:           string
  stage_id:         string | null
  pipeline_id:      string | null
  estimated_value:  number | null
  stage_entered_at: string | null
  won_at:           string | null
  lost_at:          string | null
}

interface Conversation {
  id:                   string
  status:               string
  priority:             string
  subject:              string | null
  channel:              string | null
  last_message_at:      string | null
  last_message_preview: string | null
  last_message_dir:     "in" | "out" | "out_phone"
  unread_count:         number
  pipeline_id:          string | null
  stage_id:             string | null
  card_position:        number
  stage_entered_at:     string | null
  estimated_value:      number | null
  expected_close_date:  string | null
  lost_reason:          string | null
  won_at:               string | null
  lost_at:              string | null
  assigned_to:          string | null
  department_id:        string | null
  instance_id:          string | null
  active_deal_id:       string | null
  deal:                 DealMini | null
  chat_contacts:        ChatContact | null
  profiles:             { full_name: string | null; email: string } | null
  whatsapp_instances:   { provider: string | null; display_name: string | null } | null
}

interface AgentMini { id: string; full_name: string | null; department_id?: string | null }
interface DeptMini  { id: string; name: string; color: string }
export type GroupBy = "stage" | "agent" | "department"
interface Column { key: string; title: string; color?: string; stage?: Stage }

interface Props {
  stages:        Stage[]
  conversations: Conversation[]
  /** Pinta o fundo das colunas com a cor da etapa (preferência do tenant). */
  tintColumns:   boolean
  /** Mostra badge de canal (Baileys/Oficial) no card — só com 2+ instâncias. */
  showChannel?:  boolean
  /** Lente de agrupamento — controlada pelo header (KanbanView). */
  groupBy:       GroupBy
  /** Busca/filtro/ordenação — controlados pela toolbar (KanbanView). */
  filters?:      KanbanFilters
  sort?:         SortKey
  agents?:       AgentMini[]
  departments?:  DeptMini[]
  tenantId:      string
  supabaseToken: string
  /** CRM ligado → cards deal-aware + afford. "Abrir negócio". */
  crmEnabled?:   boolean
  dealPipelines?: DealPipeline[]
}

// Atualiza os campos escalares de um card a partir da row crua do Realtime
// (que NÃO traz os embeds chat_contacts/profiles/whatsapp_instances → preserva).
function mergeCardScalars(existing: Conversation, row: Conversation): Conversation {
  return {
    ...existing,
    stage_id:             row.stage_id,
    assigned_to:          row.assigned_to,
    department_id:        row.department_id,
    status:               row.status,
    last_message_at:      row.last_message_at,
    last_message_preview: row.last_message_preview,
    last_message_dir:     row.last_message_dir,
    unread_count:         row.unread_count,
    card_position:        row.card_position,
    stage_entered_at:     row.stage_entered_at,
    won_at:               row.won_at,
    lost_at:              row.lost_at,
    estimated_value:      row.estimated_value,
    expected_close_date:  row.expected_close_date,
    lost_reason:          row.lost_reason,
  }
}

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

// Valor "efetivo" do card: do negócio quando há um; senão da conversa (legado/fallback).
export function effectiveValue(c: { deal?: DealMini | null; estimated_value: number | null }): number {
  return Number((c.deal ? c.deal.estimated_value : c.estimated_value) ?? 0)
}

function formatPhone(phone: string) {
  const clean = phone.replace(/\D/g, "")
  if (clean.length === 13) return `+${clean.slice(0, 2)} (${clean.slice(2, 4)}) ${clean.slice(4, 9)}-${clean.slice(9)}`
  if (clean.length === 11) return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`
  return phone
}

function relativeTime(date: string): { label: string; hot: boolean } {
  const diff = (Date.now() - new Date(date).getTime()) / (60 * 1000)
  if (diff < 1)    return { label: "agora",   hot: false }
  if (diff < 60)   return { label: `${Math.floor(diff)}m`, hot: false }
  if (diff < 60 * 24) {
    const h = Math.floor(diff / 60)
    return { label: `${h}h`, hot: h >= 4 }
  }
  const days = Math.floor(diff / (60 * 24))
  return { label: `${days}d`, hot: true }
}

// Aging "dias na etapa" (Tier 0). Base = stage_entered_at; fallback p/ última
// atividade (cards legados sem a coluna preenchida). Só sinaliza quando estagnado.
const AGING_AMBER_DAYS = 3
const AGING_RED_DAYS   = 7
function stageAging(conv: Conversation): { days: number; tone: "amber" | "red"; inStage: boolean } | null {
  if (conv.won_at || conv.lost_at) return null
  const base = conv.stage_entered_at ?? conv.last_message_at
  if (!base) return null
  const days = Math.floor((Date.now() - new Date(base).getTime()) / 86_400_000)
  if (days < AGING_AMBER_DAYS) return null
  return { days, tone: days >= AGING_RED_DAYS ? "red" : "amber", inStage: conv.stage_entered_at != null }
}

// ── Filtro + ordenação do board (Tier 0) ────────────────────────
export interface KanbanFilters { search: string; agentId: string | null; instanceId: string | null }
export type SortKey = "recent" | "value" | "stale"

export function cardMatchesFilters(c: Conversation, f: KanbanFilters): boolean {
  if (f.agentId && c.assigned_to !== f.agentId) return false
  if (f.instanceId && c.instance_id !== f.instanceId) return false
  const q = f.search.trim().toLowerCase()
  if (q) {
    const name  = c.chat_contacts ? displayContactName(c.chat_contacts).toLowerCase() : ""
    const phone = c.chat_contacts?.phone_number ?? ""
    const prev  = (c.last_message_preview ?? "").toLowerCase()
    if (!name.includes(q) && !phone.includes(q) && !prev.includes(q)) return false
  }
  return true
}

function sortCards(list: Conversation[], sort: SortKey): Conversation[] {
  const arr = [...list]
  if (sort === "value") return arr.sort((a, b) => effectiveValue(b) - effectiveValue(a))
  if (sort === "stale") {
    const t = (c: Conversation) => new Date(c.stage_entered_at ?? c.last_message_at ?? 0).getTime()
    return arr.sort((a, b) => t(a) - t(b))   // mais antigo primeiro = parado há mais tempo
  }
  return arr.sort((a, b) => {                 // recent (default)
    const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
    const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
    if (at !== bt) return bt - at
    return (a.card_position ?? 0) - (b.card_position ?? 0)
  })
}

export function ConversationKanban({ stages, conversations: initial, tintColumns, showChannel = false, groupBy, filters = { search: "", agentId: null, instanceId: null }, sort = "recent", agents = [], departments = [], tenantId, supabaseToken, crmEnabled = false, dealPipelines = [] }: Props) {
  const router = useRouter()
  const [convs, setConvs] = useState(initial)
  const [activeId, setActiveId]       = useState<string | null>(null)
  const [pending, startTransition]    = useTransition()
  const [dealFor, setDealFor]         = useState<Conversation | null>(null)   // afford. "Abrir negócio"
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const [mgmtCards, setMgmtCards] = useState<Conversation[] | null>(null)

  // Sincroniza o funil com o SSR (router.refresh / fallback)
  useEffect(() => { setConvs(initial) }, [initial])

  const loadMgmt = useCallback(async () => {
    try { setMgmtCards(await getManagementCards() as unknown as Conversation[]) }
    catch (e) { console.error("getManagementCards:", e) }
  }, [])

  // Carrega/recarrega o panorama de gestão ao entrar numa lente (fica fresco;
  // o Realtime mantém atualizado a partir daí).
  useEffect(() => {
    if (groupBy !== "stage") loadMgmt()
  }, [groupBy, loadMgmt])

  // ── Realtime: substitui o poll de 10s/15s ───────────────────
  // Merge incremental in-place dos cards já carregados (move de coluna, atualiza
  // preview/valor; remove quando sai do board). Card NOVO/entrando → refresh
  // debounced (precisa dos embeds que o Realtime não traz). Fallback 60s.
  // ⚠️ Só ouvimos `chat_conversations`. Edição de NOME/VALOR do negócio (escreve só em
  // tenant_deals) não emite evento aqui → reflete no fallback 60s / navegação. OK p/ F1.1
  // (mover negócio já espelha a conversa, então etapa/posição são instantâneos).
  const groupByRef  = useRef(groupBy);          groupByRef.current  = groupBy
  const stageIdsRef = useRef<string[]>([]);     stageIdsRef.current = stages.map((s) => s.id)
  const convsRef    = useRef(convs);            convsRef.current    = convs
  const mgmtRef     = useRef(mgmtCards);         mgmtRef.current     = mgmtCards
  const loadMgmtRef = useRef(loadMgmt);          loadMgmtRef.current = loadMgmt
  const refreshT    = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!supabaseToken || !tenantId) return
    const client = getRealtimeClient(supabaseToken)
    let active = true

    const scheduleRefresh = () => {
      if (refreshT.current) return
      refreshT.current = setTimeout(() => {
        refreshT.current = null
        if (!active) return
        if (groupByRef.current === "stage") router.refresh()
        else loadMgmtRef.current()
      }, 800)
    }

    const channel = client
      .channel(`kanban:${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_conversations", filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          if (!active) return
          // A row do Realtime traz as colunas cruas (inclui archived_at, que o
          // shape do card não tem por ser filtrado na query).
          const row = (payload.new ?? payload.old) as (Conversation & { archived_at: string | null }) | undefined
          if (!row?.id) return
          const gb = groupByRef.current
          const isDelete = payload.eventType === "DELETE"

          const qualifies = !isDelete && !row.archived_at && (
            gb === "stage"
              ? stageIdsRef.current.includes(row.stage_id ?? "")
              : ["open", "pending", "snoozed"].includes(row.status)
          )

          const prev = gb === "stage" ? convsRef.current : mgmtRef.current
          if (prev == null) return                 // panorama ainda não carregado
          const existing = prev.find((c) => c.id === row.id)
          const has = !!existing

          // Card ganhou/trocou/perdeu negócio ativo → o embed do deal só vem da query
          // (o Realtime traz a row crua, sem join) → busca completa pra refletir o card.
          if (has && qualifies && (row.active_deal_id ?? null) !== (existing!.active_deal_id ?? null)) {
            scheduleRefresh()
            return
          }

          if (has) {
            const apply = (list: Conversation[]) => qualifies
              ? list.map((c) => c.id === row.id ? mergeCardScalars(c, row) : c)   // move/atualiza
              : list.filter((c) => c.id !== row.id)                               // saiu do board
            if (gb === "stage") setConvs(apply)
            else setMgmtCards((p) => (p ? apply(p) : p))
          } else if (qualifies) {
            scheduleRefresh()                       // card novo/entrando → busca completa
          }
        },
      )
      .subscribe()

    const fallback = setInterval(() => {
      if (!active) return
      if (groupByRef.current === "stage") router.refresh()
      else loadMgmtRef.current()
    }, 60_000)

    return () => {
      active = false
      if (refreshT.current) clearTimeout(refreshT.current)
      clearInterval(fallback)
      channel.unsubscribe()
    }
  }, [supabaseToken, tenantId, router])

  const readOnly    = groupBy !== "stage"
  const loadingMgmt = readOnly && mgmtCards === null
  const dataset     = groupBy === "stage" ? convs : (mgmtCards ?? [])
  const filtered    = useMemo(
    () => dataset.filter((c) => cardMatchesFilters(c, filters)),
    [dataset, filters.search, filters.agentId, filters.instanceId],
  )

  const columns = useMemo<Column[]>(() => {
    if (groupBy === "agent") return [
      { key: "__pool__", title: "Pool · não atribuído" },
      ...agents.map((a) => ({ key: a.id, title: a.full_name ?? "—" })),
    ]
    if (groupBy === "department") return [
      ...departments.map((d) => ({ key: d.id, title: d.name, color: d.color })),
      { key: "__none__", title: "Sem departamento" },
    ]
    return stages.map((s) => ({ key: s.id, title: s.name, color: s.color, stage: s }))
  }, [groupBy, stages, agents, departments])

  function cardsFor(key: string): Conversation[] {
    const list =
        groupBy === "stage" ? filtered.filter((c) => c.stage_id === key)
      : groupBy === "agent" ? filtered.filter((c) => (c.assigned_to ?? "__pool__") === key)
      :                       filtered.filter((c) => (c.department_id ?? "__none__") === key)
    return sortCards(list, sort)
  }

  // ── Drag-and-drop (dnd-kit) ─────────────────────────────────
  function onDragStart(e: DragStartEvent) { setActiveId(String(e.active.id)) }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const cardId  = String(active.id)
    const stageId = String(over.id)            // droppable.id = key da etapa
    const c = convs.find((x) => x.id === cardId)
    if (!c || c.stage_id === stageId) return
    const newPos = cardsFor(stageId).length
    // Otimista: move o card + alinha o stage do negócio embedado (quando há) pra a
    // coluna não "pular" no re-render (o deal é a fonte do título/valor).
    setConvs((prev) => prev.map((x) => x.id === cardId
      ? { ...x, stage_id: stageId, card_position: newPos, deal: x.deal ? { ...x.deal, stage_id: stageId } : null }
      : x))
    startTransition(async () => {
      // Card COM negócio → move o NEGÓCIO (fonte da verdade; espelha etapa→conversa p/ relatórios).
      // Card SEM negócio → move a conversa, como sempre.
      const action = c.deal
        ? moveDeal(c.id, c.deal.id, stageId).then((r) => { if ("error" in r) throw new Error(r.error) })
        : moveConversation(cardId, stageId, newPos)
      try { await action }
      catch (err) {
        // Reverte pela VERDADE do servidor (não pra `initial`, que perderia deltas do
        // Realtime chegados desde o último SSR e poderia ressuscitar card removido).
        alert((err as Error).message ?? "Erro ao mover")
        router.refresh()
      }
    })
  }
  const activeCard = activeId ? dataset.find((c) => c.id === activeId) ?? null : null

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="h-full">
        {loadingMgmt ? (
          <div className="flex items-center justify-center gap-2 h-full text-sm text-slate-400">
            <Loader2 className="size-4 animate-spin" /> Carregando panorama…
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-4 h-full">
            {columns.map((col) => (
              <KanbanColumn
                key={col.key}
                col={col}
                list={cardsFor(col.key)}
                tinted={tintColumns && !!col.color}
                readOnly={readOnly}
                showChannel={showChannel}
                dragging={!!activeId}
                onOpenDeal={crmEnabled ? setDealFor : undefined}
              />
            ))}
          </div>
        )}

        {pending && (
          <div className="fixed top-20 right-4 bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-lg flex items-center gap-2 text-xs text-slate-600 z-50">
            <Loader2 className="size-3.5 animate-spin text-primary-600" />
            Salvando...
          </div>
        )}
      </div>

      {/* Card "levantado" que segue o cursor — DOM real, 100% opaco (resolve a
          transparência do DnD nativo). dnd-kit dimensiona pelo tamanho visual
          do card de origem → casa em qualquer zoom sem double-scale. */}
      <DragOverlay dropAnimation={null}>
        {activeCard ? <ConversationCard conv={activeCard} showChannel={showChannel} overlay /> : null}
      </DragOverlay>

      {dealFor && (
        <NewDealDialog
          conversationId={dealFor.id}
          pipelines={dealPipelines}
          contactName={dealFor.chat_contacts ? displayContactName(dealFor.chat_contacts) : "Contato"}
          initialStageId={dealFor.stage_id ?? undefined}
          onClose={() => setDealFor(null)}
          onCreated={() => { setDealFor(null); router.refresh() }}
        />
      )}
    </DndContext>
  )
}

// ── Coluna droppable (dnd-kit) ──────────────────────────────────
function KanbanColumn({ col, list, tinted, readOnly, showChannel, dragging, onOpenDeal }: {
  col: Column; list: Conversation[]; tinted: boolean; readOnly: boolean; showChannel: boolean; dragging: boolean
  onOpenDeal?: (c: Conversation) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key, disabled: readOnly })
  const StageIcon = col.stage?.is_won ? Trophy : col.stage?.is_lost ? XCircle : null
  const total     = list.reduce((s, c) => s + effectiveValue(c), 0)
  const highlight = isOver && !readOnly && dragging
  return (
    <div
      ref={setNodeRef}
      style={{
        borderTop: `3px solid ${col.color ?? "#cbd5e1"}`,
        backgroundColor: highlight || !tinted ? undefined : `color-mix(in srgb, ${col.color} 12%, transparent)`,
      }}
      className={`shrink-0 w-80 flex flex-col rounded-xl overflow-hidden transition-all duration-150 ${
        highlight ? "bg-primary-50 ring-2 ring-inset ring-primary-300" : tinted ? "" : "bg-slate-100/60"
      }`}
    >
      <div className="px-3 py-2.5 border-b border-slate-200/70">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-sm font-semibold text-slate-900 flex-1 truncate">{col.title}</span>
          {StageIcon && <StageIcon className={`size-3.5 ${col.stage?.is_won ? "text-emerald-600" : "text-red-500"}`} />}
          <span className="text-[10px] font-bold text-slate-500 tabular-nums bg-white rounded-full px-1.5 py-0.5 min-w-[20px] text-center shadow-sm">
            {list.length}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-bold text-slate-800 tabular-nums truncate">
            {total > 0 ? BRL(total) : <span className="text-xs font-normal text-slate-300">—</span>}
          </span>
          {col.stage && <span className="text-[10px] text-slate-400 tabular-nums shrink-0">{col.stage.probability_pct}% prob.</span>}
        </div>
      </div>

      <div className="flex-1 min-h-0 px-2 py-2 space-y-2 overflow-y-auto">
        {list.map((conv) => <DraggableCard key={conv.id} conv={conv} showChannel={showChannel} readOnly={readOnly} onOpenDeal={onOpenDeal} />)}
        {highlight && (
          <div className="rounded-lg border-2 border-dashed border-primary-300 bg-primary-50/60 h-14 flex items-center justify-center text-[11px] font-semibold text-primary-600 shrink-0">
            Soltar aqui
          </div>
        )}
        {list.length === 0 && !highlight && (
          <p className="text-[11px] text-slate-400 italic text-center py-6">{readOnly ? "—" : "Solte conversas aqui"}</p>
        )}
      </div>
    </div>
  )
}

// ── Card draggable (dnd-kit) ────────────────────────────────────
function DraggableCard({ conv, showChannel, readOnly, onOpenDeal }: { conv: Conversation; showChannel: boolean; readOnly: boolean; onOpenDeal?: (c: Conversation) => void }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: conv.id, disabled: readOnly })
  return (
    <ConversationCard
      conv={conv}
      showChannel={showChannel}
      readOnly={readOnly}
      dragRef={setNodeRef}
      listeners={listeners}
      attributes={attributes}
      isDragging={isDragging}
      onOpenDeal={onOpenDeal}
    />
  )
}

function ConversationCard({
  conv, showChannel, readOnly = false, dragRef, listeners, attributes, isDragging = false, overlay = false, onOpenDeal,
}: {
  conv:        Conversation
  showChannel: boolean
  readOnly?:   boolean
  dragRef?:    (el: HTMLElement | null) => void
  listeners?:  Record<string, unknown>
  attributes?: DraggableAttributes
  isDragging?: boolean
  overlay?:    boolean
  onOpenDeal?: (c: Conversation) => void
}) {
  const contact      = conv.chat_contacts
  const displayName  = contact ? displayContactName(contact) : "Sem nome"
  const initial      = contact ? displayContactInitial(contact) : "?"
  // Negócio ativo manda no card: nome = título, contato = subtítulo, valor = do negócio.
  // Etapa/aging/ganho-perdido seguem da CONVERSA (espelhada — fica fresca no Realtime).
  const deal         = conv.deal
  const dealName     = deal?.name?.trim() || null
  const title        = dealName ?? displayName
  const effValue     = effectiveValue(conv)

  const ownerName    = conv.profiles?.full_name?.split(" ")[0]
  const time         = conv.last_message_at ? relativeTime(conv.last_message_at) : null
  // SLA: "a bola está com você" = última msg do contato e conversa não resolvida.
  const awaitingReply = conv.last_message_dir === "in" && conv.status !== "resolved"
  const overdueReply  = awaitingReply && !!time?.hot
  const dirArrow     =
    conv.last_message_dir === "out_phone" ? <Smartphone    className="size-3 text-emerald-500 shrink-0 mt-0.5" />
    : conv.last_message_dir === "out"     ? <ArrowUpRight  className="size-3 text-emerald-500 shrink-0 mt-0.5" />
    :                                       <ArrowDownLeft className="size-3 text-sky-400 shrink-0 mt-0.5" />
  const today        = new Date().toISOString().split("T")[0]
  const overdueDate  = conv.expected_close_date && conv.expected_close_date < today && !conv.won_at && !conv.lost_at
  const aging        = stageAging(conv)
  const prio         = conv.priority === "urgent" ? { dot: "bg-red-500",   label: "Urgente" }
                     : conv.priority === "high"   ? { dot: "bg-amber-500", label: "Alta prioridade" }
                     : null

  const cardCls = `block group bg-white rounded-lg border shadow-sm transition-all ${
    overlay
      ? "border-primary-300 shadow-2xl rotate-2 cursor-grabbing"
      : `border-slate-200 hover:shadow-md hover:border-primary-200 ${readOnly ? "cursor-pointer" : "cursor-grab"}`
  } ${isDragging ? "opacity-40 scale-[0.97]" : ""} ${
    aging && !overlay ? (aging.tone === "red" ? "border-l-[3px] border-l-red-400" : "border-l-[3px] border-l-amber-400") : ""
  }`

  const body = (
    <div className="p-3 space-y-2">

        <div className="flex items-start gap-2.5">
          <div className="size-9 rounded-full bg-gradient-to-br from-white to-slate-200 ring-1 ring-inset ring-slate-200/70 flex items-center justify-center shrink-0 overflow-hidden">
            {contact?.profile_pic_url ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={contact.profile_pic_url} alt="" className="size-9 object-cover" />
            ) : (
              <span className="text-sm font-bold text-slate-400">{initial}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-900 truncate flex items-center gap-1">
              {prio && <span className={`size-1.5 rounded-full shrink-0 ${prio.dot}`} title={prio.label} />}
              {dealName && <Briefcase className="size-3 text-primary-500 shrink-0" />}
              {conv.channel === "site" && (
                <span className="inline-flex items-center justify-center size-4 rounded-full bg-sky-50 border border-sky-200 shrink-0" title="Lead via site">
                  <SourceLogo source="webform" size={9} />
                </span>
              )}
              <span className="truncate">{title}</span>
            </p>
            {dealName ? (
              <p className="text-[10px] text-slate-500 truncate">{displayName}</p>
            ) : (
              <p className="text-[10px] text-slate-400 truncate flex items-center gap-1">
                <Phone className="size-2.5" />
                {contact?.phone_number ? formatPhone(contact.phone_number) : "—"}
              </p>
            )}
          </div>
          <GripVertical className="size-3 text-slate-300 shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>

        {conv.last_message_preview && (
          <div className="flex items-start gap-1.5 text-[11px] text-slate-500 bg-slate-50 rounded px-2 py-1.5">
            {dirArrow}
            <p className="line-clamp-2 leading-snug">{conv.last_message_preview}</p>
          </div>
        )}

        <div className="flex items-center gap-1 flex-wrap">
          {(() => {
            const lc = lifecycleMeta(contact?.lifecycle_stage)
            return (
              <span
                className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${lc.bg} ${lc.text}`}
                title={lc.label}
              >
                {lc.icon} {lc.label}
              </span>
            )
          })()}
          {contact?.source && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-white border border-slate-200">
              <SourceLogo source={contact.source} size={11} />
            </span>
          )}
          {aging && (
            <span
              className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${aging.tone === "red" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"}`}
              title={aging.inStage ? `${aging.days} dias nesta etapa` : `${aging.days} dias desde a última atividade`}
            >
              <Clock className="size-2.5" /> {aging.days}d
            </span>
          )}
        </div>

        {(effValue > 0 || conv.expected_close_date) && (
          <div className="flex items-center justify-between gap-2 text-[10px] pt-2 border-t border-slate-100">
            <div className="flex items-center gap-2 min-w-0">
              {effValue > 0 ? (
                <span className="font-semibold text-slate-700 tabular-nums flex items-center gap-0.5">
                  <DollarSign className="size-2.5" />{BRL(effValue).replace("R$", "").trim()}
                </span>
              ) : null}
            </div>
            {conv.expected_close_date && (
              <span className={`flex items-center gap-0.5 ${overdueDate ? "text-red-500 font-semibold" : "text-slate-400"}`}>
                <Calendar className="size-2.5" />
                {new Date(conv.expected_close_date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-100">
          <div className="flex items-center gap-1.5 min-w-0">
            {time && (
              <span className={`inline-flex items-center gap-1 text-[10px] shrink-0 ${overdueReply ? "text-red-600 font-semibold" : "text-slate-400"}`}>
                {overdueReply ? <AlertCircle className="size-2.5" /> : <Clock className="size-2.5" />}
                {time.label}{overdueReply && " sem resposta"}
              </span>
            )}
            {conv.whatsapp_instances && (showChannel || conv.whatsapp_instances.display_name?.trim()) && (
              <span
                className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full max-w-[120px] min-w-0 ${
                  conv.whatsapp_instances.provider === "meta_cloud" ? "bg-primary-50 text-primary-700" : "bg-slate-100 text-slate-600"
                }`}
                title={`Atendido pelo número ${conv.whatsapp_instances.display_name?.trim() || (conv.whatsapp_instances.provider === "meta_cloud" ? "Oficial" : "QR")}`}
              >
                {conv.whatsapp_instances.provider === "meta_cloud" ? <BadgeCheck className="size-2.5 shrink-0" /> : <Smartphone className="size-2.5 shrink-0" />}
                <span className="truncate">{conv.whatsapp_instances.display_name?.trim() || (conv.whatsapp_instances.provider === "meta_cloud" ? "Oficial" : "QR")}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {conv.unread_count > 0 && (
              <span className="size-4 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center">
                {conv.unread_count}
              </span>
            )}
            {ownerName && (
              <div className="size-4 rounded-full bg-primary-100 flex items-center justify-center" title={ownerName}>
                <span className="text-[8px] font-bold text-primary-700">{ownerName[0]?.toUpperCase()}</span>
              </div>
            )}
          </div>
        </div>

        {/* Conversa SEM negócio + CRM ligado → atalho pra abrir um (caminho de adoção
            do board híbrido). preventDefault/stopPropagation: não navega nem inicia drag. */}
        {!deal && onOpenDeal && !overlay && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenDeal(conv) }}
            className="w-full inline-flex items-center justify-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-primary-700 hover:bg-primary-50 rounded-md py-1 border border-dashed border-slate-200 hover:border-primary-200 transition-colors"
          >
            <Plus className="size-2.5" /> Abrir negócio
          </button>
        )}
      </div>
  )

  if (overlay) return <div className={cardCls}>{body}</div>
  return (
    <Link
      href={`/inbox?conversation=${conv.id}`}
      ref={dragRef as React.Ref<HTMLAnchorElement>}
      {...listeners}
      {...attributes}
      className={cardCls}
    >
      {body}
    </Link>
  )
}
