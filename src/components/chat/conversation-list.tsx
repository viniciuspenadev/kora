"use client"

import { ContactPic } from "@/components/chat/contact-pic"

import { useState, useMemo, useRef, useEffect } from "react"
import {
  Search, MessageCircle, AlertCircle, Loader2, Filter, CheckCircle2, Clock, Moon,
  Image as ImageIcon, Mic, Video, FileText, X, Plus, Users, ChevronDown,
  ArrowUpRight, ArrowDownLeft, Smartphone, BadgeCheck,
  Pin, PinOff, Flag, FlagOff, UserPlus, Archive, ArchiveRestore,
} from "lucide-react"
import { formatPhoneDisplay } from "@/lib/phone-utils"
import { NewConversationModal } from "./new-conversation-modal"
import { displayContactName, displayContactInitial } from "@/lib/contact"
import { SourceLogo, channelToSource } from "@/components/chat/source-logo"
import { AgentAvatar } from "@/components/chat/agent-avatar"
import { Switch } from "@/components/ui/switch"
import { SimpleSelect } from "@/components/ui/select"
import type { ChatConversation } from "@/types/chat"

interface PipelineMini { id: string; name: string; color: string; is_default: boolean }
interface StageMini    { id: string; pipeline_id: string; name: string; color: string; position: number; is_won: boolean; is_lost: boolean }
interface TagMini        { id: string; name: string; color: string }
interface DepartmentMini { id: string; name: string; color: string }
interface AgentMini      { id: string; full_name: string | null }

interface Props {
  conversations:   ChatConversation[]
  activeId:        string | null
  onSelect:        (id: string) => void
  currentUserId:   string
  onToggleFlag:    (id: string, value: boolean) => void
  onTogglePin:     (id: string, value: boolean) => void
  onAssignMe:      (id: string) => void
  onArchive:       (id: string) => void
  statusFilter:    string
  onStatusChange:  (status: string) => void
  pipelines:       PipelineMini[]
  stages:          StageMini[]
  tags:            TagMini[]
  departments:     DepartmentMini[]
  tagsByContact:   Record<string, string[]>
  showChannel?:    boolean         // mostra badge de canal (Baileys/Oficial) — só com 2+ instâncias
  officialChannel?: boolean        // canal default é oficial → nova conversa exige template
  channelReady?:   boolean         // false = nenhum canal conectado → "nova conversa" desabilitada
  agents:          AgentMini[]
  unreadTotal:     number          // Total de não-lidas (tenant inteiro, não só carregadas)

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
  { key: "all",      label: "Todos" },        // todos os status — exceto arquivadas (essas têm o seu próprio item)
  { key: "open",     label: "Abertos" },
  { key: "pending",  label: "Pendentes" },
  { key: "snoozed",  label: "Adiados" },
  { key: "resolved", label: "Resolvidos" },
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
  statusFilter, onStatusChange,
  pipelines, tags, departments, showChannel = false, officialChannel = false, channelReady = true, agents,
  unreadTotal,
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
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [showNewModal, setShowNewModal]     = useState(false)
  const [menu, setMenu]                     = useState<{ x: number; y: number; conv: ChatConversation } | null>(null)

  const departmentById = useMemo(() => {
    const m: Record<string, DepartmentMini> = {}
    for (const d of departments) m[d.id] = d
    return m
  }, [departments])

  // Lista vem JÁ filtrada/buscada/ordenada do server.
  // Tarefa do client: só renderizar.

  const activeFiltersCount =
    (pipelineFilter ? 1 : 0) + (tagFilter ? 1 : 0) + (agentFilter ? 1 : 0) + (departmentFilter ? 1 : 0) + (staleOnly ? 1 : 0) + (fromAd ? 1 : 0)

  function clearFilters() {
    onPipelineFilterChange("")
    onTagFilterChange("")
    onAgentFilterChange("")
    onDepartmentFilterChange("")
    onStaleOnlyChange(false)
    onFromAdChange(false)
    // archivedOnly NÃO entra aqui — é uma visão de status (seletor), não filtro secundário.
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

      <div className="px-4 pt-4 pb-2 border-b border-slate-100 shrink-0">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-bold text-slate-900">Inbox</h2>
          {unreadTotal > 0 && (
            <span className="text-[10px] font-bold bg-emerald-500 text-white px-1.5 py-0.5 rounded-full min-w-[18px] text-center tabular-nums">
              {unreadTotal > 99 ? "99+" : unreadTotal}
            </span>
          )}
          <button
            type="button"
            title={channelReady ? "Nova conversa" : "Conecte um canal de WhatsApp primeiro"}
            onClick={() => { if (channelReady) setShowNewModal(true) }}
            disabled={!channelReady}
            className={`ml-auto size-7 rounded-lg flex items-center justify-center transition-colors ${
              channelReady ? "bg-primary-50 hover:bg-primary-100 text-primary-600" : "bg-slate-100 text-slate-300 cursor-not-allowed"
            }`}
          >
            <Plus className="size-3.5" />
          </button>
        </div>

        <div className="flex gap-1.5 mb-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
            <input
              type="text"
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 placeholder:text-slate-400"
            />
          </div>

          {/* Status dropdown */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowStatusMenu((v) => !v)}
              className={`h-9 inline-flex items-center gap-1.5 px-2.5 rounded-lg border text-[11px] font-semibold transition-colors ${
                showStatusMenu
                  ? "bg-primary-50 border-primary-200 text-primary-700"
                  : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              {archivedOnly ? "Arquivadas" : (STATUS_TABS.find((t) => t.key === statusFilter)?.label ?? statusFilter)}
              <ChevronDown className={`size-3 text-slate-400 transition-transform ${showStatusMenu ? "rotate-180" : ""}`} />
            </button>

            {showStatusMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowStatusMenu(false)} />
                <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg shadow-soft border border-slate-200 z-50 overflow-hidden">
                  {STATUS_TABS.map((tab) => {
                    const active = !archivedOnly && statusFilter === tab.key
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => { onArchivedOnlyChange(false); onStatusChange(tab.key); setShowStatusMenu(false) }}
                        className={`w-full flex items-center justify-between px-3 py-2 text-[11px] font-medium ${
                          active ? "bg-primary-50 text-primary-700" : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <span>{tab.label}</span>
                      </button>
                    )
                  })}
                  <div className="border-t border-slate-100" />
                  <button
                    type="button"
                    onClick={() => { onArchivedOnlyChange(true); onStatusChange("all"); setShowStatusMenu(false) }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-[11px] font-medium ${
                      archivedOnly ? "bg-primary-50 text-primary-700" : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <Archive className="size-3.5 shrink-0" />
                    <span>Arquivadas</span>
                  </button>
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={`relative shrink-0 size-9 rounded-lg flex items-center justify-center transition-colors ${
              showFilters || activeFiltersCount > 0
                ? "bg-primary-50 text-primary-600 border border-primary-200"
                : "bg-white border border-slate-200 text-slate-400 hover:bg-slate-50"
            }`}
            title="Filtros"
          >
            <Filter className="size-3.5" />
            {activeFiltersCount > 0 && (
              <span className="absolute -top-1 -right-1 size-4 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center">
                {activeFiltersCount}
              </span>
            )}
          </button>
        </div>

        {showFilters && (
          <div className="space-y-1.5 mb-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50/50">
            {pipelines.length > 0 && (
              <SimpleSelect value={pipelineFilter} onChange={onPipelineFilterChange} className="h-7 text-[11px] pl-2 pr-1.5 rounded"
                options={[{ value: "", label: "Todos os funis" }, ...pipelines.map((p) => ({ value: p.id, label: p.name }))]} />
            )}
            {tags.length > 0 && (
              <SimpleSelect value={tagFilter} onChange={onTagFilterChange} className="h-7 text-[11px] pl-2 pr-1.5 rounded"
                options={[{ value: "", label: "Todas as tags" }, ...tags.map((t) => ({ value: t.id, label: t.name }))]} />
            )}
            <SimpleSelect value={agentFilter} onChange={onAgentFilterChange} className="h-7 text-[11px] pl-2 pr-1.5 rounded"
              options={[{ value: "", label: "Todos os agentes" }, ...agents.map((a) => ({ value: a.id, label: a.full_name ?? "—" }))]} />
            {departments.length > 0 && (
              <SimpleSelect value={departmentFilter} onChange={onDepartmentFilterChange} className="h-7 text-[11px] pl-2 pr-1.5 rounded"
                options={[{ value: "", label: "Todos os departamentos" }, ...departments.map((d) => ({ value: d.id, label: d.name }))]} />
            )}
            <div className="pt-1">
              <Switch
                size="sm"
                checked={staleOnly}
                onChange={onStaleOnlyChange}
                label={`Apenas sem resposta há +${STALE_HOURS_THRESHOLD}h`}
              />
            </div>
            <div className="pt-1">
              <Switch
                size="sm"
                checked={fromAd}
                onChange={onFromAdChange}
                label="Apenas vieram de anúncio Meta"
              />
            </div>
            {activeFiltersCount > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="w-full h-6 text-[10px] font-semibold text-slate-500 hover:text-red-500 flex items-center justify-center gap-1"
              >
                <X className="size-2.5" /> Limpar filtros
              </button>
            )}
          </div>
        )}

      </div>

      <div className="flex-1 overflow-y-auto">
        {loadingList && conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <Loader2 className="size-5 text-slate-300 animate-spin mb-3" />
            <p className="text-xs text-slate-400 text-center">Carregando conversas…</p>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <MessageCircle className="size-8 text-slate-200 mb-3" />
            <p className="text-xs text-slate-400 text-center">
              {searchValue || activeFiltersCount > 0 ? "Nenhuma conversa encontrada" : "Nenhuma conversa neste filtro"}
            </p>
          </div>
        ) : (
          <>
            {conversations.map((conv) => {
            const isGroup    = conv.is_group
            const contact    = conv.chat_contacts
            const name       = isGroup
              ? (conv.group_name ?? "Grupo sem nome")
              : contact
                ? displayContactName(contact)
                : formatPhoneDisplay("")
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
            const showSource = !!rowSource && !isGroup

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
                    : "hover:bg-slate-50"
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-primary" />
                )}
                <div className="relative shrink-0">
                  <div className={`size-11 rounded-full flex items-center justify-center overflow-hidden ${
                    isGroup
                      ? "bg-amber-100 text-amber-700"
                      : "bg-gradient-to-br from-white to-slate-200 text-slate-400 ring-1 ring-inset ring-slate-200/70"
                  }`}>
                    {isGroup ? (
                      conv.group_picture ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={conv.group_picture} alt="" className="size-11 object-cover" />
                      ) : (
                        <Users className="size-5" />
                      )
                    ) : (
                      <ContactPic pic={contact?.profile_pic_url} initial={initial} imgClass="size-11 object-cover" fallbackClass="text-base font-bold" />
                    )}
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
                  </div>

                  <div className="flex items-center gap-1.5">
                    {dirArrow}
                    {mediaIcon}
                    <p className={`text-xs truncate flex-1 ${hasUnread ? "font-medium text-slate-700" : "text-slate-500"}`}>
                      {conv.last_message_preview ?? "Nova conversa"}
                    </p>
                    {showChannel && <ChannelBadge provider={conv.whatsapp_instances?.provider ?? null} name={conv.whatsapp_instances?.display_name} />}
                  </div>

                  {isWaiting && (
                    <div className="mt-1.5">
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                        <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Aguardando atendimento
                        {queueDept && (
                          <span className="text-amber-600 font-medium">· {queueDept}</span>
                        )}
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

                {assignedTo && (
                  <span className="absolute bottom-3 right-3" title={`Atribuído a ${assignedTo}`}>
                    <AgentAvatar userId={conv.assigned_to} name={assignedTo} className="size-5" />
                  </span>
                )}
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
