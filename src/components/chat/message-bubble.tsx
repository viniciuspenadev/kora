"use client"

import Link from "next/link"
import { useState, useRef } from "react"
import {
  Check, CheckCheck, Clock, AlertCircle, Lock, FileText, MapPin, Mic, Video,
  Image as ImageIcon, Download, X, ImageOff, Reply, Smartphone,
  Megaphone, ExternalLink, Eye, EyeOff, Trash2, Pencil, MessageSquareWarning,
  User as UserIcon, ListChecks, Square, Sparkles, ArrowRight, Smile, Forward,
  DollarSign, Bell, Camera, Share2,
} from "lucide-react"
import type { ChatMessage, ExternalAdReply } from "@/types/chat"
import { sanitizeAdReply } from "@/lib/ad-reply"
import { dealEventStyle } from "@/components/crm/deal-event-style"
import { AudioPlayer } from "./audio-player"
import { resolveMediaUrl } from "@/lib/media"
import { PlatformIcon, getPlatformMeta } from "@/components/ui/platform-icon"

interface QuotedMeta {
  msg_id:       string | null
  kind?:        string | null
  participant?: string | null
  preview?:     string | null
}

interface PollOption { optionName: string }

interface ContactItem { name?: string; vcard?: string }

interface MessageMeta {
  external_ad_reply?: ExternalAdReply
  quoted?:            QuotedMeta
  via_celular?:       boolean
  // Instagram — contexto interativo (resposta a story, compartilhamento de post/reel)
  ig_story_reply?:    { id?: string | null; url?: string | null }
  ig_share?:          string   // "ig_post" | "ig_reel" | "ig_story"
  ig_story?:          string   // "mention"
  // Novos
  view_once?:         boolean
  ephemeral?:         boolean
  edited?:            boolean
  reacted_to_id?:     string
  album_images?:      number
  album_videos?:      number
  contacts?:          ContactItem[]
  poll_name?:         string
  poll_options?:      PollOption[]
  poll_max?:          number
  poll_vote?:         boolean
  interactive_kind?:  "button" | "list" | "template_button" | "template" | "interactive"
  interactive_id?:    string
  unsupported_type?:  string
  live_location?:     boolean
  location_name?:     string | null
  location_address?:  string | null
  forwarded?:         boolean
  error?:             { code?: number | null; title?: string | null; message?: string | null }
  // IA / Flow Builder
  automation?:        "flow" | "ai" | "ai_note" | string
  ai_generated?:      boolean
  flow_id?:           string | null
  flow_run_id?:       string | null
  node_id?:           string | null
}

interface Props {
  message:      ChatMessage
  agentName?:   string | null
  /** Em conversas de grupo: nome ou número formatado do participante remetente. */
  senderLabel?: string | null
  /** Responder/citar esta mensagem. */
  onReply?:     (msg: ChatMessage) => void
  /** Reagir a esta mensagem com um emoji. */
  onReact?:     (msg: ChatMessage, emoji: string) => void
  /** Clique direito → menu de contexto (resolvido pelo ChatPanel). */
  onContextMenu?: (e: React.MouseEvent, msg: ChatMessage) => void
  /** Reações que colam NESTA bolha (resolvidas pelo ChatPanel por whatsapp_msg_id). */
  reactions?:   { emoji: string; fromAgent: boolean }[]
}

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"]

/** Toolbar que aparece no hover da bolha: reagir (popover rápido) + responder. */
function HoverActions({ message, onReply, onReact }: {
  message: ChatMessage
  onReply?: (m: ChatMessage) => void
  onReact?: (m: ChatMessage, e: string) => void
}) {
  const [showReact, setShowReact] = useState(false)
  if (!onReply && !onReact) return null
  return (
    <div className="relative shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
      {onReact && (
        <>
          <button
            type="button"
            onClick={() => setShowReact((v) => !v)}
            title="Reagir"
            className="size-7 rounded-full text-slate-400 hover:text-amber-500 hover:bg-slate-100 inline-flex items-center justify-center transition-colors"
          >
            <Smile className="size-4" />
          </button>
          {showReact && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowReact(false)} />
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 z-20 flex items-center gap-0.5 rounded-full bg-white border border-slate-200 shadow-md px-1.5 py-1">
                {QUICK_REACTIONS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => { onReact(message, e); setShowReact(false) }}
                    className="size-7 rounded-full hover:bg-slate-100 text-lg leading-none inline-flex items-center justify-center transition-transform hover:scale-110"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {onReply && (
        <button
          type="button"
          onClick={() => onReply(message)}
          title="Responder"
          className="size-7 rounded-full text-slate-400 hover:text-primary-600 hover:bg-slate-100 inline-flex items-center justify-center transition-colors"
        >
          <Reply className="size-4" />
        </button>
      )}
    </div>
  )
}

function scrollToQuoted(msgId: string) {
  if (typeof document === "undefined") return
  const el = document.querySelector(`[data-wa-id="${CSS.escape(msgId)}"]`)
  if (!el) return
  el.scrollIntoView({ behavior: "smooth", block: "center" })
  el.classList.add("ring-2", "ring-primary", "ring-offset-2", "rounded-2xl")
  setTimeout(() => el.classList.remove("ring-2", "ring-primary", "ring-offset-2"), 1600)
}

export function MessageBubble({ message, agentName, senderLabel, onReply, onReact, onContextMenu, reactions }: Props) {
  const isIncoming = message.sender_type === "contact"
  const isSystem   = message.sender_type === "system"
  const isNote     = message.is_private_note
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [imageBroken, setImageBroken]   = useState(false)
  // Mobile: long-press abre o menu de ações (toque não tem hover).
  const [touchActions, setTouchActions] = useState(false)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startPress = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch" || (!onReply && !onReact)) return
    pressTimer.current = setTimeout(() => setTouchActions(true), 450)
  }
  const endPress = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null } }

  const time = new Date(message.created_at).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  })

  // Dossiê da IA (encaminhamento) — card estruturado, antes do system pill.
  const routedMeta = (message.metadata ?? {}) as {
    ai_routed?:       boolean
    department_name?: string
    summary?:         string
    collected?:       { label: string; value: string }[]
    lead_level?:      string | null
  }
  if (routedMeta.ai_routed) {
    const collected = Array.isArray(routedMeta.collected) ? routedMeta.collected : []
    return (
      <div className="flex justify-end px-4 py-1.5">
        <div className="w-full max-w-md rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-blue-50 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-violet-100">
            <div className="size-5 rounded bg-gradient-to-br from-violet-500 to-blue-600 inline-flex items-center justify-center shrink-0">
              <Sparkles className="size-3 text-white" />
            </div>
            <span className="text-[11px] font-bold text-violet-700 uppercase tracking-wide">Dossiê da IA</span>
            <span className="text-[10px] text-violet-400">· privada</span>
            <span className="ml-auto text-[10px] text-violet-400">{time}</span>
          </div>
          <div className="px-3 py-2.5 space-y-2.5">
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              <span className="text-slate-500">Encaminhado para</span>
              <span className="inline-flex items-center gap-1 font-semibold text-primary-700 bg-white border border-primary-100 px-1.5 py-0.5 rounded">
                <ArrowRight className="size-3" /> {routedMeta.department_name ?? "departamento"}
              </span>
              {routedMeta.lead_level && (
                <span className="inline-flex items-center font-semibold text-violet-700 bg-violet-100 border border-violet-200 px-1.5 py-0.5 rounded capitalize">
                  lead {routedMeta.lead_level}
                </span>
              )}
            </div>
            {routedMeta.summary && (
              <div>
                <p className="text-[10px] font-semibold uppercase text-slate-400 tracking-wide mb-0.5">Resumo</p>
                <p className="text-xs text-slate-700 leading-relaxed">{routedMeta.summary}</p>
              </div>
            )}
            {collected.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase text-slate-400 tracking-wide mb-1.5">Coletado</p>
                <div className="space-y-2">
                  {collected.map((c, i) => (
                    <div key={i} className="text-xs leading-snug">
                      <p className="text-[11px] text-slate-400">{c.label}</p>
                      <p className="text-slate-800 font-medium">{c.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Cartão de EVENTO do Negócio (Linha do Tempo) — interno, cliente nunca vê ──
  // Vem ANTES do system pill: a movimentação é postada como sender_type "system" + is_private_note,
  // então sem este early-return ela cairia na pílula cinza centralizada.
  const dealEvent = (message.metadata as { deal_event?: {
    type: string; deal_id?: string | null; from_name?: string | null; to_name?: string | null
    note?: string | null; reason?: string | null
    change?: { label?: string | null; from?: string | null; to?: string | null } | null
    extras?: { valueChange?: { from: string; to: string } | null; followUp?: { title: string; due: string | null } | null } | null
    actor?: { label?: string | null } | null
  } } | null)?.deal_event
  if (dealEvent) {
    const e = dealEventStyle(dealEvent.type)
    const EvIcon = e.Icon
    const actorLabel = dealEvent.actor?.label ?? "Sistema"
    const ev = dealEvent
    // Destaque principal (de→para / antes→depois / etapa). Pra nota, o texto é o corpo.
    const detail =
        ev.type === "stage_changed"                  ? `${ev.from_name ?? "—"} → ${ev.to_name ?? "—"}`
      : ev.type === "created" || ev.type === "reopened" ? (ev.to_name ?? "")
      : ev.type === "lost" || ev.type === "canceled"  ? (ev.reason ?? "")
      : ev.type === "field_changed"                   ? `${ev.change?.label ?? "Campo"}: ${ev.change?.from ?? "—"} → ${ev.change?.to ?? "—"}`
      :                                                  ""
    const isNoteType = ev.type === "note"
    return (
      // Mesma ESTRUTURA do "Dossiê da IA": direita · header ícone+label+hora · seções rótulo/valor.
      <div className="flex justify-end px-4 py-1.5">
        <div className="w-full max-w-md rounded-xl border shadow-sm overflow-hidden bg-white" style={{ borderColor: `${e.accent}33` }}>
          <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: `${e.accent}1f`, backgroundColor: `${e.accent}0d` }}>
            <span className="size-5 rounded grid place-items-center shrink-0" style={{ backgroundColor: e.accent }}><EvIcon className="size-3 text-white" /></span>
            <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: e.accent }}>{e.label}</span>
            <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400"><Lock className="size-2.5" /> interno</span>
            <span className="ml-auto text-[10px] text-slate-400">{time}</span>
          </div>
          <div className="px-3 py-2.5 space-y-2.5">
            {detail && <p className="text-[13px] font-semibold text-slate-800">{detail}</p>}

            {ev.note && (
              isNoteType
                ? <p className="text-[13px] text-slate-700 whitespace-pre-wrap break-words leading-snug">{ev.note}</p>
                : <div>
                    <p className="text-[10px] font-semibold uppercase text-slate-400 tracking-wide mb-0.5">O que rolou</p>
                    <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap break-words">{ev.note}</p>
                  </div>
            )}

            {(ev.extras?.valueChange || ev.extras?.followUp) && (
              <div className="space-y-2">
                {ev.extras?.valueChange && (
                  <div className="text-xs leading-snug">
                    <p className="text-[11px] text-slate-400">Valor</p>
                    <p className="text-slate-800 font-medium tabular-nums inline-flex items-center gap-1.5">{ev.extras.valueChange.from} <ArrowRight className="size-3 text-slate-300 shrink-0" /> <span className="text-emerald-700">{ev.extras.valueChange.to}</span></p>
                  </div>
                )}
                {ev.extras?.followUp && (
                  <div className="text-xs leading-snug">
                    <p className="text-[11px] text-slate-400">Follow-up</p>
                    <p className="text-slate-800 font-medium inline-flex items-center gap-1.5"><Bell className="size-3 text-primary-500 shrink-0" /> {ev.extras.followUp.title}{ev.extras.followUp.due ? <span className="font-normal text-slate-400"> · {ev.extras.followUp.due}</span> : null}</p>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-100">
              <span className="text-[10px] text-slate-400">por {actorLabel}</span>
              {ev.deal_id && (
                <Link href={`/negocios/${ev.deal_id}`} className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold text-primary-600 hover:text-primary-700">ver no negócio →</Link>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (isSystem) {
    return (
      <div className="flex justify-center py-1">
        <span className="text-[11px] text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    )
  }

  if (isNote) {
    const noteMeta = (message.metadata ?? {}) as { automation?: string }
    const isAiNote = noteMeta.automation === "ai_note" || noteMeta.automation === "flow"

    if (isAiNote) {
      // Nota gerada pela IA — destaque com gradient violet-blue + sparkles
      return (
        <div className="flex justify-end px-4 py-0.5">
          <div
            className="max-w-[75%] rounded-2xl rounded-br-md px-4 py-2.5 bg-gradient-to-br from-violet-50 to-blue-50 border border-violet-200 shadow-sm"
            style={{ borderLeftWidth: 3, borderLeftColor: "#7c3aed" }}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <div className="size-4 rounded bg-gradient-to-br from-violet-500 to-blue-600 inline-flex items-center justify-center">
                <Lock className="size-2.5 text-white" />
              </div>
              <span className="text-[10px] font-bold text-violet-700 uppercase tracking-wider">
                Nota da IA · privada
              </span>
            </div>
            <p className="text-sm text-violet-950 whitespace-pre-wrap break-words leading-relaxed">
              {message.content}
            </p>
            <div className="flex justify-end mt-1.5">
              <span className="text-[10px] text-violet-500">{time}</span>
            </div>
          </div>
        </div>
      )
    }

    // Nota manual (atendente humano)
    return (
      <div className="flex justify-end px-4 py-0.5">
        <div className="max-w-[75%] rounded-2xl rounded-br-md px-4 py-2.5 bg-amber-50 border border-amber-200">
          <div className="flex items-center gap-1.5 mb-1">
            <Lock className="size-3 text-amber-500" />
            <span className="text-[10px] font-semibold text-amber-600 uppercase tracking-wider">
              Nota interna
            </span>
            {agentName && (
              <span className="text-[10px] text-amber-500">• {agentName}</span>
            )}
          </div>
          <p className="text-sm text-amber-900 whitespace-pre-wrap break-words leading-relaxed">
            {message.content}
          </p>
          <div className="flex justify-end mt-1">
            <span className="text-[10px] text-amber-400">{time}</span>
          </div>
        </div>
      </div>
    )
  }

  const mediaIcon = getMediaIcon(message.content_type)

  const meta          = (message.metadata ?? {}) as MessageMeta
  const quoted        = meta.quoted ?? null
  const adReply       = sanitizeAdReply(meta.external_ad_reply)
  const sentFromPhone = !isIncoming && !!meta.via_celular
  const isAiMessage   = message.sender_type === "bot" && (message.metadata as { ai?: boolean })?.ai === true

  // ── Mensagem apagada pelo remetente ────────────────────────
  if (message.content_type === "deleted" || message.deleted_at) {
    return (
      <div className={`flex px-4 py-0.5 ${isIncoming ? "justify-start" : "justify-end"}`}>
        <div className={`max-w-[75%] rounded-2xl px-4 py-2 italic inline-flex items-center gap-2 ${
          isIncoming
            ? "bg-slate-50 border border-slate-200 text-slate-500 rounded-bl-md"
            : "bg-slate-100 text-slate-500 rounded-br-md"
        }`}>
          <Trash2 className="size-3.5 shrink-0" />
          <span className="text-xs">Esta mensagem foi apagada</span>
          <span className="text-[10px] text-slate-400 ml-1">{time}</span>
        </div>
      </div>
    )
  }

  // Reações NÃO são entradas próprias da timeline — colam na bolha-alvo como
  // overlay (resolvidas no ChatPanel). Aqui, defensivo: nunca renderiza solta.
  if (message.content_type === "reaction") return null

  // ── Tipo não suportado (fallback robusto) ──────────────────
  if (message.content_type === "unsupported") {
    return (
      <div className={`flex px-4 py-0.5 ${isIncoming ? "justify-start" : "justify-end"}`}>
        <div className={`max-w-[75%] rounded-2xl px-4 py-3 inline-flex items-start gap-2.5 ${
          isIncoming
            ? "bg-slate-50 border border-slate-200 text-slate-700 rounded-bl-md"
            : "bg-slate-100 text-slate-700 rounded-br-md"
        }`}>
          <MessageSquareWarning className="size-4 text-slate-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs font-medium leading-relaxed">
              {message.content ?? "Mensagem em formato não suportado"}
            </p>
            <p className="text-[10px] text-slate-400 mt-1">
              Tipo: <span className="font-mono">{meta.unsupported_type ?? "desconhecido"}</span>
              <span className="ml-2">· Veja no app do WhatsApp · {time}</span>
            </p>
          </div>
        </div>
      </div>
    )
  }

  const hasReactions = !!reactions && reactions.length > 0
  return (
    <div className={`group flex items-center gap-1 px-4 py-0.5 ${hasReactions ? "mb-3" : ""} ${isIncoming ? "justify-start" : "justify-end"}`}>
      {!isIncoming && <HoverActions message={message} onReply={onReply} onReact={onReact} />}
      <div
        data-wa-id={message.whatsapp_msg_id ?? undefined}
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerLeave={endPress}
        onPointerCancel={endPress}
        onContextMenu={onContextMenu ? (e) => onContextMenu(e, message) : undefined}
        className={`relative max-w-[75%] rounded-2xl px-4 py-2.5 ${
          isIncoming
            ? "bg-white border border-slate-200 rounded-bl-md"
            : "bg-primary-100 text-slate-900 border border-primary-200/60 rounded-br-md"
        }`}
      >
        {/* Long-press (mobile): mesmas ações do hover, com alvos de toque maiores. */}
        {touchActions && (onReply || onReact) && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setTouchActions(false)} />
            <div className={`absolute -top-11 ${isIncoming ? "left-0" : "right-0"} z-40 flex items-center gap-1 rounded-full bg-white border border-slate-200 shadow-lg px-2 py-1.5`}>
              {onReact && QUICK_REACTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => { onReact(message, e); setTouchActions(false) }}
                  className="size-8 rounded-full hover:bg-slate-100 text-lg leading-none inline-flex items-center justify-center"
                >
                  {e}
                </button>
              ))}
              {onReply && (
                <button
                  type="button"
                  onClick={() => { onReply(message); setTouchActions(false) }}
                  className="size-8 rounded-full hover:bg-slate-100 text-slate-500 inline-flex items-center justify-center"
                >
                  <Reply className="size-4" />
                </button>
              )}
            </div>
          </>
        )}
        {isIncoming && senderLabel && (
          <p className="text-[10px] font-semibold text-primary-600 mb-0.5 truncate">
            {senderLabel}
          </p>
        )}

        {!isIncoming && (agentName || sentFromPhone) && (
          <p className="text-[10px] font-medium text-primary-700 mb-0.5 flex items-center gap-1.5">
            {agentName && <span>{agentName}</span>}
            {sentFromPhone && (
              <span
                className="inline-flex items-center gap-0.5 bg-primary-200 text-primary-800 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider"
                title="Mensagem enviada direto pelo celular conectado, fora do app"
              >
                <Smartphone className="size-2.5" /> via celular
              </span>
            )}
          </p>
        )}

        {meta.forwarded && (
          <p className="text-[10px] italic text-slate-400 mb-0.5 inline-flex items-center gap-1">
            <Forward className="size-2.5" /> Encaminhada
          </p>
        )}

        <QuotedReplyCard quoted={quoted} incoming={isIncoming} />
        <StoryReplyCard story={meta.ig_story_reply} mention={meta.ig_story === "mention"} incoming={isIncoming} />
        <ShareBadge share={meta.ig_share} incoming={isIncoming} />
        <AdReplyCard ad={adReply} />

        {(() => {
          const mediaSrc = resolveMediaUrl(message)
          if (!mediaSrc) return null

          if (message.content_type === "image") {
            return (
              <>
                {!imageBroken && (
                  <button
                    type="button"
                    onClick={() => setLightboxOpen(true)}
                    className="block -mx-2 mt-1 mb-1.5 rounded-lg overflow-hidden hover:opacity-90 transition-opacity"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={mediaSrc}
                      alt={message.media_file_name ?? "Imagem"}
                      onError={() => setImageBroken(true)}
                      className="max-w-full max-h-80 object-cover"
                    />
                  </button>
                )}
                {imageBroken && (
                  <div className={`flex items-center gap-2 -mx-1 mb-1.5 px-3 py-3 rounded-lg ${
                    isIncoming ? "bg-slate-50 border border-slate-200" : "bg-primary-500/30"
                  }`}>
                    <ImageOff className={`size-5 shrink-0 ${isIncoming ? "text-slate-400" : "text-slate-500"}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium ${isIncoming ? "text-slate-700" : "text-slate-900"}`}>
                        Imagem indisponível
                      </p>
                      <p className={`text-[10px] ${isIncoming ? "text-slate-400" : "text-slate-500"}`}>
                        Mensagem antiga — não foi possível baixar
                      </p>
                    </div>
                  </div>
                )}
              </>
            )
          }

          if (message.content_type === "audio") {
            return <AudioPlayer src={mediaSrc} incoming={isIncoming} mimeType={message.media_mime_type} />
          }

          if (message.content_type === "video") {
            return (
              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                className="block -mx-2 mt-1 mb-1.5 rounded-lg overflow-hidden bg-black"
              >
                <video src={mediaSrc} className="max-w-full max-h-80" controls />
              </button>
            )
          }

          if (message.content_type === "document") {
            return (
              <a
                href={mediaSrc}
                target="_blank"
                rel="noopener noreferrer"
                download={message.media_file_name ?? undefined}
            className={`flex items-center gap-2.5 -mx-1 mb-1.5 p-2 rounded-lg transition-colors ${
              isIncoming
                ? "bg-slate-50 hover:bg-slate-100"
                : "bg-primary-500/30 hover:bg-primary-500/50"
            }`}
          >
            <div className={`size-9 rounded-md flex items-center justify-center shrink-0 ${
              isIncoming ? "bg-white" : "bg-primary-200/40"
            }`}>
              <FileText className={`size-4 ${isIncoming ? "text-primary-600" : "text-slate-900"}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-medium truncate ${isIncoming ? "text-slate-900" : "text-slate-900"}`}>
                {message.media_file_name ?? "Documento"}
              </p>
              <p className={`text-[10px] ${isIncoming ? "text-slate-400" : "text-slate-500"}`}>
                Clique para baixar
              </p>
            </div>
            <Download className={`size-3.5 shrink-0 ${isIncoming ? "text-slate-400" : "text-slate-500"}`} />
          </a>
            )
          }

          if (message.content_type === "sticker") {
            return (
              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                className="block mt-1 mb-1 hover:opacity-90 transition-opacity"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaSrc} alt="Sticker" className="max-h-32 max-w-[128px] object-contain" />
              </button>
            )
          }

          return null
        })()}

        {mediaIcon && message.content_type !== "text" && message.content_type !== "location" && !resolveMediaUrl(message) && (
          <div className={`flex items-center gap-1.5 mb-1 ${isIncoming ? "text-slate-500" : "text-slate-500"}`}>
            {mediaIcon}
            <span className="text-[11px] font-medium capitalize italic">
              {message.media_file_name ?? message.content_type}
            </span>
          </div>
        )}

        {/* Localização — card com nome/endereço + link pro mapa */}
        {message.content_type === "location" && message.content && (() => {
          const [lat, lng] = message.content.split(",")
          return (
            <a
              href={`https://www.google.com/maps?q=${lat},${lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-2.5 -mx-1 mb-1 p-2 rounded-lg transition-colors ${
                isIncoming ? "bg-slate-50 hover:bg-slate-100" : "bg-primary-500/30 hover:bg-primary-500/50"
              }`}
            >
              <div className={`size-9 rounded-md flex items-center justify-center shrink-0 ${
                isIncoming ? "bg-white" : "bg-primary-200/40"
              }`}>
                <MapPin className={`size-4 ${isIncoming ? "text-primary-600" : "text-slate-900"}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-900 truncate">{meta.location_name || "Localização"}</p>
                <p className="text-[10px] text-slate-500 truncate">{meta.location_address || "Abrir no mapa"}</p>
              </div>
              <ExternalLink className="size-3.5 shrink-0 text-slate-400" />
            </a>
          )
        })()}

        {/* View-once: foto/vídeo de visualização única (some após ver) */}
        {meta.view_once && message.content_type !== "image" && message.content_type !== "video" && (
          <div className={`flex items-center gap-2 -mx-1 mb-1.5 px-3 py-2 rounded-lg ${
            isIncoming ? "bg-slate-50 border border-slate-200" : "bg-primary-500/30"
          }`}>
            <EyeOff className={`size-4 ${isIncoming ? "text-slate-400" : "text-slate-500"}`} />
            <span className={`text-[11px] font-medium ${isIncoming ? "text-slate-600" : "text-slate-900"}`}>
              Mídia de visualização única
            </span>
          </div>
        )}

        {/* Álbum (wrapper de "vou mandar N mídias") */}
        {message.content_type === "album" && (
          <div className={`flex items-center gap-2 -mx-1 px-3 py-2 rounded-lg ${
            isIncoming ? "bg-slate-50 border border-slate-200" : "bg-primary-500/30"
          }`}>
            <ImageIcon className={`size-4 ${isIncoming ? "text-slate-500" : "text-slate-900"}`} />
            <span className={`text-xs font-medium ${isIncoming ? "text-slate-700" : "text-slate-900"}`}>
              {message.content ?? "Álbum"}
            </span>
            <span className={`text-[10px] ${isIncoming ? "text-slate-400" : "text-slate-500"}`}>
              (as mídias chegam separadas a seguir)
            </span>
          </div>
        )}

        {/* Contato compartilhado */}
        {message.content_type === "contact" && meta.contacts && (
          <div className={`-mx-1 mb-1 rounded-lg overflow-hidden ${
            isIncoming ? "bg-slate-50 border border-slate-200" : "bg-primary-500/30"
          }`}>
            {meta.contacts.slice(0, 3).map((c, i) => (
              <div key={i} className={`flex items-center gap-2.5 px-3 py-2 ${i > 0 ? "border-t border-slate-200/40" : ""}`}>
                <div className={`size-8 rounded-full flex items-center justify-center shrink-0 ${
                  isIncoming ? "bg-slate-200 text-slate-600" : "bg-primary-200/70 text-primary-800"
                }`}>
                  <UserIcon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-xs font-medium truncate ${isIncoming ? "text-slate-900" : "text-slate-900"}`}>
                    {c.name ?? "Contato"}
                  </p>
                  <p className={`text-[10px] ${isIncoming ? "text-slate-400" : "text-slate-500"}`}>
                    Cartão de visita compartilhado
                  </p>
                </div>
              </div>
            ))}
            {meta.contacts.length > 3 && (
              <div className={`px-3 py-1.5 text-[10px] text-center ${isIncoming ? "text-slate-400" : "text-slate-500"}`}>
                +{meta.contacts.length - 3} contato{meta.contacts.length - 3 === 1 ? "" : "s"}
              </div>
            )}
          </div>
        )}

        {/* Enquete */}
        {message.content_type === "poll" && (
          <div className={`-mx-1 mb-1 px-3 py-2.5 rounded-lg ${
            isIncoming ? "bg-slate-50 border border-slate-200" : "bg-primary-500/30"
          }`}>
            <div className={`flex items-center gap-1.5 mb-2 text-[10px] font-bold uppercase tracking-wider ${
              isIncoming ? "text-slate-500" : "text-slate-500"
            }`}>
              <ListChecks className="size-3" />
              {meta.poll_vote ? "Voto em enquete" : "Enquete"}
              {meta.poll_max && meta.poll_max > 1 && (
                <span className="font-normal normal-case tracking-normal">
                  · escolha até {meta.poll_max}
                </span>
              )}
            </div>
            {meta.poll_name && (
              <p className={`text-sm font-medium mb-2 ${isIncoming ? "text-slate-900" : "text-slate-900"}`}>
                {meta.poll_name}
              </p>
            )}
            {meta.poll_options && meta.poll_options.length > 0 && (
              <div className="space-y-1">
                {meta.poll_options.map((opt, i) => (
                  <div key={i} className={`flex items-center gap-2 px-2 py-1.5 rounded-md ${
                    isIncoming ? "bg-white border border-slate-200" : "bg-white/15"
                  }`}>
                    <Square className={`size-3 ${isIncoming ? "text-slate-400" : "text-slate-500"}`} />
                    <span className={`text-xs ${isIncoming ? "text-slate-700" : "text-slate-900"}`}>
                      {opt.optionName}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Resposta interativa (button / list / template) */}
        {message.content_type === "interactive" && (
          <div className={`flex items-start gap-2 mb-1 -mx-0.5 px-2.5 py-1.5 rounded-md ${
            isIncoming ? "bg-primary-50 border border-primary-100" : "bg-white/15"
          }`}>
            <ListChecks className={`size-3.5 shrink-0 mt-0.5 ${isIncoming ? "text-primary-600" : "text-slate-500"}`} />
            <div className="min-w-0">
              <p className={`text-[10px] font-semibold uppercase tracking-wider ${
                isIncoming ? "text-primary-600" : "text-slate-500"
              }`}>
                Resposta interativa{meta.interactive_kind ? ` · ${meta.interactive_kind}` : ""}
              </p>
              {message.content && (
                <p className={`text-xs font-medium ${isIncoming ? "text-slate-800" : "text-slate-900"}`}>
                  {message.content}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Live location badge */}
        {meta.live_location && message.content_type === "location" && (
          <div className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider mb-1 px-1.5 py-0.5 rounded ${
            isIncoming ? "bg-emerald-50 text-emerald-700" : "bg-emerald-100 text-emerald-800"
          }`}>
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </div>
        )}

        {message.content && message.content_type !== "location" && message.content_type !== "interactive" && (
          <p className={`text-[13px] whitespace-pre-wrap break-words leading-relaxed ${
            isIncoming ? "text-slate-800" : "text-slate-900"
          }`}>
            {message.content}
          </p>
        )}

        <div className={`flex items-center justify-end gap-1 mt-1 ${
          isIncoming ? "text-slate-400" : "text-slate-500"
        }`}>
          {meta.view_once && (
            <span className="inline-flex items-center gap-0.5 text-[10px] italic" title="Visualização única">
              <Eye className="size-2.5" />
              uma vez
            </span>
          )}
          {(meta.edited || message.edited_at) && (
            <span className="text-[10px] italic inline-flex items-center gap-0.5" title="Mensagem editada">
              <Pencil className="size-2.5" />
              editada
            </span>
          )}
          {meta.ephemeral && (
            <span className="text-[10px] italic" title="Mensagem efêmera">
              ⏱
            </span>
          )}
          {isAiMessage && (
            <span
              className="size-3.5 rounded bg-gradient-to-br from-violet-500 to-blue-600 inline-flex items-center justify-center shrink-0"
              title="Respondido pela IA"
            >
              <Sparkles className="size-2.5 text-white" />
            </span>
          )}
          <span className="text-[10px]">{time}</span>
          {!isIncoming && <StatusIcon status={message.status} />}
        </div>

        {/* Falha de envio — mostra o motivo (do statuses[].errors da Meta). */}
        {!isIncoming && message.status === "failed" && (
          <p className="text-[10px] text-red-500 mt-0.5 text-right flex items-center justify-end gap-1">
            <AlertCircle className="size-2.5 shrink-0" /> {failReason(meta)}
          </p>
        )}

        {/* Reações coladas na bolha (igual WhatsApp) — chip flutuante na borda inferior. */}
        {hasReactions && (
          <div className={`absolute -bottom-3 ${isIncoming ? "left-2" : "right-2"} flex items-center gap-0.5 rounded-full bg-white border border-slate-200 shadow-sm px-1.5 py-0.5`}>
            {Array.from(
              reactions!.reduce((map, r) => map.set(r.emoji, (map.get(r.emoji) ?? 0) + 1), new Map<string, number>()),
            ).map(([emoji, n]) => (
              <span key={emoji} className="inline-flex items-center text-xs leading-none">
                {emoji}{n > 1 && <span className="ml-0.5 text-[9px] text-slate-500">{n}</span>}
              </span>
            ))}
          </div>
        )}
      </div>

      {isIncoming && <HoverActions message={message} onReply={onReply} onReact={onReact} />}

      {lightboxOpen && resolveMediaUrl(message) && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            className="absolute top-4 right-4 size-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
          >
            <X className="size-5" />
          </button>
          <a
            href={resolveMediaUrl(message)!}
            target="_blank"
            rel="noopener noreferrer"
            download={message.media_file_name ?? undefined}
            onClick={(e) => e.stopPropagation()}
            className="absolute top-4 right-16 size-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
            title="Baixar"
          >
            <Download className="size-5" />
          </a>
          {message.content_type === "video" ? (
            <video
              src={resolveMediaUrl(message)!}
              controls
              autoPlay
              className="max-w-full max-h-full"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={resolveMediaUrl(message)!}
              alt={message.media_file_name ?? "Imagem"}
              className="max-w-full max-h-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </div>
  )
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "pending":   return <Clock className="size-3 text-slate-400" />
    case "sent":      return <Check className="size-3 text-slate-400" />
    case "delivered": return <CheckCheck className="size-3 text-slate-400" />
    case "read":      return <CheckCheck className="size-3 text-primary-600" />
    case "failed":    return <AlertCircle className="size-3 text-red-500" />
    default:          return null
  }
}

/** Motivo amigável da falha de envio (mapeia códigos da Meta; senão usa o título/mensagem). */
const FAIL_CODE_LABEL: Record<number, string> = {
  131047: "Janela de 24h fechada — envie um template",
  131026: "Número não está no WhatsApp",
  131051: "Tipo de mensagem não suportado",
  131053: "Falha ao enviar a mídia",
  130472: "Cliente em experiência limitada do WhatsApp",
  131049: "Limite de marketing — a Meta segurou o envio",
}
function failReason(meta: MessageMeta): string {
  const e = meta.error
  if (!e) return "Não entregue"
  if (e.code && FAIL_CODE_LABEL[e.code]) return FAIL_CODE_LABEL[e.code]
  return e.title || e.message || "Não entregue"
}

function getMediaIcon(type: string) {
  switch (type) {
    case "image":    return <ImageIcon className="size-3.5" />
    case "audio":    return <Mic className="size-3.5" />
    case "video":    return <Video className="size-3.5" />
    case "document": return <FileText className="size-3.5" />
    case "location": return <MapPin className="size-3.5" />
    default:         return null
  }
}

function QuotedReplyCard({ quoted, incoming }: { quoted: QuotedMeta | null; incoming: boolean }) {
  if (!quoted || !quoted.preview) return null

  const handleClick = () => {
    if (quoted.msg_id) scrollToQuoted(quoted.msg_id)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!quoted.msg_id}
      className={`block w-full text-left -mx-2 mb-1.5 px-2.5 py-1.5 rounded-md border-l-4 transition-colors ${
        incoming
          ? "bg-slate-50 border-l-primary hover:bg-slate-100"
          : "bg-white/60 border-l-primary-400 hover:bg-white/80"
      } ${quoted.msg_id ? "cursor-pointer" : "cursor-default"}`}
    >
      <p className={`text-[10px] font-semibold uppercase tracking-wider mb-0.5 flex items-center gap-1 ${
        incoming ? "text-primary-600" : "text-primary-700"
      }`}>
        <Reply className="size-2.5" />
        Em resposta a
      </p>
      <p className={`text-xs leading-snug line-clamp-2 ${
        incoming ? "text-slate-700" : "text-slate-700"
      }`}>
        {quoted.preview}
      </p>
    </button>
  )
}

/**
 * Resposta a um story do Instagram (ou menção em story). O story é efêmero (24h),
 * então a thumbnail vem da CDN da Meta (lookaside) renderizada direto — fallback
 * gracioso se o link expirar. Mesmo padrão do thumbnail de anúncio.
 */
function StoryReplyCard({ story, mention, incoming }: {
  story?: { id?: string | null; url?: string | null } | null
  mention?: boolean
  incoming: boolean
}) {
  const [broken, setBroken] = useState(false)
  if (!story?.url && !mention) return null
  const url = story?.url ?? null
  return (
    <div className={`flex items-center gap-2.5 -mx-1 mb-1.5 px-2 py-1.5 rounded-md ${
      incoming ? "bg-slate-50 border border-slate-200" : "bg-white/60"
    }`}>
      {url && !broken ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={url} alt="" onError={() => setBroken(true)} className="h-12 w-8 rounded object-cover shrink-0 border border-slate-200" />
      ) : (
        <div className="h-12 w-8 rounded shrink-0 border border-slate-200 bg-gradient-to-br from-fuchsia-100 to-amber-100 flex items-center justify-center">
          <Camera className="size-3.5 text-fuchsia-500" />
        </div>
      )}
      <div className="min-w-0">
        <p className={`text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1 ${
          incoming ? "text-fuchsia-600" : "text-fuchsia-700"
        }`}>
          <Camera className="size-2.5" />
          {mention ? "Mencionou você no story" : "Respondeu ao seu story"}
        </p>
        <p className="text-[10px] text-slate-400">Story do Instagram</p>
      </div>
    </div>
  )
}

/** Compartilhamento de post/reel/story do Instagram — selo de contexto sobre a imagem. */
function ShareBadge({ share, incoming }: { share?: string; incoming: boolean }) {
  if (!share) return null
  const label = share === "ig_reel" ? "Compartilhou um reel" : share === "ig_story" ? "Compartilhou um story" : "Compartilhou um post"
  return (
    <p className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider mb-1 ${
      incoming ? "text-primary-600" : "text-primary-700"
    }`}>
      <Share2 className="size-2.5" /> {label}
    </p>
  )
}

/**
 * Detecta plataforma de origem do CTWA. Prioriza `sourceApp` (literal da Meta)
 * sobre `sourceUrl` (pode ter cross-link entre IG↔FB que confunde inferência).
 */
function detectAdPlatformKey(ad: ExternalAdReply): string {
  const app = ad.sourceApp?.toLowerCase()
  if (app === "instagram" || app === "facebook" || app === "messenger" || app === "whatsapp") return app

  // Fallback pra sourceUrl quando sourceApp ausente
  const u = (ad.sourceUrl ?? "").toLowerCase()
  if (u.includes("instagram"))   return "instagram"
  if (u.includes("facebook"))    return "facebook"
  if (u.includes("messenger"))   return "messenger"
  return "meta"
}

/**
 * Mapeia wtwaAdFormat pra label PT-BR. Se desconhecido, retorna o original.
 */
function formatAdFormat(format: string | undefined): string | null {
  if (!format) return null
  const map: Record<string, string> = {
    single_image:        "Imagem única",
    carousel:            "Carrossel",
    video:               "Vídeo",
    reel:                "Reel",
    story:               "Story",
    collection:          "Coleção",
    instant_experience:  "Experiência instantânea",
  }
  return map[format] ?? format
}

/**
 * Tipo de mídia. Vem como number (1=image, 2=video) do Baileys.
 */
function formatMediaType(t: string | number | undefined): string | null {
  if (t === undefined || t === null) return null
  const n = typeof t === "number" ? t : parseInt(t, 10)
  if (n === 1) return "Imagem"
  if (n === 2) return "Vídeo"
  return null
}

function AdReplyCard({ ad }: { ad: ExternalAdReply | null | undefined }) {
  const [copiedClid, setCopiedClid] = useState(false)
  const [copiedId, setCopiedId]     = useState(false)
  const [thumbBroken, setThumbBroken] = useState(false)

  if (!ad) return null

  const thumb = ad.thumbnailUrl
    ?? ad.originalImageUrl
    ?? (typeof ad.thumbnail === "string" ? `data:image/jpeg;base64,${ad.thumbnail}` : null)

  const platformKey  = detectAdPlatformKey(ad)
  const platformMeta = getPlatformMeta(platformKey)
  // wtwaAdFormat pode vir como string ("reel", "carousel", ...) ou false (raro)
  const adFormat     = typeof ad.wtwaAdFormat === "string" ? formatAdFormat(ad.wtwaAdFormat) : null
  const mediaTypeStr = formatMediaType(ad.mediaType)

  function copy(value: string, kind: "clid" | "id") {
    navigator.clipboard.writeText(value)
    if (kind === "clid") {
      setCopiedClid(true)
      setTimeout(() => setCopiedClid(false), 1500)
    } else {
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 1500)
    }
  }

  return (
    <div className="-mx-2 mt-1 mb-1.5 rounded-lg overflow-hidden border border-slate-200 bg-slate-50/60">
      <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1">
        <Megaphone className="size-3 text-primary-600" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-primary-600">
          Veio do anúncio
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold" style={{ color: platformMeta.color }}>
          <PlatformIcon app={platformKey} size={12} />
          {platformMeta.label}
        </span>
      </div>
      <div className="flex gap-2.5 px-2.5 pb-2.5">
        {thumb && !thumbBroken ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={thumb}
            alt=""
            onError={() => setThumbBroken(true)}
            className="size-14 rounded-md object-cover shrink-0 border border-slate-200"
          />
        ) : (
          // Fallback: CDN da Meta expirou ou nunca veio. Mostra ícone da plataforma.
          <div
            className="size-14 rounded-md shrink-0 border border-slate-200 bg-slate-50 flex items-center justify-center"
            title="Thumbnail do anúncio indisponível (CDN da Meta expira)"
          >
            <PlatformIcon app={platformKey} size={28} className="opacity-60" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          {ad.title && (
            <p className="text-xs font-bold text-slate-900 leading-tight line-clamp-2">
              {ad.title}
            </p>
          )}
          {ad.body && (
            <p className="text-[11px] text-slate-600 leading-snug mt-0.5 line-clamp-2">
              {ad.body}
            </p>
          )}
          {(adFormat || mediaTypeStr) && (
            <p className="text-[10px] text-slate-500 mt-1 inline-flex items-center gap-1.5 flex-wrap">
              {adFormat && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-100 font-semibold">
                  {adFormat}
                </span>
              )}
              {mediaTypeStr && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-100 font-semibold">
                  {mediaTypeStr}
                </span>
              )}
            </p>
          )}
          <div className="mt-1 inline-flex items-center gap-3 flex-wrap">
            {ad.sourceUrl && (
              <a
                href={ad.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary-600 hover:text-primary-700"
              >
                Abrir post <ExternalLink className="size-2.5" />
              </a>
            )}
            {ad.mediaUrl && ad.mediaUrl !== ad.sourceUrl && (
              <a
                href={ad.mediaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-slate-700"
              >
                Ver mídia <ExternalLink className="size-2.5" />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Auto-resposta enviada pela Meta (visualização do que o cliente recebeu antes do atendente) */}
      {ad.automatedGreetingMessageShown && ad.greetingMessageBody && (
        <div className="px-2.5 py-1.5 bg-primary-50/60 border-t border-primary-100">
          <p className="text-[9px] font-bold uppercase tracking-wider text-primary-700 mb-0.5">
            ✨ Auto-resposta da Meta enviada ao cliente
          </p>
          <p className="text-[11px] text-slate-700 line-clamp-3 italic leading-snug">
            &ldquo;{ad.greetingMessageBody}&rdquo;
          </p>
        </div>
      )}

      {(ad.sourceId || ad.ctwaClid) && (
        <div className="px-2.5 py-1.5 bg-slate-100 border-t border-slate-200 space-y-1">
          {ad.sourceId && (
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 shrink-0">Ad ID:</span>
              <span className="text-[9px] font-mono text-slate-600 truncate flex-1" title={ad.sourceId}>
                {ad.sourceId}
              </span>
              <button
                type="button"
                onClick={() => copy(ad.sourceId!, "id")}
                aria-label="Copiar Ad ID"
                className={`size-5 inline-flex items-center justify-center rounded transition-colors ${
                  copiedId ? "text-emerald-600" : "text-slate-400 hover:text-slate-700 hover:bg-white"
                }`}
                title="Copiar — cole no Meta Ads Manager pra ver o anúncio"
              >
                {copiedId ? <Check className="size-2.5" /> : <Reply className="size-2.5 -scale-x-100" />}
              </button>
            </div>
          )}
          {ad.ctwaClid && (
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 shrink-0">CTWA Clid:</span>
              <span className="text-[9px] font-mono text-slate-600 truncate flex-1" title={ad.ctwaClid}>
                {ad.ctwaClid}
              </span>
              <button
                type="button"
                onClick={() => copy(ad.ctwaClid!, "clid")}
                aria-label="Copiar Click ID"
                className={`size-5 inline-flex items-center justify-center rounded transition-colors ${
                  copiedClid ? "text-emerald-600" : "text-slate-400 hover:text-slate-700 hover:bg-white"
                }`}
                title="Click ID único do anúncio — use pra atribuição/ROI"
              >
                {copiedClid ? <Check className="size-2.5" /> : <Reply className="size-2.5 -scale-x-100" />}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
