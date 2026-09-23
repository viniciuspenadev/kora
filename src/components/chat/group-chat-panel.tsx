"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Loader2, Send, ShieldCheck, UsersRound } from "lucide-react"
import { toast } from "sonner"
import type { ChatConversation, ChatMessage } from "@/types/chat"
import { formatPhoneDisplay } from "@/lib/phone-utils"
import { SimpleSelect } from "@/components/ui/select"
import { NewContactDialog } from "@/components/chat/new-contact-dialog"
import { getGroupAccessRoster, getGroupParticipants, saveGroupAccess } from "@/lib/actions/groups"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"

type Roster = Awaited<ReturnType<typeof getGroupAccessRoster>>
type ParticipantData = Awaited<ReturnType<typeof getGroupParticipants>>
type AccessMode = "management" | "number_team" | "selected"

interface Props {
  conversation: ChatConversation
  messages: ChatMessage[]
  currentUserId: string
  canManage: boolean
  hasMoreOlder: boolean
  loadingOlder: boolean
  loadingMessages: boolean
  onLoadOlder: () => void
  onSendText: (text: string) => Promise<void>
  onBack: () => void
  onAccessChanged: () => void
}

function senderName(message: ChatMessage): string {
  if (message.sender_type !== "contact") {
    return message.metadata?.via_celular ? "Enviado pelo celular" : message.profiles?.full_name || "Equipe"
  }
  const pushName = message.metadata?.group_push_name
  if (typeof pushName === "string" && pushName.trim()) return pushName.trim()
  if (message.group_participant_jid?.endsWith("@s.whatsapp.net")) {
    return formatPhoneDisplay(message.group_participant_jid.split("@")[0])
  }
  return "Participante"
}

export function GroupChatPanel({ conversation, messages, currentUserId, canManage,
  hasMoreOlder, loadingOlder, loadingMessages, onLoadOlder, onSendText, onBack, onAccessChanged }: Props) {
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [participantsOpen, setParticipantsOpen] = useState(false)
  const [participantData, setParticipantData] = useState<ParticipantData | null>(null)
  const [participantLoading, setParticipantLoading] = useState(false)
  const [accessOpen, setAccessOpen] = useState(false)
  const [roster, setRoster] = useState<Roster | null>(null)
  const [rosterLoading, setRosterLoading] = useState(false)
  const [savingAccess, setSavingAccess] = useState(false)
  const [mode, setMode] = useState<AccessMode>(conversation.group_access_mode ?? "management")
  const [userIds, setUserIds] = useState<string[]>(conversation.participants ?? [])
  const [departmentId, setDepartmentId] = useState(conversation.department_id ?? "")
  const [participantSearch, setParticipantSearch] = useState("")
  const [contactPhone, setContactPhone] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const name = conversation.group_name?.trim() || "Grupo do WhatsApp"
  const numberName = conversation.whatsapp_instances?.display_name?.trim()
    || conversation.whatsapp_instances?.phone_number || "Número conectado"

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }) }, [conversation.id, messages.length])

  async function send() {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setDraft("")
    try { await onSendText(text) }
    catch (err) { setDraft(text); toast.error((err as Error).message || "Não foi possível enviar ao grupo") }
    finally { setSending(false) }
  }

  async function openParticipants() {
    setParticipantsOpen(true)
    setParticipantLoading(true)
    setParticipantData(null)
    try { setParticipantData(await getGroupParticipants(conversation.id)) }
    catch (err) { toast.error((err as Error).message) }
    finally { setParticipantLoading(false) }
  }

  async function openAccess() {
    setAccessOpen(true)
    setRosterLoading(true)
    setMode(conversation.group_access_mode ?? "management")
    setUserIds(conversation.participants ?? [])
    setDepartmentId(conversation.department_id ?? "")
    try { setRoster(await getGroupAccessRoster(conversation.id)) }
    catch (err) { toast.error((err as Error).message); setAccessOpen(false) }
    finally { setRosterLoading(false) }
  }

  async function saveAccess() {
    setSavingAccess(true)
    try {
      await saveGroupAccess(conversation.id, { mode, userIds, departmentId: departmentId || null })
      setAccessOpen(false)
      toast.success("Acesso ao grupo atualizado")
      onAccessChanged()
    } catch (err) { toast.error((err as Error).message) }
    finally { setSavingAccess(false) }
  }

  const filteredParticipants = (participantData?.participants ?? []).filter(p => {
    const label = p.phone ?? p.jid.slice(-12)
    return label.includes(participantSearch.trim())
  })

  return <div className="flex h-full min-w-0 flex-col bg-slate-50">
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" onClick={onBack} aria-label="Voltar às conversas" className="md:hidden rounded-lg p-2 text-slate-500 hover:bg-primary-50 hover:text-primary"><ArrowLeft className="size-5" /></button>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary"><UsersRound className="size-5" /></span>
        <div className="min-w-0">
          <div className="flex items-center gap-2"><h2 className="truncate text-sm font-semibold text-slate-900">{name}</h2><span className="rounded bg-primary-50 px-1.5 py-0.5 text-[9px] font-semibold text-primary-700">GRUPO</span></div>
          <p className="truncate text-xs text-slate-500">Via {numberName}{conversation.group_access_mode === "management" ? " · Somente gestão" : ""}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={openParticipants} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-primary-50 hover:text-primary" title="Ver participantes"><UsersRound className="size-4" /><span className="hidden sm:inline">Participantes</span></button>
        {canManage && <button type="button" onClick={openAccess} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-primary-50 hover:text-primary" title="Quem pode acessar"><ShieldCheck className="size-4" /><span className="hidden sm:inline">Acesso</span></button>}
      </div>
    </header>

    <div className="flex-1 space-y-3 overflow-y-auto px-4 py-5 sm:px-6" aria-label={`Mensagens de ${name}`}>
      {hasMoreOlder && <div className="text-center"><button type="button" onClick={onLoadOlder} disabled={loadingOlder} className="rounded-lg px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary-50 disabled:opacity-50">{loadingOlder ? "Carregando…" : "Carregar mensagens anteriores"}</button></div>}
      {loadingMessages && messages.length === 0 && <p className="text-center text-xs text-slate-500">Carregando mensagens…</p>}
      {!loadingMessages && messages.length === 0 && <p className="py-12 text-center text-sm text-slate-500">As mensagens do grupo aparecerão aqui.</p>}
      {messages.map(message => {
        const own = message.sender_type !== "contact"
        const mediaPending = message.metadata?.group_media_pending === true
        return <div key={message.id} className={`flex ${own ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 shadow-sm sm:max-w-[70%] ${own ? "rounded-br-md bg-primary text-white" : "rounded-bl-md bg-white text-slate-800 ring-1 ring-slate-200"}`}>
            <p className={`mb-1 text-[11px] font-semibold ${own ? "text-white/80" : "text-primary-700"}`}>{own && message.sender_id === currentUserId ? "Você" : senderName(message)}</p>
            <p className="whitespace-pre-wrap break-words text-sm">{mediaPending ? "Mídia recebida no grupo; consulte no WhatsApp." : message.content || `[${message.content_type}]`}</p>
            <p className={`mt-1 text-right text-[10px] ${own ? "text-white/70" : "text-slate-400"}`}>{new Date(message.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}{message.status === "failed" ? " · Falhou" : ""}</p>
          </div>
        </div>
      })}
      <div ref={bottomRef} />
    </div>

    <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-3 sm:px-5">
      <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10">
        <textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send() } }} rows={1} maxLength={4096} placeholder="Mensagem para o grupo" aria-label="Mensagem para o grupo" className="max-h-36 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-400" />
        <button type="button" onClick={() => void send()} disabled={!draft.trim() || sending} aria-label="Enviar mensagem ao grupo" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-white hover:bg-primary-700 disabled:opacity-40">{sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}</button>
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-slate-400">Neste primeiro estágio, o envio ao grupo aceita texto.</p>
    </div>

    <Dialog open={participantsOpen} onOpenChange={setParticipantsOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Participantes do grupo</DialogTitle><DialogDescription>Lista consultada no WhatsApp. Ninguém é cadastrado automaticamente como contato.</DialogDescription></DialogHeader>
        {participantLoading ? <p className="py-8 text-center text-sm text-slate-500">Consultando participantes…</p> : <>
          <input value={participantSearch} onChange={e => setParticipantSearch(e.target.value)} placeholder="Buscar por número ou ID" className="h-10 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary" />
          <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {filteredParticipants.length === 0 && <p className="p-4 text-center text-xs text-slate-500">Nenhum participante encontrado.</p>}
            {filteredParticipants.map(p => <div key={p.jid} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm"><div className="min-w-0"><p className="truncate font-medium text-slate-700">{p.phone ? formatPhoneDisplay(p.phone) : "Telefone não disponível"}</p>{!p.phone && <p className="text-[11px] text-slate-400">Identificador protegido pelo WhatsApp</p>}</div><div className="flex shrink-0 items-center gap-2">{p.isAdmin && <span className="text-[10px] font-medium text-primary-700">Admin</span>}{canManage && <button type="button" onClick={() => { setParticipantsOpen(false); setContactPhone(p.phone ?? "") }} className="rounded-md px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary-50">Cadastrar</button>}</div></div>)}
          </div>
          <p className="text-xs text-slate-500">{participantData?.participants.length ?? 0} participantes disponíveis</p>
          {canManage && <p className="text-[11px] text-slate-500">Cadastro manual, com verificação de duplicidade. Um telefone digitado para identificador protegido não cria vínculo automático com ele.</p>}
        </>}
      </DialogContent>
    </Dialog>
    {contactPhone !== null && <NewContactDialog key={contactPhone} initialPhone={contactPhone} onClose={() => setContactPhone(null)} />}

    <Dialog open={accessOpen} onOpenChange={setAccessOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>Quem pode acessar este grupo?</DialogTitle><DialogDescription>A permissão inclui todo o histórico disponível e permite responder pelo número {numberName}.</DialogDescription></DialogHeader>
        {rosterLoading ? <p className="py-8 text-center text-sm text-slate-500">Carregando equipe…</p> : roster && <div className="space-y-3">
          {([["management", "Somente gestão", "Owner e admins acompanham o grupo."], ["number_team", "Equipe do número", "Todos os atendentes com acesso a este número."], ["selected", "Selecionar pessoas ou departamento", "Compartilhe apenas com a equipe escolhida."]] as const).map(([value, label, description]) => <label key={value} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${mode === value ? "border-primary bg-primary-50" : "border-slate-200 hover:border-primary-200"}`}><input type="radio" name="group-access" checked={mode === value} onChange={() => setMode(value)} className="mt-1 accent-primary" /><span><span className="block text-sm font-semibold text-slate-800">{label}</span><span className="text-xs text-slate-500">{description}</span></span></label>)}
          {mode === "number_team" && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{roster.members.filter(m => m.canUseNumber).length} atendentes poderão visualizar este grupo.</p>}
          {mode === "selected" && <div className="space-y-3 rounded-xl border border-slate-200 p-3">
            <div className="space-y-1"><p className="text-xs font-medium text-slate-600">Departamento</p><SimpleSelect value={departmentId} onChange={setDepartmentId} options={[{ value: "", label: "Nenhum" }, ...roster.departments.map(d => ({ value: d.id, label: d.name }))]} ariaLabel="Departamento com acesso ao grupo" /></div>
            <div className="max-h-36 space-y-1 overflow-y-auto"><p className="text-xs font-medium text-slate-600">Atendentes</p>{roster.members.map(m => <label key={m.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"><input type="checkbox" checked={userIds.includes(m.id)} disabled={!m.canUseNumber} onChange={e => setUserIds(prev => e.target.checked ? [...prev, m.id] : prev.filter(id => id !== m.id))} className="accent-primary" /><span className={m.canUseNumber ? "text-slate-700" : "text-slate-400"}>{m.name}{!m.canUseNumber ? " · sem acesso ao número" : ""}</span></label>)}</div>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{roster.members.filter(m => m.canUseNumber && (userIds.includes(m.id) || (!!departmentId && m.departmentId === departmentId))).length} atendentes poderão visualizar este grupo. O acesso ao número continua obrigatório.</p>
          </div>}
        </div>}
        <DialogFooter><button type="button" onClick={() => setAccessOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancelar</button><button type="button" onClick={() => void saveAccess()} disabled={rosterLoading || savingAccess || (mode === "selected" && !departmentId && userIds.length === 0)} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-40">{savingAccess ? "Salvando…" : "Salvar acesso"}</button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}
