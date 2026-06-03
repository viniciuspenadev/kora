"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { MessageBubble } from "./message-bubble"
import { MessageInput } from "./message-input"
import { formatPhoneDisplay } from "@/lib/phone-utils"
import { lifecycleMeta } from "@/lib/lifecycle"
import { displayContactName, displayContactInitial } from "@/lib/contact"
import {
  User, Phone, CheckCircle2, Clock, XCircle,
  ChevronDown, UserPlus, Users, Loader2, Megaphone, ExternalLink, Archive, ArchiveRestore,
} from "lucide-react"
import { SourceChip } from "@/components/chat/source-chip"
import { buildTimelineGroups, TimelineDivider, DateDivider } from "@/components/chat/timeline-divider"
import type { ChatMessage, ChatConversation, ChatQuickReply, ExternalAdReply } from "@/types/chat"
import { PlatformIcon, getPlatformMeta } from "@/components/ui/platform-icon"

interface Props {
  conversation: ChatConversation
  messages:     ChatMessage[]
  quickReplies: ChatQuickReply[]
  agents:       Array<{ id: string; full_name: string | null }>
  onStatusChange: (status: string) => void
  onAssign:       (agentId: string | null) => void
  // Paginação de mensagens antigas (scroll-up)
  hasMoreOlder?:  boolean
  loadingOlder?:  boolean
  onLoadOlder?:   () => void
  // Envio otimista — orquestrado em InboxClient
  onSendText:     (content: string, isPrivate: boolean) => Promise<void>
  onSendMedia:    (file: File, caption: string) => Promise<void>
  onSendVoice:    (file: File) => Promise<void>
  onArchiveToggle: () => void
}

const STATUS_OPTIONS = [
  { key: "open",     label: "Aberto",    icon: Clock,         color: "text-primary-700 bg-primary-50" },
  { key: "pending",  label: "Pendente",  icon: Clock,         color: "text-amber-600 bg-amber-50" },
  { key: "resolved", label: "Resolvido", icon: CheckCircle2,  color: "text-green-600 bg-green-50" },
  { key: "snoozed",  label: "Adiado",    icon: XCircle,       color: "text-slate-500 bg-slate-100" },
]

/** Tempo restante da janela de 24h, formatado curto (ex: "22h 14m", "47m"). */
function fmtWindowLeft(ms: number): string {
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function ChatPanel({
  conversation, messages, quickReplies, agents, onStatusChange, onAssign,
  hasMoreOlder = false, loadingOlder = false, onLoadOlder,
  onSendText, onSendMedia, onSendVoice, onArchiveToggle,
}: Props) {
  const isArchived = !!conversation.archived_at
  const messagesEndRef     = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const topSentinelRef     = useRef<HTMLDivElement>(null)
  const prevConvIdRef      = useRef<string | null>(null)
  // Preservação de scroll position quando mensagens antigas são prepended
  const prependingRef               = useRef(false)
  const scrollFromBottomBeforeRef   = useRef(0)
  const prevMessagesLengthRef       = useRef(0)

  const contact = conversation.chat_contacts
  const name    = contact ? displayContactName(contact) : formatPhoneDisplay("")
  const phone   = contact?.phone_number ? formatPhoneDisplay(contact.phone_number) : ""

  const currentStatus = STATUS_OPTIONS.find((s) => s.key === conversation.status) ?? STATUS_OPTIONS[0]

  const lifecycle = contact?.lifecycle_stage ?? "contact"
  const lc        = lifecycleMeta(lifecycle)
  const channelSource = contact?.source ?? null

  // ── Janela de 24h (só instância oficial Cloud API) ──────────────
  // Baileys não tem janela → toda a lógica abaixo é gated em isOfficial,
  // então conversa QR (Bernardo) se comporta exatamente como hoje.
  const isOfficial = conversation.whatsapp_instances?.provider === "meta_cloud"
  // Âncora da janela = `last_inbound_at` da conversa (gravado do timestamp da Meta no
  // inbound — fonte autoritativa). Cross-check com a última msg inbound carregada cobre
  // o "chegou agora enquanto vejo" (antes do row refresh via realtime). Usa o mais recente.
  const lastInboundAt = useMemo(() => {
    let fromMsgs: string | null = null
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender_type === "contact") { fromMsgs = messages[i].created_at; break }
    }
    const fromConv = conversation.last_inbound_at ?? null
    if (fromConv && fromMsgs) return fromConv > fromMsgs ? fromConv : fromMsgs
    return fromConv ?? fromMsgs
  }, [messages, conversation.last_inbound_at])
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    if (!isOfficial) return
    const id = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [isOfficial])
  const windowMsLeft = (isOfficial && lastInboundAt)
    ? 24 * 60 * 60 * 1000 - (nowTick - new Date(lastInboundAt).getTime())
    : null
  const windowOpen = windowMsLeft !== null && windowMsLeft > 0

  // Preservação de scroll quando msgs antigas são prepended.
  // Roda ANTES do paint pra evitar flicker.
  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    if (prependingRef.current) {
      // Restaura distância do fundo (msgs novas no topo, usuário fica na mesma msg)
      container.scrollTop = container.scrollHeight - scrollFromBottomBeforeRef.current
      prependingRef.current = false
    }

    prevMessagesLengthRef.current = messages.length
  }, [messages.length])

  // Auto-scroll: só dispara em (a) troca de conv ou (b) msg NOVA no fim.
  // Prepend de msgs antigas no topo NÃO ativa esse effect (newest stays the same).
  // Se usuário estiver lendo histórico (scrolled up), também NÃO empurra pra baixo.
  const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || !lastMessageId) return

    const newConv = prevConvIdRef.current !== conversation.id
    prevConvIdRef.current = conversation.id

    // "Está perto do fim?" — só rola se sim ou se conv mudou.
    const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    const nearBottom     = distFromBottom < 200
    if (!newConv && !nearBottom) return

    function forceBottom() {
      if (!container) return
      container.scrollTop = container.scrollHeight
    }

    forceBottom()

    const mediaElements = container.querySelectorAll("img, video, audio")
    const cleanups: Array<() => void> = []

    mediaElements.forEach((el) => {
      const onLoad = () => forceBottom()
      el.addEventListener("load", onLoad)
      el.addEventListener("loadedmetadata", onLoad)
      el.addEventListener("error", onLoad)
      cleanups.push(() => {
        el.removeEventListener("load", onLoad)
        el.removeEventListener("loadedmetadata", onLoad)
        el.removeEventListener("error", onLoad)
      })
    })

    const t1 = setTimeout(forceBottom, 100)
    const t2 = setTimeout(forceBottom, 400)

    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      cleanups.forEach((fn) => fn())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id, lastMessageId])

  // IntersectionObserver no topo: dispara loadOlder quando sentinela entra na tela
  useEffect(() => {
    const sentinel = topSentinelRef.current
    if (!sentinel || !hasMoreOlder || !onLoadOlder) return

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingOlder) {
          // Captura distância do fim ANTES do prepend
          const container = scrollContainerRef.current
          if (container) {
            scrollFromBottomBeforeRef.current = container.scrollHeight - container.scrollTop
            prependingRef.current = true
          }
          onLoadOlder()
        }
      },
      { rootMargin: "100px" },
    )
    obs.observe(sentinel)
    return () => obs.disconnect()
  }, [hasMoreOlder, loadingOlder, onLoadOlder])

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {conversation.is_group ? (
            conversation.group_picture ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={conversation.group_picture}
                alt=""
                className="size-10 rounded-full object-cover shrink-0"
              />
            ) : (
              <div className="size-10 rounded-full bg-amber-500 flex items-center justify-center shrink-0">
                <Users className="size-5 text-white" />
              </div>
            )
          ) : contact?.profile_pic_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={contact.profile_pic_url}
              alt=""
              className="size-10 rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="size-10 rounded-full bg-gradient-to-br from-white to-slate-200 ring-1 ring-inset ring-slate-200/70 flex items-center justify-center shrink-0">
              <span className="text-sm font-bold text-slate-400">
                {contact ? displayContactInitial(contact) : "?"}
              </span>
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate flex items-center gap-1.5">
              {conversation.is_group && <Users className="size-3 text-amber-600 shrink-0" />}
              {conversation.is_group
                ? (conversation.group_name ?? "Grupo sem nome")
                : name}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {conversation.is_group ? (
                <span className="text-[11px] text-slate-400">
                  {conversation.group_members?.length ?? 0} membros • grupo
                </span>
              ) : (
                <>
                  {phone && (
                    <span className="text-[11px] text-slate-400 font-mono">{phone}</span>
                  )}
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${lc.bg} ${lc.text}`}
                    title={lc.label}
                  >
                    {lc.icon} {lc.label}
                  </span>
                  {channelSource && (
                    <SourceChip source={channelSource} className="text-[10px]" />
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">

          {isOfficial && (
            windowOpen ? (
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg ${
                  windowMsLeft! < 2 * 60 * 60 * 1000 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
                }`}
                title="Janela de atendimento de 24h (WhatsApp API Oficial). Dentro dela você responde com texto livre."
              >
                <Clock className="size-3" /> {fmtWindowLeft(windowMsLeft!)}
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-slate-100 text-slate-500"
                title="Fora da janela de 24h — só dá pra enviar um template aprovado."
              >
                <Clock className="size-3" /> Janela fechada
              </span>
            )
          )}

          <div className="relative group">
            <button
              type="button"
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${currentStatus.color}`}
            >
              <currentStatus.icon className="size-3.5" />
              {currentStatus.label}
              <ChevronDown className="size-3" />
            </button>
            <div className="absolute right-0 top-full mt-1 bg-white rounded-lg border border-slate-200 shadow-lg py-1 min-w-[140px] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => onStatusChange(opt.key)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-slate-50 transition-colors ${
                    opt.key === conversation.status ? "text-primary-600" : "text-slate-700"
                  }`}
                >
                  <opt.icon className="size-3.5" />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={onArchiveToggle}
            title={isArchived ? "Restaurar conversa (volta pro inbox + kanban)" : "Arquivar conversa (esconde do inbox e do kanban)"}
            className={`size-8 inline-flex items-center justify-center rounded-lg transition-colors ${
              isArchived
                ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {isArchived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
          </button>

          <div className="relative group">
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
            >
              <UserPlus className="size-3.5" />
              {conversation.profiles?.full_name ?? "Atribuir"}
              <ChevronDown className="size-3" />
            </button>
            <div className="absolute right-0 top-full mt-1 bg-white rounded-lg border border-slate-200 shadow-lg py-1 min-w-[160px] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
              <button
                type="button"
                onClick={() => onAssign(null)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-500 hover:bg-slate-50"
              >
                <User className="size-3.5" />
                Sem atribuição
              </button>
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => onAssign(agent.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 ${
                    agent.id === conversation.assigned_to ? "text-primary-600 font-semibold" : "text-slate-700"
                  }`}
                >
                  <div className="size-5 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                    <span className="text-[9px] font-bold text-primary-600">
                      {agent.full_name?.[0]?.toUpperCase() ?? "?"}
                    </span>
                  </div>
                  {agent.full_name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <AdSourceBanner ad={conversation.from_ad_meta} />

      <SiteSourceBanner conversation={conversation} />

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-2 py-4"
        style={{ backgroundImage: "radial-gradient(circle at 1px 1px, rgba(0,0,0,0.03) 1px, transparent 0)", backgroundSize: "20px 20px" }}
      >
        {/* Sentinela do topo — dispara loadOlder ao entrar na tela */}
        {messages.length > 0 && (hasMoreOlder || loadingOlder) && (
          <div ref={topSentinelRef} className="flex items-center justify-center py-3">
            {loadingOlder ? (
              <Loader2 className="size-4 text-slate-300 animate-spin" />
            ) : (
              <span className="text-[10px] text-slate-300">Carregar mais antigas…</span>
            )}
          </div>
        )}
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Phone className="size-10 text-slate-200 mb-3" />
            <p className="text-sm font-medium text-slate-500 mb-1">Nenhuma mensagem</p>
            <p className="text-xs text-slate-400">As mensagens aparecerão aqui quando o contato enviar algo.</p>
          </div>
        ) : (
          buildTimelineGroups(messages).map((group) => (
            <section key={group.id} className="space-y-1">
              <DateDivider label={group.dateLabel} />
              {group.items.map((item) =>
                item.kind === "divider" ? (
                  <TimelineDivider key={item.id} icon={item.icon} label={item.label} time={item.time} />
                ) : (
                  <MessageBubble
                    key={item.id}
                    message={item.msg}
                    agentName={item.msg.sender_type === "agent" ? item.msg.profiles?.full_name : null}
                    senderLabel={
                      item.msg.sender_type !== "contact"
                        ? null
                        : conversation.is_group && item.msg.group_participant_jid
                          ? formatPhoneDisplay(item.msg.group_participant_jid.split("@")[0])
                          : name
                    }
                  />
                )
              )}
            </section>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <MessageInput
        conversationId={conversation.id}
        quickReplies={quickReplies}
        disabled={conversation.status === "resolved"}
        windowClosed={isOfficial && !windowOpen}
        windowNeverOpened={isOfficial && !lastInboundAt}
        contactFirstName={name.split(/\s+/)[0] ?? ""}
        onSendText={onSendText}
        onSendMedia={onSendMedia}
        onSendVoice={onSendVoice}
      />

    </div>
  )
}

/**
 * Banner compacto no topo do chat avisando que a conversa veio de um anúncio
 * Meta (Click-to-WhatsApp). Sempre visível enquanto a conv tá aberta — útil
 * pro atendente saber o contexto sem precisar abrir a sidebar.
 */
function AdSourceBanner({ ad }: { ad: ExternalAdReply | null }) {
  const [thumbBroken, setThumbBroken] = useState(false)

  if (!ad) return null

  const thumb = ad.thumbnailUrl
    ?? ad.originalImageUrl
    ?? (typeof ad.thumbnail === "string" ? `data:image/jpeg;base64,${ad.thumbnail}` : null)

  // Confia em sourceApp (literal da Meta) primeiro. Fallback pra inferir via URL.
  const app = ad.sourceApp?.toLowerCase()
  const platformKey =
      app === "instagram" || app === "facebook" || app === "messenger" || app === "whatsapp"
        ? app
        : ad.sourceUrl?.toLowerCase().includes("instagram") ? "instagram"
        : ad.sourceUrl?.toLowerCase().includes("facebook")  ? "facebook"
        : "meta"
  const platformMeta = getPlatformMeta(platformKey)

  return (
    <div className="flex items-center gap-2.5 px-4 py-2 bg-gradient-to-r from-primary-50 to-primary-50/40 border-b border-primary-100">
      <Megaphone className="size-4 text-primary-600 shrink-0" />
      {thumb && !thumbBroken && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={thumb}
          alt=""
          onError={() => setThumbBroken(true)}
          className="size-7 rounded object-cover shrink-0 border border-primary-200"
        />
      )}
      <div className="min-w-0 flex-1 flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider shrink-0" style={{ color: platformMeta.color }}>
          <PlatformIcon app={platformKey} size={12} />
          Anúncio {platformMeta.label}
        </span>
        {ad.title && (
          <span className="text-xs text-slate-700 truncate" title={ad.title}>
            · {ad.title}
          </span>
        )}
      </div>
      {ad.sourceUrl && (
        <a
          href={ad.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-semibold text-primary-700 hover:text-primary-900 inline-flex items-center gap-1 shrink-0"
          title="Abrir anúncio no Instagram/Facebook"
        >
          Ver criativo <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  )
}

/**
 * Banner de continuidade site → WhatsApp. Exibe quando a conversa veio do
 * widget do site (channel='site' ou metadata.site_lead presente). Mostra
 * página de origem, UTMs e principais respostas do formulário — pra equipe
 * pegar contexto sem precisar abrir a sidebar.
 */
interface SiteLeadMeta {
  page_url?: string | null
  referrer?: string | null
  utm?: Record<string, string | null | undefined>
  journey?: string | null
  answers?: Record<string, string | null | undefined>
}

function SiteSourceBanner({ conversation }: { conversation: ChatConversation }) {
  const meta = conversation.metadata as Record<string, unknown> | null | undefined
  const siteLead = (meta?.site_lead ?? null) as SiteLeadMeta | null
  const isSite   = conversation.channel === "site"

  if (!siteLead && !isSite) return null

  // host limpo pra exibição (sem protocolo)
  const host = (() => {
    if (!siteLead?.page_url) return null
    try { return new URL(siteLead.page_url).host } catch { return siteLead.page_url }
  })()

  const utmSource = siteLead?.utm?.utm_source ?? null
  const intent    = siteLead?.answers?.intent ?? siteLead?.journey ?? null

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-sky-50/60 to-transparent border-b border-sky-100 text-[11px]">
      <SourceChip source="webform" label="Veio do site" />
      <div className="min-w-0 flex-1 flex items-center gap-2 text-slate-600">
        {host && (
          <span className="truncate" title={siteLead?.page_url ?? undefined}>
            {host}
          </span>
        )}
        {utmSource && (
          <span className="text-[10px] font-semibold text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded shrink-0">
            {utmSource}
          </span>
        )}
        {intent && (
          <span className="truncate" title={intent}>
            · {intent}
          </span>
        )}
      </div>
      {siteLead?.page_url && (
        <a
          href={siteLead.page_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-semibold text-sky-700 hover:text-sky-900 inline-flex items-center gap-1 shrink-0"
          title="Abrir página de origem"
        >
          Abrir <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  )
}
