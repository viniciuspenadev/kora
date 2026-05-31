"use client"

import { useState, useEffect, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  GripVertical, Clock, AlertCircle, Trophy, XCircle,
  Phone, DollarSign, Calendar, Loader2,
  ArrowUpRight, ArrowDownLeft, Smartphone,
} from "lucide-react"
import { moveConversation } from "@/lib/actions/pipeline"
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
  chat_contacts:        ChatContact | null
  profiles:             { full_name: string | null; email: string } | null
}

interface Props {
  stages:        Stage[]
  conversations: Conversation[]
  /** Pinta o fundo das colunas com a cor da etapa (preferência do tenant). */
  tintColumns:   boolean
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

export function ConversationKanban({ stages, conversations: initial, tintColumns }: Props) {
  const router = useRouter()
  const [convs, setConvs] = useState(initial)
  const [draggingId, setDraggingId]   = useState<string | null>(null)
  const [dragOverStage, setDragOver]  = useState<string | null>(null)
  const [pending, startTransition]    = useTransition()

  // Sincroniza com novo `initial` quando o server re-renderiza (router.refresh)
  useEffect(() => {
    setConvs(initial)
  }, [initial])

  // Polling do server component a cada 10s — cards sobem quando nova mensagem chega
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 10_000)
    return () => clearInterval(id)
  }, [router])

  function inStage(stageId: string) {
    return convs
      .filter((c) => c.stage_id === stageId)
      .sort((a, b) => {
        // Cards com atividade recente sobem; sem atividade ficam ao fim na ordem manual.
        const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
        const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
        if (aTime !== bTime) return bTime - aTime
        return (a.card_position ?? 0) - (b.card_position ?? 0)
      })
  }

  function stageTotal(stageId: string) {
    return inStage(stageId).reduce((s, c) => s + Number(c.estimated_value ?? 0), 0)
  }

  function handleDragStart(e: React.DragEvent, id: string) {
    setDraggingId(id)
    e.dataTransfer.effectAllowed = "move"
  }

  function handleDragEnd() {
    setDraggingId(null)
    setDragOver(null)
  }

  function handleDragOver(e: React.DragEvent, stageId: string) {
    e.preventDefault()
    setDragOver(stageId)
  }

  function handleDrop(e: React.DragEvent, stageId: string) {
    e.preventDefault()
    if (!draggingId) return

    const c = convs.find((x) => x.id === draggingId)
    if (!c || c.stage_id === stageId) {
      setDraggingId(null)
      setDragOver(null)
      return
    }

    const newPos = inStage(stageId).length

    setConvs((prev) => prev.map((x) =>
      x.id === draggingId ? { ...x, stage_id: stageId, card_position: newPos } : x
    ))
    setDraggingId(null)
    setDragOver(null)

    startTransition(async () => {
      try {
        await moveConversation(c.id, stageId, newPos)
      } catch (err) {
        setConvs(initial)
        alert((err as Error).message ?? "Erro ao mover")
      }
    })
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {stages.map((stage) => {
        const list   = inStage(stage.id)
        const isOver = dragOverStage === stage.id
        const StageIcon = stage.is_won ? Trophy : stage.is_lost ? XCircle : null

        return (
          <div
            key={stage.id}
            style={{
              borderTop: `3px solid ${stage.color}`,
              backgroundColor: isOver || !tintColumns ? undefined : `color-mix(in srgb, ${stage.color} 12%, transparent)`,
            }}
            className={`shrink-0 w-80 flex flex-col rounded-xl overflow-hidden transition-colors ${
              isOver ? "bg-primary-50 ring-2 ring-primary-200" : tintColumns ? "" : "bg-slate-100/60"
            }`}
            onDragOver={(e) => handleDragOver(e, stage.id)}
            onDrop={(e) => handleDrop(e, stage.id)}
            onDragLeave={() => setDragOver(null)}
          >
            <div className="px-3 py-2.5 border-b border-slate-200/70">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-sm font-semibold text-slate-900 flex-1 truncate">{stage.name}</span>
                {StageIcon && <StageIcon className={`size-3.5 ${stage.is_won ? "text-emerald-600" : "text-red-500"}`} />}
                <span className="text-[10px] font-bold text-slate-500 tabular-nums bg-white rounded-full px-1.5 py-0.5 min-w-[20px] text-center shadow-sm">
                  {list.length}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-bold text-slate-800 tabular-nums truncate">
                  {stageTotal(stage.id) > 0
                    ? BRL(stageTotal(stage.id))
                    : <span className="text-xs font-normal text-slate-300">—</span>}
                </span>
                <span className="text-[10px] text-slate-400 tabular-nums shrink-0">{stage.probability_pct}% prob.</span>
              </div>
            </div>

            <div className="flex-1 px-2 py-2 space-y-2 max-h-[calc(100vh-260px)] overflow-y-auto">
              {list.map((conv) => (
                <ConversationCard
                  key={conv.id}
                  conv={conv}
                  isDragging={draggingId === conv.id}
                  onDragStart={(e) => handleDragStart(e, conv.id)}
                  onDragEnd={handleDragEnd}
                />
              ))}

              {list.length === 0 && (
                <p className="text-[11px] text-slate-400 italic text-center py-6">Solte conversas aqui</p>
              )}
            </div>
          </div>
        )
      })}

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
  conv, isDragging, onDragStart, onDragEnd,
}: {
  conv:        Conversation
  isDragging:  boolean
  onDragStart: (e: React.DragEvent) => void
  onDragEnd:   () => void
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
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`block group bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow-md hover:border-primary-200 transition-all cursor-grab active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="p-3 space-y-2">

        <div className="flex items-start gap-2.5">
          <div className="size-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0 overflow-hidden">
            {contact?.profile_pic_url ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={contact.profile_pic_url} alt="" className="size-9 object-cover" />
            ) : (
              <span className="text-sm font-bold text-slate-500">{initial}</span>
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
