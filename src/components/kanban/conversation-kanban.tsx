"use client"

import { useState, useEffect, useMemo, useCallback, useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  GripVertical, Clock, AlertCircle, Trophy, XCircle,
  Phone, DollarSign, Calendar, Loader2,
  ArrowUpRight, ArrowDownLeft, Smartphone, BadgeCheck,
} from "lucide-react"
import { moveConversation, getManagementCards } from "@/lib/actions/pipeline"
import { getRealtimeClient } from "@/lib/realtime"
import { lifecycleMeta } from "@/lib/lifecycle"
import { displayContactName, displayContactInitial } from "@/lib/contact"
import { SourceLogo } from "@/components/chat/source-logo"

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
  estimated_value:      number | null
  expected_close_date:  string | null
  lost_reason:          string | null
  won_at:               string | null
  lost_at:              string | null
  assigned_to:          string | null
  department_id:        string | null
  chat_contacts:        ChatContact | null
  profiles:             { full_name: string | null; email: string } | null
  whatsapp_instances:   { provider: string | null } | null
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
  agents?:       AgentMini[]
  departments?:  DeptMini[]
  tenantId:      string
  supabaseToken: string
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
    won_at:               row.won_at,
    lost_at:              row.lost_at,
    estimated_value:      row.estimated_value,
    expected_close_date:  row.expected_close_date,
    lost_reason:          row.lost_reason,
  }
}

const BRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

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

export function ConversationKanban({ stages, conversations: initial, tintColumns, showChannel = false, groupBy, agents = [], departments = [], tenantId, supabaseToken }: Props) {
  const router = useRouter()
  const [convs, setConvs] = useState(initial)
  const [draggingId, setDraggingId]   = useState<string | null>(null)
  const [dragOverStage, setDragOver]  = useState<string | null>(null)
  const [pending, startTransition]    = useTransition()

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
          const has = prev.some((c) => c.id === row.id)

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
        groupBy === "stage" ? dataset.filter((c) => c.stage_id === key)
      : groupBy === "agent" ? dataset.filter((c) => (c.assigned_to ?? "__pool__") === key)
      :                       dataset.filter((c) => (c.department_id ?? "__none__") === key)
    return list.sort((a, b) => {
      const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
      const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
      if (at !== bt) return bt - at
      return (a.card_position ?? 0) - (b.card_position ?? 0)
    })
  }

  function handleDragStart(e: React.DragEvent, id: string) {
    setDraggingId(id)
    e.dataTransfer.effectAllowed = "move"
    // Ghost custom: clone do card inclinado + sombra (parece "solto da mesa").
    // Largura via getBoundingClientRect → casa com o tamanho VISUAL (respeita zoom).
    const card = e.currentTarget as HTMLElement
    const rect = card.getBoundingClientRect()
    const ghost = card.cloneNode(true) as HTMLElement
    ghost.style.cssText =
      `position:fixed; top:-9999px; left:-9999px; margin:0; pointer-events:none; ` +
      `width:${rect.width}px; transform:rotate(3deg); box-shadow:0 18px 40px rgba(15,23,42,.28); opacity:1;`
    document.body.appendChild(ghost)
    try {
      e.dataTransfer.setDragImage(ghost, e.clientX - rect.left, e.clientY - rect.top)
    } catch { /* setDragImage não suportado — usa o ghost nativo */ }
    setTimeout(() => ghost.remove(), 0)
  }
  function handleDragEnd() { setDraggingId(null); setDragOver(null) }
  function handleDragOver(e: React.DragEvent, key: string) { e.preventDefault(); setDragOver(key) }
  function handleDrop(e: React.DragEvent, stageId: string) {
    e.preventDefault()
    if (!draggingId) return
    const c = convs.find((x) => x.id === draggingId)
    if (!c || c.stage_id === stageId) { setDraggingId(null); setDragOver(null); return }
    const newPos = cardsFor(stageId).length
    setConvs((prev) => prev.map((x) => x.id === draggingId ? { ...x, stage_id: stageId, card_position: newPos } : x))
    setDraggingId(null); setDragOver(null)
    startTransition(async () => {
      try { await moveConversation(c.id, stageId, newPos) }
      catch (err) { setConvs(initial); alert((err as Error).message ?? "Erro ao mover") }
    })
  }

  return (
    <div className="h-full">
      {loadingMgmt ? (
        <div className="flex items-center justify-center gap-2 h-full text-sm text-slate-400">
          <Loader2 className="size-4 animate-spin" /> Carregando panorama…
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 h-full">
          {columns.map((col) => {
            const list      = cardsFor(col.key)
            const isOver    = !readOnly && dragOverStage === col.key
            const StageIcon = col.stage?.is_won ? Trophy : col.stage?.is_lost ? XCircle : null
            const total     = list.reduce((s, c) => s + Number(c.estimated_value ?? 0), 0)
            const tinted    = tintColumns && !!col.color
            return (
              <div
                key={col.key}
                style={{
                  borderTop: `3px solid ${col.color ?? "#cbd5e1"}`,
                  backgroundColor: isOver || !tinted ? undefined : `color-mix(in srgb, ${col.color} 12%, transparent)`,
                }}
                className={`shrink-0 w-80 flex flex-col rounded-xl overflow-hidden transition-all duration-150 ${
                  isOver ? "bg-primary-50 ring-2 ring-inset ring-primary-300" : tinted ? "" : "bg-slate-100/60"
                }`}
                onDragOver={readOnly ? undefined : (e) => handleDragOver(e, col.key)}
                onDrop={readOnly ? undefined : (e) => handleDrop(e, col.key)}
                onDragLeave={readOnly ? undefined : () => setDragOver(null)}
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
                  {list.map((conv) => (
                    <ConversationCard
                      key={conv.id}
                      conv={conv}
                      showChannel={showChannel}
                      readOnly={readOnly}
                      isDragging={draggingId === conv.id}
                      onDragStart={(e) => handleDragStart(e, conv.id)}
                      onDragEnd={handleDragEnd}
                    />
                  ))}
                  {!readOnly && isOver && draggingId && (
                    <div className="rounded-lg border-2 border-dashed border-primary-300 bg-primary-50/60 h-14 flex items-center justify-center text-[11px] font-semibold text-primary-600 shrink-0">
                      Soltar aqui
                    </div>
                  )}
                  {list.length === 0 && !(isOver && draggingId) && (
                    <p className="text-[11px] text-slate-400 italic text-center py-6">{readOnly ? "—" : "Solte conversas aqui"}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {pending && (
        <div className="fixed top-20 right-4 bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-lg flex items-center gap-2 text-xs text-slate-600 z-50">
          <Loader2 className="size-3.5 animate-spin text-primary-600" />
          Salvando...
        </div>
      )}
    </div>
  )
}

function ConversationCard({
  conv, showChannel, isDragging, onDragStart, onDragEnd, readOnly = false,
}: {
  conv:        Conversation
  showChannel: boolean
  isDragging:  boolean
  onDragStart: (e: React.DragEvent) => void
  onDragEnd:   () => void
  readOnly?:   boolean
}) {
  const contact      = conv.chat_contacts
  const displayName  = contact ? displayContactName(contact) : "Sem nome"
  const initial      = contact ? displayContactInitial(contact) : "?"

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

  return (
    <Link
      href={`/inbox?conversation=${conv.id}`}
      draggable={!readOnly}
      onDragStart={readOnly ? undefined : onDragStart}
      onDragEnd={readOnly ? undefined : onDragEnd}
      className={`block group bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow-md hover:border-primary-200 transition-all ${
        readOnly ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
      } ${isDragging ? "opacity-40 scale-[0.97]" : ""}`}
    >
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
              {conv.channel === "site" && (
                <span className="inline-flex items-center justify-center size-4 rounded-full bg-sky-50 border border-sky-200 shrink-0" title="Lead via site">
                  <SourceLogo source="webform" size={9} />
                </span>
              )}
              <span className="truncate">{displayName}</span>
            </p>
            <p className="text-[10px] text-slate-400 truncate flex items-center gap-1">
              <Phone className="size-2.5" />
              {contact?.phone_number ? formatPhone(contact.phone_number) : "—"}
            </p>
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
        </div>

        {(conv.estimated_value || conv.expected_close_date) && (
          <div className="flex items-center justify-between gap-2 text-[10px] pt-2 border-t border-slate-100">
            <div className="flex items-center gap-2 min-w-0">
              {conv.estimated_value && conv.estimated_value > 0 ? (
                <span className="font-semibold text-slate-700 tabular-nums flex items-center gap-0.5">
                  <DollarSign className="size-2.5" />{BRL(Number(conv.estimated_value)).replace("R$", "").trim()}
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
          {time && (
            <span className={`inline-flex items-center gap-1 text-[10px] ${overdueReply ? "text-red-600 font-semibold" : "text-slate-400"}`}>
              {overdueReply ? <AlertCircle className="size-2.5" /> : <Clock className="size-2.5" />}
              {time.label}{overdueReply && " sem resposta"}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            {showChannel && (
              conv.whatsapp_instances?.provider === "meta_cloud" ? (
                <span className="inline-flex items-center gap-0.5 text-[8px] font-semibold px-1 py-0.5 rounded bg-primary-50 text-primary-700" title="WhatsApp API Oficial">
                  <BadgeCheck className="size-2.5" /> Oficial
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5 text-[8px] font-semibold px-1 py-0.5 rounded bg-slate-100 text-slate-500" title="WhatsApp (QR)">
                  <Smartphone className="size-2.5" /> QR
                </span>
              )
            )}
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
      </div>
    </Link>
  )
}
