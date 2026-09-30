"use client"

import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Info, Loader2, Send, UsersRound } from "lucide-react"
import { toast } from "sonner"
import type { ChatConversation, ChatMessage } from "@/types/chat"
import { formatPhoneDisplay } from "@/lib/phone-utils"
import { ContactPic } from "./contact-pic"
import { AgentSignatureHint } from "./agent-signature-hint"
import { MessageBubble } from "./message-bubble"
import { buildTimelineGroups, DateDivider } from "./timeline-divider"
import { ConversationActionsButton, useConversationWorkflow } from "./conversation-workflow"
import { groupConversationActions, type GroupSection } from "./group-conversation-actions"

interface Props {
  conversation: ChatConversation; messages: ChatMessage[]; currentUserId: string; canManage: boolean
  hasMoreOlder: boolean; loadingOlder: boolean; loadingMessages: boolean
  onLoadOlder: () => void; onSendText: (text: string) => Promise<void>; onBack: () => void
  onOpenTools: (section: GroupSection) => void
}
function senderName(message: ChatMessage): string {
  if (message.sender_type !== "contact") return message.profiles?.full_name || "Equipe"
  const name = message.metadata?.group_push_name
  if (typeof name === "string" && name.trim()) return name.trim()
  if (message.group_participant_jid?.endsWith("@s.whatsapp.net")) return formatPhoneDisplay(message.group_participant_jid.split("@")[0])
  return "Participante"
}
export function GroupChatPanel({ conversation, messages, currentUserId, canManage,
  hasMoreOlder, loadingOlder, loadingMessages, onLoadOlder, onSendText, onBack, onOpenTools }: Props) {
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prior = useRef({ first: "", last: "", height: 0, top: 0, nearBottom: true })
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const workflow = useConversationWorkflow()
  const name = conversation.group_name?.trim() || "Grupo do WhatsApp"
  const numberName = conversation.whatsapp_instances?.display_name?.trim()
    || conversation.whatsapp_instances?.phone_number || "Número conectado"
  const actions = groupConversationActions(canManage, onOpenTools)
  const timeline = useMemo(() => buildTimelineGroups(messages), [messages])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !messages.length) return
    const first = messages[0].id, last = messages[messages.length - 1].id
    if (prior.current.first && first !== prior.current.first && last === prior.current.last) {
      el.scrollTop = prior.current.top + el.scrollHeight - prior.current.height
    } else if (!prior.current.last || prior.current.nearBottom || messages[messages.length - 1].sender_id === currentUserId) {
      el.scrollTop = el.scrollHeight
    }
    prior.current = { first, last, height: el.scrollHeight, top: el.scrollTop,
      nearBottom: el.scrollHeight - el.scrollTop - el.clientHeight < 100 }
  }, [messages, currentUserId])

  async function send() {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true); setDraft("")
    try { await onSendText(text) }
    catch (err) { setDraft(text); toast.error((err as Error).message || "Não foi possível enviar ao grupo") }
    finally { setSending(false); composerRef.current?.focus() }
  }
  function messageMenu(message: ChatMessage, position: { x: number; y: number }, origin?: HTMLElement) {
    workflow?.menu(conversation, { clientX: position.x, clientY: position.y,
      currentTarget: origin ?? document.activeElement as HTMLElement,
      preventDefault: () => {}, stopPropagation: () => {} }, [
      ...(message.content ? [{ label: "Copiar mensagem", run: () => { void navigator.clipboard.writeText(message.content!).then(() => toast.success("Mensagem copiada")).catch(() => toast.error("Não foi possível copiar a mensagem.")) } }] : []),
      ...actions,
    ])
  }
  return <div className="flex h-full min-w-0 flex-col bg-canvas">
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" onClick={onBack} aria-label="Voltar às conversas" className="md:hidden rounded-lg p-2 text-slate-500 hover:bg-primary-50 hover:text-primary"><ArrowLeft className="size-5" /></button>
        <button type="button" onClick={() => onOpenTools("details")} aria-label="Abrir detalhes do grupo" className="flex min-w-0 items-center gap-3 rounded-lg text-left focus-visible:ring-2 focus-visible:ring-primary">
          <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-50 text-primary">
            {conversation.group_picture ? <ContactPic pic={conversation.group_picture} initial={name[0]} imgClass="size-10 object-cover" /> : <UsersRound className="size-5" />}
          </span>
          <span className="min-w-0"><span className="flex items-center gap-2"><span className="truncate text-sm font-semibold text-slate-900">{name}</span><span className="shrink-0 rounded bg-primary-50 px-1.5 py-0.5 text-[9px] font-semibold text-primary-700">GRUPO</span></span><span className="block truncate text-xs text-slate-500">Via {numberName}</span></span>
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={() => onOpenTools("details")} aria-label="Detalhes do grupo" title="Detalhes do grupo" className="inline-flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-primary-50 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"><Info className="size-4" /></button>
        <ConversationActionsButton conversation={conversation} extras={actions} />
      </div>
    </header>
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 sm:px-6" aria-label={"Mensagens de " + name}
      onScroll={e => { const el = e.currentTarget; prior.current.top = el.scrollTop; prior.current.height = el.scrollHeight; prior.current.nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100 }}
      onContextMenu={e => workflow?.menu(conversation, e, actions)}>
      {hasMoreOlder && <div className="mb-3 text-center"><button type="button" onClick={onLoadOlder} disabled={loadingOlder} className="rounded-lg px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary-50 disabled:opacity-50">{loadingOlder ? "Carregando…" : "Carregar mensagens anteriores"}</button></div>}
      {loadingMessages && messages.length === 0 && <p role="status" className="text-center text-xs text-slate-500">Carregando mensagens…</p>}
      {!loadingMessages && messages.length === 0 && <p className="py-12 text-center text-sm text-slate-500">As mensagens do grupo aparecerão aqui.</p>}
      {timeline.map(day => <Fragment key={day.id}><DateDivider label={day.dateLabel} /><div className="space-y-3">{day.items.map(item => {
        if (item.kind !== "message") return null
        const message = item.msg
        const display = message.metadata?.group_media_pending ? { ...message, content_type: "text" as const,
          content: "Mídia recebida no grupo; consulte no WhatsApp." + (message.content ? "\n" + message.content : "") } : message
        return <MessageBubble key={message.id} message={display} senderLabel={senderName(message)}
          agentName={message.sender_id === currentUserId ? "Você" : senderName(message)}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); messageMenu(message, { x: e.clientX, y: e.clientY }, e.currentTarget as HTMLElement) }}
          onOpenMenu={(_, position) => messageMenu(message, position)} />
      })}</div></Fragment>)}
    </div>
    <AgentSignatureHint conversationId={conversation.id} />
    <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-3 sm:px-5">
      <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10">
        <textarea ref={composerRef} value={draft} disabled={sending} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }}
          rows={1} maxLength={4096} placeholder="Mensagem para o grupo" aria-label="Mensagem para o grupo"
          className="max-h-36 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 disabled:opacity-60" />
        <button type="button" onClick={() => void send()} disabled={!draft.trim() || sending} aria-label="Enviar mensagem ao grupo" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-white hover:bg-primary-700 disabled:opacity-40">{sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}</button>
      </div>
    </div>
  </div>
}
