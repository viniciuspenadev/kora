"use client"

import { ContactPic } from "@/components/chat/contact-pic"

import { useState, useMemo, useRef, useEffect } from "react"
import type { KeyboardEvent, MouseEvent, PointerEvent, WheelEvent } from "react"
import {
  Search, MessageCircle, AlertCircle, Loader2, Filter, CheckCircle2, Clock, Moon,
  Image as ImageIcon, Mic, Video, FileText, X, MessageSquarePlus,
  ArrowUpRight, ArrowDownLeft, Smartphone, BadgeCheck,
  Pin, PinOff, Flag, FlagOff, UserPlus, Archive, ArchiveRestore, AlarmClock,
} from "lucide-react"
import { followUpChip } from "@/lib/atendimento/followup-rules"
import { formatPhoneDisplay } from "@/lib/phone-utils"
import { NewConversationModal } from "./new-conversation-modal"
import { displayContactName, displayContactInitial } from "@/lib/contact"
import { SourceLogo, channelToSource } from "@/components/chat/source-logo"
import { AgentAvatar } from "@/components/chat/agent-avatar"
import { Switch } from "@/components/ui/switch"
import { SimpleSelect } from "@/components/ui/select"
import { EmptyState } from "@/components/ui/empty-state"
import type { ChatConversation } from "@/types/chat"
import type { ConversationView, ConversationViewCounts } from "@/lib/actions/conversations"

interface PipelineMini { id: string; name: string; color: string; is_default: boolean }
interface StageMini    { id: string; pipeline_id: string; name: string; color: string; position: number; is_won: boolean; is_lost: boolean }
interface TagMini        { id: string; name: string; color: string }
interface DepartmentMini { id: string; name: string; color: string }
interface AgentMini      { id: string; full_name: string | null }
type ChannelFilter = "" | "whatsapp" | "instagram" | "site"

interface Props {
  conversations:   ChatConversation[]
  activeId:        string | null
  onSelect:        (id: string) => void
  currentUserId:   string
  onToggleFlag:    (id: string, value: boolean) => void
  onTogglePin:     (id: string, value: boolean) => void
  onAssignMe:      (id: string) => void
  onArchive:       (id: string) => void
  viewFilter:      ConversationView | null
  onViewChange:    (view: ConversationView | null) => void
  viewCounts:      ConversationViewCounts
  statusFilter:    string
  onStatusChange:  (status: string) => void
  channelFilter:   ChannelFilter
  onChannelFilterChange: (channel: ChannelFilter) => void
  pipelines:       PipelineMini[]
  stages:          StageMini[]
  tags:            TagMini[]
  departments:     DepartmentMini[]
  tagsByContact:   Record<string, string[]>
  showChannel?:    boolean         // mostra badge de canal (Baileys/Oficial) — só com 2+ instâncias
  officialChannel?: boolean        // canal default é oficial → nova conversa exige template
  channelReady?:   boolean         // false = nenhum canal conectado → "nova conversa" desabilitada
  agents:          AgentMini[]

  // ── Filter state (lifted to InboxClient — server-side) ───
  searchValue:          string
  onSearchChange:       (v: string) => void
  pipelineFilter:       string
  onPipelineFilterChange: (v: string) => void
  agentFilter:          string
  onAgentFilterChange:  (v: string) => void
  departmentFilter:     string
  onDepartmentFilterChange: (v: string) => void
  tagFilter:            string
  onTagFilterChange:    (v: string) => void
  staleOnly:            boolean
  onStaleOnlyChange:    (v: boolean) => void
  fromAd:               boolean
  onFromAdChange:       (v: boolean) => void
  archivedOnly:         boolean
  onArchivedOnlyChange: (v: boolean) => void

  // ── Paginação ──────────────────────────────────────────
  hasMore:        boolean
  onLoadMore:     () => void
  loadingMore:    boolean
  loadingList:    boolean
}

const STATUS_TABS = [
  { key: "all",      label: "Todas" },        // todos os status — exceto arquivadas (essas têm o seu próprio item)
  { key: "open",     label: "Abertas" },
  { key: "pending",  label: "Pendentes" },
  // "Adiados" virou "Follow-up": adiar SEM hora marcada não servia pra nada (a
  // conversa sumia e ninguém a acordava). Agora a aba é o recorte por PROMESSA,
  // ordenada por prazo — o mais atrasado no topo.
  { key: "followup", label: "Follow-up" },
  { key: "resolved", label: "Resolvidas" },
]

const QUICK_VIEWS: Array<{ key: ConversationView; label: string }> = [
  { key: "all",      label: "Todas" },
  { key: "mine",     label: "Minhas" },
  { key: "waiting",  label: "Aguardando" },
  { key: "unread",   label: "Não lidas" },
  { key: "resolved", label: "Resolvidas" },
]

const CHANNEL_OPTIONS: Array<{ value: ChannelFilter; label: string }> = [
  { value: "",          label: "Todos os canais" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "site",      label: "Chat do site" },
]

// Ícone de status por card — mesma linguagem do menu ⋮ do header.
// 'open' não tem ícone (estado normal não polui a lista).
const STATUS_ICON: Record<string, { Icon: typeof Clock; className: string; label: string }> = {
  pending:  { Icon: Clock,        className: "text-amber-500", label: "Pendente" },
  snoozed:  { Icon: Moon,         className: "text-slate-400", label: "Adiado" },
  resolved: { Icon: CheckCircle2, className: "text-green-600", label: "Resolvido" },
}

const STALE_HOURS_THRESHOLD = 24

/** Badge de canal por conversa (só aparece com 2+ instâncias no tenant). */
function ChannelBadge({ provider, name }: { provider: string | null; name?: string | null }) {
  const isMeta = provider === "meta_cloud"
  // Mostra o NOME do número (display_name) quando o tenant nomeou; senão Oficial/QR.
  const label = name?.trim() || (isMeta ? "Oficial" : "QR")
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[9px] font-semibold px-1 py-0.5 rounded shrink-0 max-w-[120px] ${
        isMeta ? "bg-primary-50 text-primary-700" : "bg-slate-100 text-slate-500"
      }`}
      title={isMeta ? "WhatsApp API Oficial" : "WhatsApp (QR)"}
    >
      {isMeta ? <BadgeCheck className="size-2.5 shrink-0" /> : <Smartphone className="size-2.5 shrink-0" />}
      <span className="truncate">{label}</span>
    </span>
  )
}

function inferMediaIcon(preview: string | null): React.ReactNode | null {
  if (!preview) return null
  if (preview.startsWith("📷")) return <ImageIcon className="size-3 text-slate-400" />
  if (preview.startsWith("🎤")) return <Mic        className="size-3 text-slate-400" />
  if (preview.startsWith("📹")) return <Video      className="size-3 text-slate-400" />
  if (preview.startsWith("📎")) return <FileText   className="size-3 text-slate-400" />
  return null
}

function hoursSince(date: string): number {
  return Math.floor((Date.now() - new Date(date).getTime()) / (60 * 60 * 1000))
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  const hrs  = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return "agora"
  if (mins < 60) return `${mins}m`
  if (hrs < 24)  return `${hrs}h`
  if (days < 7)  return `${days}d`
  return new Date(dateStr).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
}

export function ConversationList({
  conversations, activeId, onSelect,
  currentUserId, onToggleFlag, onTogglePin, onAssignMe, onArchive,
  viewFilter, onViewChange, viewCounts,
  statusFilter, onStatusChange, channelFilter, onChannelFilterChange,
  pipelines, tags, departments, showChannel = false, officialChannel = false, channelReady = true, agents,
  searchValue, onSearchChange,
  pipelineFilter, onPipelineFilterChange,
  agentFilter,    onAgentFilterChange,
  departmentFilter, onDepartmentFilterChange,
  tagFilter,      onTagFilterChange,
  staleOnly,      onStaleOnlyChange,
  fromAd,         onFromAdChange,
  archivedOnly,   onArchivedOnlyChange,
  hasMore, onLoadMore, loadingMore, loadingList,
}: Props) {
  const [showFilters, setShowFilters]       = useState(false)
  const [showNewModal, setShowNewModal]     = useState(false)
  const [menu, setMenu]                     = useState<{ x: number; y: number; conv: ChatConversation } | null>(null)
  const quickViewRefs = useRef<Partial<Record<ConversationView, HTMLButtonElement | null>>>({})
  const quickViewScrollerRef = useRef<HTMLDivElement>(null)
  const quickViewTrackRef = useRef<HTMLDivElement>(null)
  const quickViewDragRef = useRef({ pointerId: -1, startX: 0, startScrollLeft: 0, moved: false })
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false })
  const [isDraggingQuickViews, setIsDraggingQuickViews] = useState(false)

  useEffect(() => {
    if (!viewFilter) return
    quickViewRefs.current[viewFilter]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
  }, [viewFilter])

  useEffect(() => {
    const scroller = quickViewScrollerRef.current
    const track = quickViewTrackRef.current
    if (!scroller || !track) return

    const updateEdges = () => {
      const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth)
      const next = {
        left: scroller.scrollLeft > 2,
        right: scroller.scrollLeft < maxScroll - 2,
      }
      setScrollEdges((current) => current.left === next.left && current.right === next.right ? current : next)
    }

    scroller.addEventListener("scroll", updateEdges, { passive: true })
    const resizeObserver = new ResizeObserver(updateEdges)
    resizeObserver.observe(scroller)
    resizeObserver.observe(track)

    return () => {
      scroller.removeEventListener("scroll", updateEdges)
      resizeObserver.disconnect()
    }
  }, [])

  const shownConversations = useMemo(() => {
    // Na aba Follow-up a ordem é por PRAZO (o mais atrasado primeiro). O servidor
    // já entrega assim, mas as fusões do Realtime reordenam por recado recente —
    // reordenar aqui é o único ponto que vê a lista final.
    if (statusFilter !== "followup") return conversations
    return [...conversations].sort((a, b) => {
      const da = a.follow_up_at ? new Date(a.follow_up_at).getTime() : Infinity
      const db = b.follow_up_at ? new Date(b.follow_up_at).getTime() : Infinity
      return da - db || a.id.localeCompare(b.id)
    })
  }, [conversations, statusFilter])

  const departmentById = useMemo(() => {
    const m: Record<string, DepartmentMini> = {}
    for (const d of departments) m[d.id] = d
    return m
  }, [departments])

  // Lista vem JÁ filtrada/buscada/ordenada do server.
  // Tarefa do client: só renderizar.

  const activeFiltersCount =
    (channelFilter ? 1 : 0) + (pipelineFilter ? 1 : 0) + (tagFilter ? 1 : 0) + (agentFilter ? 1 : 0) + (departmentFilter ? 1 : 0) + (staleOnly ? 1 : 0) + (fromAd ? 1 : 0) + (!viewFilter && statusFilter !== "all" ? 1 : 0) + (archivedOnly ? 1 : 0)

  const statusView = archivedOnly ? "archived" : statusFilter
  const hasAdvancedFilters = activeFiltersCount > 0

  function clearFilters() {
    onPipelineFilterChange("")
    onTagFilterChange("")
    onAgentFilterChange("")
    onDepartmentFilterChange("")
    onChannelFilterChange("")
    onStaleOnlyChange(false)
    onFromAdChange(false)
    onArchivedOnlyChange(false)
    onStatusChange("all")
    onViewChange("all")
  }

  function selectStatus(status: string) {
    onViewChange(null)
    onArchivedOnlyChange(false)
    onStatusChange(status)
  }

  function selectArchived() {
    onViewChange(null)
    onArchivedOnlyChange(true)
    onStatusChange("all")
  }

  function selectStatusView(value: string) {
    if (value === "all" || value === "resolved") {
      selectQuickView(value)
      return
    }
    if (value === "archived") {
      selectArchived()
      return
    }
    selectStatus(value)
  }

  function selectQuickView(view: ConversationView) {
    onStatusChange("all")
    onArchivedOnlyChange(false)
    if (view === "mine") onAgentFilterChange("")
    onViewChange(view)
  }

  function handleQuickViewWheel(event: WheelEvent<HTMLDivElement>) {
    const scroller = quickViewScrollerRef.current
    if (!scroller) return

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth)
    const canScroll = delta > 0 ? scroller.scrollLeft < maxScroll - 2 : scroller.scrollLeft > 2
    if (!canScroll) return

    event.preventDefault()
    scroller.scrollLeft += delta
  }

  function handleQuickViewPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.pointerType === "touch") return
    const scroller = quickViewScrollerRef.current
    if (!scroller) return

    quickViewDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: scroller.scrollLeft,
      moved: false,
    }
  }

  function handleQuickViewPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = quickViewDragRef.current
    if (drag.pointerId !== event.pointerId) return

    const distance = event.clientX - drag.startX
    if (!drag.moved && Math.abs(distance) < 4) return
    if (!drag.moved) {
      drag.moved = true
      event.currentTarget.setPointerCapture(event.pointerId)
      setIsDraggingQuickViews(true)
    }

    event.preventDefault()
    event.currentTarget.scrollLeft = drag.startScrollLeft - distance
  }

  function finishQuickViewDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = quickViewDragRef.current
    if (drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    drag.pointerId = -1
    setIsDraggingQuickViews(false)
    window.setTimeout(() => { quickViewDragRef.current.moved = false }, 0)
  }

  function suppressQuickViewClickAfterDrag(event: MouseEvent<HTMLDivElement>) {
    if (!quickViewDragRef.current.moved) return
    event.preventDefault()
    event.stopPropagation()
    quickViewDragRef.current.moved = false
  }

  function handleQuickViewKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null
    if (event.key === "ArrowRight") nextIndex = Math.min(index + 1, QUICK_VIEWS.length - 1)
    if (event.key === "ArrowLeft") nextIndex = Math.max(index - 1, 0)
    if (event.key === "Home") nextIndex = 0
    if (event.key === "End") nextIndex = QUICK_VIEWS.length - 1
    if (nextIndex === null || nextIndex === index) return

    event.preventDefault()
    const nextView = QUICK_VIEWS[nextIndex]
    quickViewRefs.current[nextView.key]?.focus()
    selectQuickView(nextView.key)
  }

  // IntersectionObserver no rodapé pra disparar loadMore
  const loadMoreRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = loadMoreRef.current
    if (!el || !hasMore) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore()
      },
      { rootMargin: "200px" },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasMore, onLoadMore, loadingMore])

  return (
    <div className="flex flex-col h-full border-r border-slate-200 bg-white">

      <div className="relative px-3 pt-3 pb-2.5 border-b border-slate-200 bg-white shrink-0">
        <div className="flex h-8 items-center gap-2">
          <h2 className="text-sm font-bold tracking-tight text-slate-900">Inbox</h2>
          <button
            type="button"
            title={channelReady ? "Nova conversa" : "Conecte um canal de WhatsApp primeiro"}
            onClick={() => { if (channelReady) setShowNewModal(true) }}
            disabled={!channelReady}
            aria-label="Nova conversa"
            className={`ml-auto flex size-8 items-center justify-center rounded-lg border transition-colors ${
              channelReady
                ? "border-slate-200 bg-white text-slate-600 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-600"
                : "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300"
            }`}
          >
            <MessageSquarePlus className="size-4" />
          </button>
        </div>

        <div className="relative -mx-3 mt-1.5">
          <div
            ref={quickViewScrollerRef}
            onWheel={handleQuickViewWheel}
            onPointerDown={handleQuickViewPointerDown}
            onPointerMove={handleQuickViewPointerMove}
            onPointerUp={finishQuickViewDrag}
            onPointerCancel={finishQuickViewDrag}
            onClickCapture={suppressQuickViewClickAfterDrag}
            onDragStart={(event) => event.preventDefault()}
            className={`overflow-x-auto overscroll-x-contain border-b border-slate-200 px-3 select-none touch-pan-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
              isDraggingQuickViews ? "cursor-grabbing" : "cursor-grab"
            }`}
            role="tablist"
            aria-label="Visões do inbox"
          >
            <div ref={quickViewTrackRef} className="flex min-w-max items-end gap-4">
              {QUICK_VIEWS.map((view, index) => {
                const active = viewFilter === view.key
                const count = viewCounts[view.key]
                return (
                  <button
                    key={view.key}
                    type="button"
                    role="tab"
                    ref={(element) => { quickViewRefs.current[view.key] = element }}
                    aria-selected={active}
                    tabIndex={active || (!viewFilter && index === 0) ? 0 : -1}
                    onClick={() => selectQuickView(view.key)}
                    onKeyDown={(event) => handleQuickViewKeyDown(event, index)}
                    className={`-mb-px flex shrink-0 items-baseline gap-1 border-b-2 pb-2 pt-1 text-[11px] font-semibold transition-colors ${
                      active
                        ? "border-primary text-slate-900"
                        : "border-transparent text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    <span>{view.label}</span>
                    <span className={`text-[10px] tabular-nums ${active ? "text-primary-600" : "text-slate-400"}`}>
                      {count.toLocaleString("pt-BR")}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          {scrollEdges.left && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-10 bg-gradient-to-r from-white via-white/95 to-transparent"
            />
          )}
          {scrollEdges.right && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 z-[1] w-10 bg-gradient-to-l from-white via-white/95 to-transparent"
            />
          )}
        </div>

        <div className="mt-2 flex min-w-0 items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Pesquisar por nome ou telefone</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Pesquisar por nome ou telefone"
              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-primary-200 focus:bg-white focus:ring-2 focus:ring-primary/15"
            />
          </label>
          <button
            type="button"
            aria-expanded={showFilters}
            aria-haspopup="dialog"
            onClick={() => setShowFilters((v) => !v)}
            className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors ${
              showFilters || hasAdvancedFilters
                ? "border-primary-200 bg-primary-50 text-primary-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <Filter className="size-3.5" />
            Filtros
            {activeFiltersCount > 0 && (
              <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-white">
                {activeFiltersCount}
              </span>
            )}
          </button>
        </div>

        {showFilters && (
          <>
            <button
              type="button"
              aria-label="Fechar filtros"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setShowFilters(false)}
            />
            <div
              role="dialog"
              aria-label="Filtros avançados"
              className="absolute left-3 right-3 top-full z-50 mt-1 max-h-[min(430px,70vh)] space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-soft"
            >
              <div className="flex items-center justify-between gap-3 pb-1">
                <div>
                  <p className="text-xs font-bold text-slate-900">Filtros avançados</p>
                  <p className="text-[10px] text-slate-500">Refine as conversas exibidas</p>
                </div>
                <button
                  type="button"
                  aria-label="Fechar filtros"
                  onClick={() => setShowFilters(false)}
                  className="flex size-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Situação</p>
                <SimpleSelect
                  value={statusView}
                  onChange={selectStatusView}
                  className="h-8 rounded-lg pl-2.5 pr-2 text-[11px]"
                  options={[
                    ...STATUS_TABS.map((tab) => ({ value: tab.key, label: tab.label })),
                    { value: "archived", label: "Arquivadas" },
                  ]}
                />
              </div>
              <SimpleSelect
                value={channelFilter}
                onChange={(value) => onChannelFilterChange(value as ChannelFilter)}
                className="h-8 rounded-lg pl-2.5 pr-2 text-[11px]"
                options={CHANNEL_OPTIONS}
              />
              {pipelines.length > 0 && (
                <SimpleSelect value={pipelineFilter} onChange={onPipelineFilterChange} className="h-8 rounded-lg pl-2.5 pr-2 text-[11px]"
                  options={[{ value: "", label: "Todos os funis" }, ...pipelines.map((p) => ({ value: p.id, label: p.name }))]} />
              )}
              {tags.length > 0 && (
                <SimpleSelect value={tagFilter} onChange={onTagFilterChange} className="h-8 rounded-lg pl-2.5 pr-2 text-[11px]"
                  options={[{ value: "", label: "Todas as tags" }, ...tags.map((t) => ({ value: t.id, label: t.name }))]} />
              )}
              <SimpleSelect value={agentFilter} onChange={onAgentFilterChange} className="h-8 rounded-lg pl-2.5 pr-2 text-[11px]"
                options={[{ value: "", label: "Todos os agentes" }, ...agents.map((a) => ({ value: a.id, label: a.full_name ?? "—" }))]} />
              {departments.length > 0 && (
                <SimpleSelect value={departmentFilter} onChange={onDepartmentFilterChange} className="h-8 rounded-lg pl-2.5 pr-2 text-[11px]"
                  options={[{ value: "", label: "Todos os departamentos" }, ...departments.map((d) => ({ value: d.id, label: d.name }))]} />
              )}
              <div className="space-y-2 border-t border-slate-100 pt-2">
                <Switch
                  size="sm"
                  checked={staleOnly}
                  onChange={onStaleOnlyChange}
                  label={`Apenas sem resposta há +${STALE_HOURS_THRESHOLD}h`}
                />
                <Switch
                  size="sm"
                  checked={fromAd}
                  onChange={onFromAdChange}
                  label="Apenas vieram de anúncio Meta"
                />
              </div>
              {hasAdvancedFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="flex h-8 w-full items-center justify-center gap-1 rounded-lg text-[10px] font-semibold text-slate-500 hover:bg-red-50 hover:text-red-600"
                >
                  <X className="size-3" /> Limpar filtros
                </button>
              )}
            </div>
          </>
        )}

      </div>

      <div className="flex-1 overflow-y-auto">
        {loadingList ? (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <Loader2 className="size-5 text-slate-300 animate-spin mb-3" />
            <p className="text-xs text-slate-400 text-center">Carregando conversas…</p>
          </div>
        ) : shownConversations.length === 0 ? (
          <EmptyState
            icon={MessageCircle}
            bordered={false}
            className="rounded-none py-12"
            title={viewFilter === "waiting" ? "Fila em dia" : "Nenhuma conversa encontrada"}
            description={
              viewFilter === "waiting"
                ? "Não há ninguém aguardando atendimento agora."
                : channelFilter
                  ? "Não há conversas neste canal com os filtros atuais."
                  : searchValue || hasAdvancedFilters
                    ? "Tente ajustar a busca ou limpar os filtros."
                    : "Ainda não há conversas nesta visão."
            }
            action={viewFilter === "waiting" ? (
              <button type="button" onClick={() => selectQuickView("all")} className="text-xs font-semibold text-primary-600 hover:underline">
                Ver todas as conversas
              </button>
            ) : undefined}
          />
        ) : (
          <>
            {shownConversations.map((conv) => {
            const contact    = conv.chat_contacts
            const name       = contact ? displayContactName(contact) : formatPhoneDisplay("")
            const initial    = contact ? displayContactInitial(contact) : "?"
            const isActive   = conv.id === activeId
            // Bolinha azul = "não aberta por nenhum agente" (não lida) OU marcada como pendente.
            // Abrir a conversa zera (markConversationRead limpa unread_count + flagged_pending).
            const hasUnread  = conv.unread_count > 0 || conv.flagged_pending
            const assignedTo = conv.profiles?.full_name
            const dept       = conv.department_id ? departmentById[conv.department_id] : null
            // "Sem resposta há +24h" é sinal de SLA separado: só quando o contato falou por último.
            const isStale     = conv.last_message_dir === "in" && !!conv.last_message_at && hoursSince(conv.last_message_at) >= STALE_HOURS_THRESHOLD && conv.status !== "resolved"
            const isPinned    = !!conv.pinned_at
            const statusMeta  = STATUS_ICON[conv.status] ?? null
            const timeLabel   = conv.last_message_at ? formatTimeAgo(conv.last_message_at) : ""
            const mediaIcon   = inferMediaIcon(conv.last_message_preview)
            const dirArrow    = !conv.last_message_preview
              ? null
              : conv.last_message_dir === "out_phone"
                ? <Smartphone     className="size-3.5 text-emerald-500 shrink-0" />
                : conv.last_message_dir === "out"
                  ? <ArrowUpRight  className="size-3.5 text-emerald-500 shrink-0" />
                  : <ArrowDownLeft className="size-3.5 text-sky-400 shrink-0" />
            const isSiteLead  = conv.channel === "site"
            const awaitingFirst = isSiteLead && /^(voltou|novo lead|lead via)/i.test(conv.last_message_preview ?? "")
            // Fila do setor: sem atendente E com departamento (roteado pela IA OU
            // transferido manualmente). Mostra explícito "Aguardando atendimento · <Setor>".
            const aiRouted    = (conv.metadata as { ai_routed?: { department_name?: string } } | null | undefined)?.ai_routed
            const queueDept   = aiRouted?.department_name ?? (conv.department_id ? departmentById[conv.department_id]?.name : null) ?? null
            const isWaiting   = !assignedTo && (!!aiRouted || !!conv.department_id)

            // Badge = canal do FIO (conversa), com fallback pra origem do contato.
            // Pós-merge o contato tem fios de canais distintos: cada um mostra o SEU ícone.
            const rowSource  = channelToSource(conv.channel) ?? contact?.source ?? null
            const showSource = !!rowSource
            // A promessa de retorno. Mesma conta do servidor (followup-rules) — por isso
            // o chip apaga no INSTANTE em que o cliente responde, sem esperar a varredura.
            // Cumprido NÃO entra na lista do inbox: aqui é fila de trabalho, e o
            // histórico tem casa própria (Tarefas e o dia dele na Agenda).
            const chip       = followUpChip(conv)
            const followUp   = chip && chip.tone !== "done" ? chip : null

            return (
              <button
                key={conv.id}
                type="button"
                onClick={() => onSelect(conv.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  const x = Math.min(e.clientX, window.innerWidth - 224)
                  const y = Math.min(e.clientY, window.innerHeight - 210)
                  setMenu({ x, y, conv })
                }}
                className={`relative w-full flex items-start gap-3.5 px-4 py-3.5 text-left transition-colors border-b border-slate-100 ${
                  isActive
                    ? "bg-gradient-to-r from-primary-100 via-primary-50/40 to-transparent"
                    : isWaiting
                      ? "bg-amber-50/40 hover:bg-amber-50/70"
                      : "hover:bg-slate-50"
                }`}
              >
                {/* Rail esquerdo: azul = conversa aberta · âmbar = aguardando atendimento
                    (detectável no scan periférico, antes de ler qualquer texto) */}
                {isActive ? (
                  <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-primary" />
                ) : isWaiting ? (
                  <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-amber-400" />
                ) : null}
                <div className="relative shrink-0">
                  <div className="size-11 rounded-full flex items-center justify-center overflow-hidden bg-gradient-to-br from-white to-slate-200 text-slate-400 ring-1 ring-inset ring-slate-200/70">
                    <ContactPic pic={contact?.profile_pic_url} initial={initial} imgClass="size-11 object-cover" fallbackClass="text-base font-bold" />
                  </div>
                  {showSource && (
                    <span className="absolute -bottom-1 -right-1 inline-flex items-center justify-center">
                      <SourceLogo source={rowSource} size={17} />
                    </span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex items-center gap-1.5 min-w-0 flex-1">
                      {isPinned && (
                        <Pin className="size-3 text-amber-500 shrink-0 -rotate-45" aria-label="Fixada" />
                      )}
                      <span className={`text-sm truncate ${hasUnread ? "font-bold text-slate-900" : "font-medium text-slate-700"}`}>
                        {name}
                      </span>
                      {awaitingFirst && (
                        <span
                          className="size-1.5 rounded-full bg-amber-500 shrink-0 animate-pulse"
                          title="Aguardando 1ª resposta"
                        />
                      )}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {dirArrow}
                    {mediaIcon}
                    <p className={`text-xs truncate flex-1 ${hasUnread ? "font-medium text-slate-700" : "text-slate-500"}`}>
                      {conv.last_message_preview ?? "Nova conversa"}
                    </p>
                  </div>

                  {isWaiting && (
                    <div className="mt-1.5">
                      {/* nowrap + truncate: a pill nunca quebra em 2 linhas. Com setor, o rótulo
                          encurta ("Aguardando · Comercial") — o SETOR é a informação, não o boilerplate. */}
                      <span className="inline-flex items-center gap-1 max-w-full whitespace-nowrap text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                        <span className="size-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                        <span className="truncate min-w-0">
                          {queueDept
                            ? <>Aguardando <span className="text-amber-600 font-medium">· {queueDept}</span></>
                            : "Aguardando atendimento"}
                        </span>
                      </span>
                    </div>
                  )}

                  {followUp && (
                    <div className="mt-1.5">
                      <span
                        title={followUp.title}
                        className={`inline-flex items-center gap-1 max-w-full whitespace-nowrap text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                          followUp.tone === "due"
                            ? "text-red-700 bg-red-50 border-red-100"
                            : followUp.tone === "answered"
                              ? "text-slate-500 bg-slate-50 border-slate-200"
                              : "text-primary-700 bg-primary-50 border-primary-200"
                        }`}
                      >
                        <AlarmClock className="size-2.5 shrink-0" />
                        <span className="truncate min-w-0">{followUp.label}</span>
                      </span>
                    </div>
                  )}

                  {dept && (
                    <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-slate-400 truncate">
                      <span className="inline-flex items-center gap-1 shrink-0 min-w-0" title={`Departamento: ${dept.name}`}>
                        <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: dept.color }} />
                        <span className="truncate" style={{ color: dept.color }}>{dept.name}</span>
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-end justify-between self-stretch shrink-0 gap-1.5 ml-1.5 min-h-[44px]">
                  <span className="inline-flex items-center gap-1.5 shrink-0">
                    {statusMeta && (
                      <statusMeta.Icon className={`size-3.5 ${statusMeta.className}`} aria-label={statusMeta.label} />
                    )}
                    {isStale && (
                      <AlertCircle className="size-3 text-red-500" />
                    )}
                    <span className={`text-[11px] ${isStale ? "text-red-500 font-semibold" : "text-slate-400"}`}>
                      {timeLabel}
                    </span>
                    {hasUnread && (
                      <span
                        className="size-2 rounded-full bg-primary-600 shrink-0 animate-pulse"
                        title={conv.unread_count > 0 ? `${conv.unread_count} não lida${conv.unread_count > 1 ? "s" : ""}` : "Marcada como pendente"}
                      />
                    )}
                  </span>

                  {/* ⚠️ O selo identifica o NÚMERO, não o canal. Conversa sem número
                      (Instagram, site) não tem o que mostrar aqui — e sem o guarda o
                      fallback estampava "QR" + ícone de celular numa conversa de
                      Instagram, dizendo ao atendente uma coisa que não é verdade. */}
                  {showChannel && conv.instance_id && (
                    <ChannelBadge provider={conv.whatsapp_instances?.provider ?? null} name={conv.whatsapp_instances?.display_name} />
                  )}

                  {assignedTo && (
                    <div title={`Atribuído a ${assignedTo}`} className="mt-auto pt-0.5">
                      <AgentAvatar userId={conv.assigned_to} name={assignedTo} className="size-5" />
                    </div>
                  )}
                </div>
              </button>
            )
          })}

          {/* Sentinela do scroll infinito */}
          {hasMore && (
            <div ref={loadMoreRef} className="flex items-center justify-center py-4">
              {loadingMore ? (
                <Loader2 className="size-4 text-slate-300 animate-spin" />
              ) : (
                <span className="text-[10px] text-slate-300">Carregando mais…</span>
              )}
            </div>
          )}
          </>
        )}
      </div>

      {menu && (() => {
        const c        = menu.conv
        const mPinned  = !!c.pinned_at
        const mFlagged = c.flagged_pending
        const mIsMine  = c.assigned_to === currentUserId
        const item     = "w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50 transition-colors"
        return (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setMenu(null) }}
            />
            <div
              className="fixed z-50 w-56 bg-white rounded-lg shadow-soft border border-slate-200 py-1"
              style={{ top: menu.y, left: menu.x }}
            >
              <button type="button" className={item} onClick={() => { onToggleFlag(c.id, !mFlagged); setMenu(null) }}>
                {mFlagged ? <FlagOff className="size-4 text-slate-400 shrink-0" /> : <Flag className="size-4 text-primary-600 shrink-0" />}
                {mFlagged ? "Remover pendente" : "Marcar como pendente"}
              </button>
              <button type="button" className={item} onClick={() => { onTogglePin(c.id, !mPinned); setMenu(null) }}>
                {mPinned ? <PinOff className="size-4 text-slate-400 shrink-0" /> : <Pin className="size-4 text-amber-500 shrink-0" />}
                {mPinned ? "Desafixar do topo" : "Fixar no topo"}
              </button>
              <button
                type="button"
                disabled={mIsMine}
                className={`${item} disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent`}
                onClick={() => { onAssignMe(c.id); setMenu(null) }}
              >
                <UserPlus className="size-4 text-slate-500 shrink-0" />
                {mIsMine ? "Atribuída a você" : "Atribuir a mim"}
              </button>
              <div className="my-1 border-t border-slate-100" />
              <button type="button" className={`${item} !text-red-600`} onClick={() => { onArchive(c.id); setMenu(null) }}>
                {archivedOnly ? <ArchiveRestore className="size-4 shrink-0" /> : <Archive className="size-4 shrink-0" />}
                {archivedOnly ? "Desarquivar" : "Arquivar"}
              </button>
            </div>
          </>
        )
      })()}

      <NewConversationModal open={showNewModal} onClose={() => setShowNewModal(false)} officialChannel={officialChannel} />
    </div>
  )
}
