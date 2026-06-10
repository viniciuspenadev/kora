"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { MessageBubble } from "./message-bubble"
import { MessageInput } from "./message-input"
import { formatPhoneDisplay } from "@/lib/phone-utils"
import { lifecycleMeta } from "@/lib/lifecycle"
import { displayContactName, displayContactInitial } from "@/lib/contact"
import {
  Phone, CheckCircle2, Clock, XCircle,
  MoreVertical, RotateCcw, Moon, Users, Loader2, Megaphone, ExternalLink, Archive, ArchiveRestore,
  ArrowLeft, Info,
} from "lucide-react"
import { SourceChip } from "@/components/chat/source-chip"
import { AgentAvatar } from "@/components/chat/agent-avatar"
import { TransferDialog, type TransferOpts } from "@/components/chat/transfer-dialog"
import { ArrowLeftRight } from "lucide-react"
import { buildTimelineGroups, TimelineDivider, DateDivider } from "@/components/chat/timeline-divider"
import type { ChatMessage, ChatConversation, ChatQuickReply, ExternalAdReply } from "@/types/chat"
import { sanitizeAdReply } from "@/lib/ad-reply"
import { PlatformIcon, getPlatformMeta } from "@/components/ui/platform-icon"

interface Props {
  conversation: ChatConversation
  messages:     ChatMessage[]
  quickReplies: ChatQuickReply[]
  agents:       Array<{ id: string; full_name: string | null; department_id?: string | null }>
  departments:  Array<{ id: string; name: string; color: string }>
  onStatusChange: (status: string) => void
  onTransfer:     (opts: TransferOpts) => Promise<void>
  // Paginação de mensagens antigas (scroll-up)
  hasMoreOlder?:  boolean
  loadingOlder?:  boolean
  onLoadOlder?:   () => void
  /** Carga inicial das mensagens ao abrir a conversa → mostra skeleton. */
  loadingMessages?: boolean
  // Envio otimista — orquestrado em InboxClient
  onSendText:     (content: string, isPrivate: boolean) => Promise<void>
  onSendMedia:    (file: File, caption: string) => Promise<void>
  onSendVoice:    (file: File) => Promise<void>
  /** Responder/citar uma mensagem (define o alvo no composer). */
  onReply?:        (msg: ChatMessage) => void
  /** Reagir a uma mensagem com um emoji. */
  onReact?:        (msg: ChatMessage, emoji: string) => void
  /** Enviar localização (pin). */
  onSendLocation?: (loc: { latitude: number; longitude: number; name?: string; address?: string }) => Promise<void>
  /** Compartilhar contato (vCard). */
  onSendContact?:  (card: { name: string; phone: string }) => Promise<void>
  /** Enviar figurinha (webp). */
  onSendSticker?:  (file: File) => Promise<void>
  /** Mensagem citada ativa no composer (id = whatsapp_msg_id). */
  replyTarget?:    { id: string; preview: string; kind: string | null } | null
  onCancelReply?:  () => void
  onArchiveToggle: () => void
  /** Mobile (<md): volta pra lista de conversas. */
  onBack?:         () => void
  /** Mobile (<md): abre a ficha do contato (sheet). */
  onOpenContact?:  () => void
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

// Placeholder da thread enquanto a 1ª página de mensagens carrega (~130ms).
// Bolhas de larguras/lados variados pra parecer uma conversa real — evita o
// flash de "Nenhuma mensagem" no clique.
const SKELETON_ROWS = [
  { side: "left",  w: "w-40" }, { side: "left",  w: "w-56" },
  { side: "right", w: "w-48" }, { side: "left",  w: "w-32" },
  { side: "right", w: "w-60" }, { side: "right", w: "w-36" },
] as const

function MessageSkeleton() {
  return (
    <div className="space-y-3 py-2" aria-hidden="true">
      {SKELETON_ROWS.map((r, i) => (
        <div key={i} className={`flex ${r.side === "right" ? "justify-end" : "justify-start"}`}>
          <div
            className={`h-10 ${r.w} max-w-[70%] rounded-2xl bg-slate-200/70 animate-pulse ${
              r.side === "right" ? "rounded-br-sm" : "rounded-bl-sm"
            }`}
          />
        </div>
      ))}
    </div>
  )
}

export function ChatPanel({
  conversation, messages, quickReplies, agents, departments, onStatusChange, onTransfer,
  hasMoreOlder = false, loadingOlder = false, onLoadOlder,
  loadingMessages = false,
  onSendText, onSendMedia, onSendVoice, onArchiveToggle,
  onReply, onReact, onSendLocation, onSendContact, onSendSticker, replyTarget, onCancelReply,
  onBack, onOpenContact,
}: Props) {
  const isArchived = !!conversation.archived_at
  // Menu de ações (kebab) por clique — funciona em desktop e mobile (toque).
  const [menuOpen, setMenuOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
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

  // Reações NÃO são entradas da timeline — colam na bolha-alvo (igual WhatsApp).
  // Separa as mensagens de reação, monta um mapa por whatsapp_msg_id-alvo e
  // colapsa pra ÚLTIMA reação de cada lado (cliente vs nós); emoji vazio = removida.
  const { timelineMessages, reactionsByTarget } = useMemo(() => {
    const normal: ChatMessage[] = []
    const latestPerSide = new Map<string, Map<"contact" | "agent", ChatMessage>>()
    for (const m of messages) {
      if (m.content_type !== "reaction") { normal.push(m); continue }
      const target = (m.metadata as { reacted_to_id?: string } | null)?.reacted_to_id
      if (!target) continue
      const side: "contact" | "agent" = m.sender_type === "contact" ? "contact" : "agent"
      const cur = latestPerSide.get(target)?.get(side)
      if (!cur || new Date(m.created_at) >= new Date(cur.created_at)) {
        if (!latestPerSide.has(target)) latestPerSide.set(target, new Map())
        latestPerSide.get(target)!.set(side, m)
      }
    }
    const map = new Map<string, { emoji: string; fromAgent: boolean }[]>()
    for (const [target, sides] of latestPerSide) {
      const arr: { emoji: string; fromAgent: boolean }[] = []
      for (const [side, m] of sides) {
        const emoji = (m.content ?? "").trim()
        if (emoji) arr.push({ emoji, fromAgent: side === "agent" })
      }
      if (arr.length) map.set(target, arr)
    }
    return { timelineMessages: normal, reactionsByTarget: map }
  }, [messages])

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
      <div className="flex items-center justify-between px-3 sm:px-5 py-3 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Voltar para conversas"
              className="md:hidden -ml-1 size-9 shrink-0 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
            >
              <ArrowLeft className="size-5" />
            </button>
          )}
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
                  {/* Status atual — só aparece quando NÃO é "Aberto" (estado normal não polui). */}
                  {conversation.status !== "open" && (
                    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${currentStatus.color}`}>
                      <currentStatus.icon className="size-2.5" /> {currentStatus.label}
                    </span>
                  )}
                  {/* Janela de 24h (só oficial) — movida do cluster de ações pra cá, alivia a barra. */}
                  {isOfficial && (windowOpen ? (
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${windowMsLeft! < 2 * 60 * 60 * 1000 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}
                      title="Janela de atendimento de 24h (WhatsApp Oficial). Dentro dela você responde com texto livre."
                    >
                      <Clock className="size-2.5" /> {fmtWindowLeft(windowMsLeft!)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500" title="Fora da janela de 24h — só dá pra enviar um template aprovado.">
                      <Clock className="size-2.5" /> Janela fechada
                    </span>
                  ))}
                  {/* Atribuída a (md+) — antes vinha do botão Transferir, que foi pro menu ⋮. */}
                  {conversation.assigned_to && (
                    <span className="hidden md:inline-flex items-center gap-1 text-[11px] text-slate-500">
                      <AgentAvatar userId={conversation.assigned_to} name={conversation.profiles?.full_name} className="size-3.5" />
                      <span className="truncate max-w-[110px]">{conversation.profiles?.full_name ?? "Atribuída"}</span>
                    </span>
                  )}
                  {/* Secundárias (lifecycle + origem): só no desktop — no mobile estão na ficha "i". */}
                  <span
                    className={`hidden md:inline text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${lc.bg} ${lc.text}`}
                    title={lc.label}
                  >
                    {lc.icon} {lc.label}
                  </span>
                  {channelSource && (
                    <span className="hidden md:inline-flex">
                      <SourceChip source={channelSource} className="text-[10px]" />
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Ação primária — Concluir (encerra) ou Reabrir se já resolvida.
              É o CTA que dispara o ciclo resolve→reopen→IA da Política de Atendimento. */}
          {conversation.status === "resolved" ? (
            <button
              type="button"
              onClick={() => onStatusChange("open")}
              title="Reabrir o atendimento"
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
            >
              <RotateCcw className="size-3.5" /> Reabrir
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onStatusChange("resolved")}
              title="Concluir o atendimento (encerra a conversa)"
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
            >
              <CheckCircle2 className="size-3.5" /> Concluir
            </button>
          )}

          {/* Menu de ações secundárias — acessível em QUALQUER tela (fim do buraco
              de Transferir/Arquivar sumirem no mobile). */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Mais ações"
              className="size-8 inline-flex items-center justify-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
            >
              <MoreVertical className="size-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 bg-white rounded-lg border border-slate-200 shadow-lg py-1 min-w-[188px] z-20">
                  <button
                    type="button"
                    onClick={() => { setTransferOpen(true); setMenuOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <ArrowLeftRight className="size-3.5 shrink-0 text-slate-400" /> Transferir
                  </button>

                  {conversation.status !== "snoozed" && (
                    <button
                      type="button"
                      onClick={() => { onStatusChange("snoozed"); setMenuOpen(false) }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <Moon className="size-3.5 shrink-0 text-slate-400" /> Adiar
                    </button>
                  )}
                  {conversation.status !== "pending" && (
                    <button
                      type="button"
                      onClick={() => { onStatusChange("pending"); setMenuOpen(false) }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <Clock className="size-3.5 shrink-0 text-slate-400" /> Marcar pendente
                    </button>
                  )}
                  {(conversation.status === "snoozed" || conversation.status === "pending") && (
                    <button
                      type="button"
                      onClick={() => { onStatusChange("open"); setMenuOpen(false) }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <RotateCcw className="size-3.5 shrink-0 text-slate-400" /> Reabrir
                    </button>
                  )}

                  <div className="my-1 border-t border-slate-100" />

                  <button
                    type="button"
                    onClick={() => { onArchiveToggle(); setMenuOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    {isArchived ? <ArchiveRestore className="size-3.5 shrink-0 text-amber-600" /> : <Archive className="size-3.5 shrink-0 text-slate-400" />}
                    {isArchived ? "Restaurar" : "Arquivar"}
                  </button>

                  {/* Mobile: ver a ficha do contato (no desktop ela é coluna fixa). */}
                  {onOpenContact && (
                    <button
                      type="button"
                      onClick={() => { onOpenContact(); setMenuOpen(false) }}
                      className="md:hidden w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <Info className="size-3.5 shrink-0 text-slate-400" /> Ver contato
                    </button>
                  )}
                </div>
              </>
            )}
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
        {loadingMessages && messages.length === 0 ? (
          <MessageSkeleton />
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Phone className="size-10 text-slate-200 mb-3" />
            <p className="text-sm font-medium text-slate-500 mb-1">Nenhuma mensagem</p>
            <p className="text-xs text-slate-400">As mensagens aparecerão aqui quando o contato enviar algo.</p>
          </div>
        ) : (
          buildTimelineGroups(timelineMessages).map((group) => (
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
                    reactions={item.msg.whatsapp_msg_id ? reactionsByTarget.get(item.msg.whatsapp_msg_id) : undefined}
                    onReply={onReply}
                    onReact={onReact}
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
        onSendLocation={onSendLocation}
        onSendContact={onSendContact}
        onSendSticker={onSendSticker}
        replyTarget={replyTarget}
        onCancelReply={onCancelReply}
      />

      <TransferDialog
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        departments={departments}
        agents={agents}
        currentAssignedTo={conversation.assigned_to}
        onTransfer={onTransfer}
      />
    </div>
  )
}

/**
 * Banner compacto no topo do chat avisando que a conversa veio de um anúncio
 * Meta (Click-to-WhatsApp). Sempre visível enquanto a conv tá aberta — útil
 * pro atendente saber o contexto sem precisar abrir a sidebar.
 */
function AdSourceBanner({ ad: adRaw }: { ad: ExternalAdReply | null }) {
  const [thumbBroken, setThumbBroken] = useState(false)

  const ad = sanitizeAdReply(adRaw)
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
