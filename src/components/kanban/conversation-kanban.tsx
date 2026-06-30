"use client"

import { useState, useEffect, useMemo, useCallback, useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Clock, Trophy, XCircle, Loader2, Plus, FileText,
  Globe, MessageCircle, Mail, User,
} from "lucide-react"
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
  type DragStartEvent, type DragEndEvent, type DraggableAttributes,
} from "@dnd-kit/core"
import { moveConversation, getManagementCards } from "@/lib/actions/pipeline"
import { transferConversation, updateConversationStatus } from "@/lib/actions/chat"
import { type DealPipeline } from "@/lib/actions/deals"
import { getRealtimeClient } from "@/lib/realtime"
import { lifecycleMeta } from "@/lib/lifecycle"
import { displayContactName, displayContactInitial } from "@/lib/contact"
import { NewConversationModal } from "@/components/chat/new-conversation-modal"
import { SourceLogo } from "@/components/chat/source-logo"

// Canal da conversa → fonte do logo de marca (SourceLogo). null = sem logo (ex: e-mail/legado).
const CHANNEL_SOURCE: Record<string, string> = { whatsapp: "whatsapp_inbound", instagram: "instagram", site: "webform" }

// Coluna FIXA de sistema "Concluídos" (status=resolved). Não é uma etapa do funil —
// é o fim do ciclo de atendimento. Arrastar pra cá = Concluir; arrastar pra fora = Reabrir.
const DONE_KEY = "__done__"

interface Stage {
  id:              string
  name:            string
  color:           string
  position:        number
  probability_pct: number
  is_won:          boolean
  is_lost:         boolean
  is_triage:       boolean
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

// Valor "efetivo" do card: do negócio quando há um; senão da conversa (legado/fallback).
export function effectiveValue(c: { deal?: DealMini | null; estimated_value: number | null }): number {
  return Number((c.deal ? c.deal.estimated_value : c.estimated_value) ?? 0)
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

export function ConversationKanban({ stages, conversations: initial, tintColumns, groupBy, filters = { search: "", agentId: null, instanceId: null }, sort = "recent", agents = [], departments = [], tenantId, supabaseToken }: Props) {
  const router = useRouter()
  const [convs, setConvs] = useState(initial)
  const [activeId, setActiveId]       = useState<string | null>(null)
  const [pending, startTransition]    = useTransition()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const [mgmtCards, setMgmtCards] = useState<Conversation[] | null>(null)
  const [showNew, setShowNew]     = useState(false)   // "+ Adicionar conversa"

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

  // Departamento (Quadro de Atendimento) é DRAGGABLE (rotear); Atendente é só leitura.
  const readOnly    = groupBy === "agent"
  const loadingMgmt = groupBy !== "stage" && mgmtCards === null
  const dataset     = groupBy === "stage" ? convs : (mgmtCards ?? [])
  const filtered    = useMemo(
    () => dataset.filter((c) => cardMatchesFilters(c, filters)),
    [dataset, filters.search, filters.agentId, filters.instanceId],
  )

  // Etapa de triagem (entrada). Conversas SEM etapa (atendimento-puro) caem aqui.
  const triageStageId = useMemo(() => stages.find((s) => s.is_triage)?.id ?? null, [stages])

  const columns = useMemo<Column[]>(() => {
    if (groupBy === "agent") return [
      { key: "__pool__", title: "Fila geral · não atribuído" },
      ...agents.map((a) => ({ key: a.id, title: a.full_name ?? "—" })),
    ]
    if (groupBy === "department") return [
      { key: "__none__", title: "Triagem", color: "#64748b" },
      ...departments.map((d) => ({ key: d.id, title: d.name, color: d.color })),
    ]
    return [
      ...stages.map((s) => ({ key: s.id, title: s.name, color: s.color, stage: s })),
      { key: DONE_KEY, title: "Concluídos", color: "#16a34a" },
    ]
  }, [groupBy, stages, agents, departments])

  function cardsFor(key: string): Conversation[] {
    // Concluídos = status resolvido (de qualquer etapa). Recentes primeiro, cap pra não inchar.
    if (groupBy === "stage" && key === DONE_KEY) {
      const done = filtered.filter((c) => c.status === "resolved")
      done.sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""))
      return done.slice(0, 50)
    }
    const list =
        groupBy === "stage" ? filtered.filter((c) => c.status !== "resolved" && (c.stage_id === key || (key === triageStageId && c.stage_id == null)))
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

    // ── Modo DEPARTAMENTO (Quadro de Atendimento): rotear via o MOTOR de
    // transferência (mesmo do botão "Transferir" no chat) — gate de visibilidade,
    // tira a IA de cena, nota de sistema. Soltar num setor → fila do setor;
    // soltar na Triagem → fila geral (sem setor, sem dono). NÃO é update cru.
    if (groupBy === "department") {
      const card = (mgmtCards ?? []).find((x) => x.id === cardId)
      if (!card) return
      const targetDept = over.id === "__none__" ? null : String(over.id)
      if ((card.department_id ?? null) === targetDept) return   // mesma coluna → no-op
      setMgmtCards((prev) => (prev ?? []).map((x) => x.id === cardId ? { ...x, department_id: targetDept, assigned_to: null } : x))
      startTransition(async () => {
        const r = targetDept
          ? await transferConversation(cardId, { mode: "department", departmentId: targetDept })
          : await transferConversation(cardId, { mode: "pool" })
        if (r?.error) { alert(r.error); loadMgmt() }
      })
      return
    }

    // ── Modo ETAPA (board de atendimento): arrastar move SÓ a conversa
    // (pipeline_stages). O negócio é independente (deal_pipelines) — move-se no
    // board de Negócios, nunca aqui. O active_deal_id no card é só um pointer.
    const targetKey = String(over.id)          // droppable.id = key da etapa / Concluídos
    const c = convs.find((x) => x.id === cardId)
    if (!c) return

    // Concluir: soltou na coluna "Concluídos" → status resolvido. NÃO toca o dono
    // (o Vínculo cuida de pra quem o cliente volta). Já resolvida → no-op.
    if (targetKey === DONE_KEY) {
      if (c.status === "resolved") return
      setConvs((prev) => prev.map((x) => x.id === cardId ? { ...x, status: "resolved" } : x))
      startTransition(async () => {
        try { await updateConversationStatus(cardId, "resolved") }
        catch (err) { alert((err as Error).message ?? "Erro ao concluir"); router.refresh() }
      })
      return
    }

    // Destino é uma etapa real. Vindo de Concluídos → reabre (status → open) e move.
    const stageId     = targetKey
    const wasResolved = c.status === "resolved"
    if (c.stage_id === stageId && !wasResolved) return
    const newPos = cardsFor(stageId).length
    setConvs((prev) => prev.map((x) => x.id === cardId ? { ...x, stage_id: stageId, card_position: newPos, status: wasResolved ? "open" : x.status } : x))
    startTransition(async () => {
      try {
        if (wasResolved) await updateConversationStatus(cardId, "open")
        await moveConversation(cardId, stageId, newPos)
      } catch (err) { alert((err as Error).message ?? "Erro ao mover"); router.refresh() }
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
                dragging={!!activeId}
                onAddConversation={groupBy === "stage" && col.key !== DONE_KEY ? () => setShowNew(true) : undefined}
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
        {activeCard ? <ConversationCard conv={activeCard} overlay /> : null}
      </DragOverlay>

      <NewConversationModal open={showNew} onClose={() => setShowNew(false)} />
    </DndContext>
  )
}

// ── Empty-state por etapa (desenhado, didático) ─────────────────
function ColumnEmpty({ col }: { col: Column }) {
  const won = col.stage?.is_won, lost = col.stage?.is_lost
  const Icon = won ? Trophy : lost ? XCircle : FileText
  const tone = won ? "text-emerald-500 bg-emerald-50" : lost ? "text-red-400 bg-red-50" : "text-slate-300 bg-slate-100"
  const text = won  ? "As conversas ganhas aparecerão aqui."
             : lost ? "Conversas perdidas aparecerão aqui."
             :        "Nenhuma conversa nesta etapa."
  const sub = won ? "Parabéns!" : null
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 px-4 py-10 select-none">
      <div className={`size-11 rounded-full grid place-items-center ${tone}`}>
        <Icon className="size-5" />
      </div>
      {sub && <p className="text-xs font-semibold text-slate-500">{sub}</p>}
      <p className="text-[11px] text-slate-400 leading-relaxed max-w-[180px]">{text}</p>
    </div>
  )
}

// ── Coluna droppable (dnd-kit) ──────────────────────────────────
function KanbanColumn({ col, list, tinted, readOnly, dragging, onAddConversation }: {
  col: Column; list: Conversation[]; tinted: boolean; readOnly: boolean; dragging: boolean
  onAddConversation?: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key, disabled: readOnly })
  const StageIcon = col.stage?.is_won ? Trophy : col.stage?.is_lost ? XCircle : null
  const highlight = isOver && !readOnly && dragging
  return (
    <div
      ref={setNodeRef}
      style={{
        borderTop: `3px solid ${col.color ?? "#cbd5e1"}`,
        backgroundColor: highlight || !tinted ? undefined : `color-mix(in srgb, ${col.color} 7%, transparent)`,
      }}
      className={`shrink-0 w-80 flex flex-col rounded-xl overflow-hidden transition-all duration-150 ${
        highlight ? "bg-primary-50 ring-2 ring-inset ring-primary-300" : tinted ? "" : "bg-slate-50/80"
      }`}
    >
      <div className="px-3.5 py-3 flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-800 flex-1 truncate">{col.title}</span>
        {StageIcon && <StageIcon className={`size-4 ${col.stage?.is_won ? "text-emerald-500" : "text-red-400"}`} />}
        <span className="text-[11px] font-semibold text-slate-500 tabular-nums bg-white/80 ring-1 ring-inset ring-slate-200/80 rounded-full px-2 py-0.5 min-w-[22px] text-center">
          {list.length}
        </span>
      </div>

      <div className="flex-1 min-h-0 px-2.5 pb-2 space-y-2.5 overflow-y-auto">
        {list.map((conv) => (
          <DraggableCard key={conv.id} conv={conv} readOnly={readOnly} />
        ))}
        {highlight && (
          <div className="rounded-xl border-2 border-dashed border-primary-300 bg-primary-50/60 h-16 flex items-center justify-center text-[11px] font-semibold text-primary-600 shrink-0">
            Soltar aqui
          </div>
        )}
        {list.length === 0 && !highlight && <ColumnEmpty col={col} />}
      </div>

      {onAddConversation && (
        <button
          type="button"
          onClick={onAddConversation}
          className="m-2 mt-0 inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium text-slate-400 hover:text-primary-700 hover:bg-white/70 transition-colors"
        >
          <Plus className="size-3.5" /> Adicionar conversa
        </button>
      )}
    </div>
  )
}

// ── Card draggable (dnd-kit) ────────────────────────────────────
function DraggableCard({ conv, readOnly }: { conv: Conversation; readOnly: boolean }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: conv.id, disabled: readOnly })
  return (
    <ConversationCard
      conv={conv}
      readOnly={readOnly}
      dragRef={setNodeRef}
      listeners={listeners}
      attributes={attributes}
      isDragging={isDragging}
    />
  )
}

// ── Canal da conversa (ícone + rótulo) ──────────────────────────
function channelMeta(channel: string | null): { Icon: typeof Globe; label: string; cls: string } {
  switch (channel) {
    case "whatsapp": return { Icon: MessageCircle, label: "WhatsApp", cls: "text-emerald-500" }
    case "site":     return { Icon: Globe,         label: "Site",     cls: "text-sky-500" }
    case "email":    return { Icon: Mail,          label: "E-mail",   cls: "text-violet-500" }
    default:         return { Icon: MessageCircle, label: channel ? channel[0].toUpperCase() + channel.slice(1) : "Conversa", cls: "text-slate-400" }
  }
}

function ConversationCard({
  conv, readOnly = false, dragRef, listeners, attributes, isDragging = false, overlay = false,
}: {
  conv:        Conversation
  showChannel?: boolean
  readOnly?:   boolean
  dragRef?:    (el: HTMLElement | null) => void
  listeners?:  Record<string, unknown>
  attributes?: DraggableAttributes
  isDragging?: boolean
  overlay?:    boolean
}) {
  const contact      = conv.chat_contacts
  const displayName  = contact ? displayContactName(contact) : "Sem nome"
  const initial      = contact ? displayContactInitial(contact) : "?"
  const router       = useRouter()

  const deal         = conv.deal
  // Rótulo discreto do negócio: nome do negócio, senão o estágio do relacionamento.
  const dealLabel    = deal ? (deal.name?.trim() || lifecycleMeta(contact?.lifecycle_stage).label) : null

  const ownerName    = conv.profiles?.full_name?.split(" ")[0]
  const time         = conv.last_message_at ? relativeTime(conv.last_message_at) : null
  const awaitingReply = conv.last_message_dir === "in" && conv.status !== "resolved"
  const overdueReply  = awaitingReply && !!time?.hot
  // "Aguardando atendimento" = ninguém atendendo: cliente mandou a última msg OU
  // conversa sem dono (fila — Triagem/setor), enquanto não resolvida.
  const aguardando    = conv.status !== "resolved" && (conv.last_message_dir === "in" || conv.assigned_to == null)
  const aging         = stageAging(conv)
  const ch            = channelMeta(conv.channel)
  const chSource      = CHANNEL_SOURCE[conv.channel ?? ""] ?? null

  const cardCls = `block group bg-white rounded-xl border transition-all ${
    overlay
      ? "border-primary-300 shadow-2xl rotate-2 cursor-grabbing"
      : `border-slate-200/80 hover:border-slate-300 hover:shadow-soft ${readOnly ? "cursor-pointer" : "cursor-grab"}`
  } ${isDragging ? "opacity-40 scale-[0.97]" : ""} ${
    aging && !overlay ? (aging.tone === "red" ? "border-l-[3px] border-l-red-400" : "border-l-[3px] border-l-amber-400") : ""
  }`

  const body = (
    <div className="p-3.5 space-y-2.5">
      {/* Identidade */}
      <div className="flex items-start gap-2.5">
        <div className="relative shrink-0">
          <div className="size-9 rounded-full bg-gradient-to-br from-slate-50 to-slate-200 ring-1 ring-inset ring-slate-200/70 flex items-center justify-center overflow-hidden">
            {contact?.profile_pic_url ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={contact.profile_pic_url} alt="" className="size-9 object-cover" />
            ) : (
              <span className="text-sm font-bold text-slate-400">{initial}</span>
            )}
          </div>
          {chSource && (
            <span className="absolute -bottom-1 -right-1 inline-flex items-center justify-center">
              <SourceLogo source={chSource} size={15} />
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-slate-900 truncate">{displayName}</p>
          {aguardando && (
            <span className="text-[10px] font-semibold text-amber-500 animate-pulse" title="Cliente aguardando atendimento">
              Aguardando atend.
            </span>
          )}
        </div>
        {conv.unread_count > 0 && (
          <span className="size-5 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center shrink-0">
            {conv.unread_count}
          </span>
        )}
      </div>

      {/* Prévia */}
      {conv.last_message_preview && (
        <p className="text-[12px] text-slate-500 leading-snug line-clamp-2">{conv.last_message_preview}</p>
      )}

      {/* Meta: canal · atendente · tempo */}
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400 min-w-0">
        <span className="shrink-0">{ch.label}</span>
        {ownerName && (
          <>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1 shrink-0 min-w-0">
              <User className="size-3" /> <span className="truncate max-w-[80px]">{ownerName}</span>
            </span>
          </>
        )}
        {time && (
          <>
            <span className="text-slate-300">·</span>
            <span className={`inline-flex items-center gap-1 shrink-0 ml-auto ${overdueReply ? "text-red-500 font-medium" : ""}`}>
              <Clock className="size-3" /> {time.label}{overdueReply && " sem resposta"}
            </span>
          </>
        )}
      </div>

      {/* Negócio — pointer discreto (só quando existe). Sem afford. de criação aqui. */}
      {dealLabel && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/negocios/${conv.active_deal_id}`) }}
          className="flex items-center gap-1 text-[11px] pt-2 border-t border-slate-100 w-full text-left"
        >
          <span className="text-slate-400">Negócio:</span>
          <span className="font-semibold text-primary-600 hover:text-primary-700 truncate">{dealLabel}</span>
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
