"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ChevronRight, Loader2, Phone, ShieldCheck, UsersRound, X } from "lucide-react"
import { toast } from "sonner"
import type { ChatConversation } from "@/types/chat"
import { formatPhoneDisplay } from "@/lib/phone-utils"
import { SimpleSelect } from "@/components/ui/select"
import { SectionCard } from "@/components/ui/section-card"
import { NewContactDialog } from "./new-contact-dialog"
import { ContactPic } from "./contact-pic"
import { ConversationDetailsOverlay } from "./conversation-details-overlay"
import type { GroupSection } from "./group-conversation-actions"
import { getGroupAccessRoster, getGroupParticipants, saveGroupAccess } from "@/lib/actions/groups"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type Roster = Awaited<ReturnType<typeof getGroupAccessRoster>>
type ParticipantData = Awaited<ReturnType<typeof getGroupParticipants>>
type AccessMode = "management" | "number_team" | "selected"

export function GroupConversationTools({ conversation, canManage, initialSection, onClose, onAccessChanged }: {
  conversation: ChatConversation; canManage: boolean; initialSection: GroupSection
  onClose: () => void; onAccessChanged: () => void
}) {
  const [detailsOpen] = useState(initialSection === "details")
  const [participantsOpen, setParticipantsOpen] = useState(initialSection === "participants")
  const [participantData, setParticipantData] = useState<ParticipantData | null>(null)
  const [participantLoading, setParticipantLoading] = useState(false)
  const [participantError, setParticipantError] = useState("")
  const [accessOpen, setAccessOpen] = useState(initialSection === "access" && canManage)
  const [roster, setRoster] = useState<Roster | null>(null)
  const [rosterLoading, setRosterLoading] = useState(false)
  const [savingAccess, setSavingAccess] = useState(false)
  const [accessError, setAccessError] = useState("")
  const [mode, setMode] = useState<AccessMode>(conversation.group_access_mode ?? "management")
  const [userIds, setUserIds] = useState<string[]>(conversation.participants ?? [])
  const [departmentId, setDepartmentId] = useState(conversation.department_id ?? "")
  const [participantSearch, setParticipantSearch] = useState("")
  const [contactPhone, setContactPhone] = useState<string | null>(null)
  const name = conversation.group_name?.trim() || "Grupo do WhatsApp"
  const numberName = conversation.whatsapp_instances?.display_name?.trim() || "WhatsApp"
  const phone = conversation.whatsapp_instances?.phone_number
  const accessLabel = conversation.group_access_mode === "number_team" ? "Equipe do número"
    : conversation.group_access_mode === "selected" ? "Equipe selecionada" : "Somente gestão"

  // Loads only the requested dialog. Cleanup discards responses after revocation,
  // switching conversations or closing the dialog.
  useEffect(() => {
    if (!participantsOpen) return
    let current = true
    getGroupParticipants(conversation.id).then(data => {
      if (current) { setParticipantData(data); setParticipantError(""); setParticipantLoading(false) }
    }).catch(() => { if (current) { setParticipantError("Não foi possível consultar os participantes. Tente novamente."); setParticipantLoading(false) } })
    return () => { current = false }
  }, [participantsOpen, conversation.id])

  useEffect(() => {
    if (!accessOpen || !canManage) return
    let current = true
    getGroupAccessRoster(conversation.id).then(data => {
      if (current) { setRoster(data); setAccessError(""); setRosterLoading(false) }
    }).catch(() => { if (current) { setAccessError("Não foi possível carregar a equipe. Feche e tente novamente."); setRosterLoading(false) } })
    return () => { current = false }
  }, [accessOpen, canManage, conversation.id])

  function openParticipants() {
    setParticipantLoading(true); setParticipantError(""); setParticipantData(null); setParticipantsOpen(true)
  }
  function openAccess() {
    setRosterLoading(true); setAccessError(""); setRoster(null)
    setMode(conversation.group_access_mode ?? "management")
    setUserIds(conversation.participants ?? []); setDepartmentId(conversation.department_id ?? "")
    setAccessOpen(true)
  }
  function closeParticipants() { setParticipantsOpen(false); if (!detailsOpen) onClose() }
  function closeAccess() { if (savingAccess) return; setAccessOpen(false); if (!detailsOpen) onClose() }
  async function saveAccess() {
    setSavingAccess(true); setAccessError("")
    try {
      await saveGroupAccess(conversation.id, { mode, userIds, departmentId: departmentId || null })
      setAccessOpen(false); onAccessChanged()
      if (!detailsOpen) onClose()
      toast.success("Acesso ao grupo atualizado")
    } catch (err) { setAccessError((err as Error).message || "Não foi possível salvar o acesso.") }
    finally { setSavingAccess(false) }
  }
  const search = participantSearch.replace(/\D/g, "")
  const nameSearch = participantSearch.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")
  const filteredParticipants = (participantData?.participants ?? []).filter(p => !nameSearch
    || (!!search && !!p.phone?.includes(search))
    || !!p.contact?.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").includes(nameSearch))

  return <>
    <ConversationDetailsOverlay open={detailsOpen} label="Detalhes do grupo" onClose={onClose}>
      <div className="flex h-full flex-col overflow-y-auto bg-canvas">
        <header className="relative flex flex-col items-center border-b border-slate-200 bg-white px-5 pb-5 pt-6">
          <button type="button" aria-label="Fechar" onClick={onClose} className="absolute left-3 top-3 grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-primary-50 hover:text-primary"><X className="size-4" /></button>
          <div className="mb-3 flex size-16 items-center justify-center overflow-hidden rounded-full bg-primary-50 ring-1 ring-slate-200">
            {conversation.group_picture ? <ContactPic pic={conversation.group_picture} initial={name[0]} imgClass="size-16 object-cover" /> : <UsersRound className="size-7 text-primary" />}
          </div>
          <h2 className="max-w-full break-words text-center text-base font-semibold text-slate-900">{name}</h2>
          <span className="mt-2 rounded bg-primary-50 px-1.5 py-0.5 text-[10px] font-semibold text-primary-700">GRUPO</span>
        </header>
        <div className="space-y-3 p-4">
          <SectionCard title="Número conectado" icon={Phone} bodyClassName="!p-4">
            <p className="text-sm font-medium text-slate-800">{numberName}</p>
            {phone && <p className="mt-1 text-xs text-slate-500">{formatPhoneDisplay(phone)}</p>}
            <p className="mt-2 text-xs leading-relaxed text-slate-500">As respostas são enviadas por este número ao grupo.</p>
          </SectionCard>
          <SectionCard title="Participantes do WhatsApp" icon={UsersRound} bodyClassName="!p-4">
            <p className="text-xs leading-relaxed text-slate-500">Pessoas que fazem parte do grupo no WhatsApp. O cadastro como contato é opcional e manual.</p>
            <button type="button" onClick={openParticipants} className="mt-3 inline-flex w-full items-center justify-between rounded-lg bg-primary-50 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary-100">Ver participantes<ChevronRight className="size-4" /></button>
          </SectionCard>
          <SectionCard title="Equipe com acesso no Kora" icon={ShieldCheck} bodyClassName="!p-4">
            <p className="text-sm font-medium text-slate-800">{accessLabel}</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">Proprietário e administradores acompanham o grupo. Atendentes precisam de acesso ao número e da permissão definida aqui.</p>
            {canManage && <button type="button" onClick={openAccess} className="mt-3 inline-flex w-full items-center justify-between rounded-lg bg-primary-50 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary-100">Gerenciar acesso<ChevronRight className="size-4" /></button>}
          </SectionCard>
          <p className="px-1 text-[11px] leading-relaxed text-slate-500">O acesso no Kora permite ler o histórico e responder. Ele não adiciona pessoas ao grupo do WhatsApp.</p>
        </div>
      </div>
    </ConversationDetailsOverlay>
    <Dialog open={participantsOpen} onOpenChange={open => { if (!open) closeParticipants() }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Participantes do WhatsApp</DialogTitle><DialogDescription>Lista consultada no grupo. Ninguém é cadastrado automaticamente como contato.</DialogDescription></DialogHeader>
        {participantError ? <p role="alert" className="rounded-lg bg-danger-bg p-3 text-sm text-danger">{participantError}</p>
          : participantLoading || !participantData ? <div role="status" className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="size-4 animate-spin text-primary" />Consultando participantes…</div> : <>
            <input value={participantSearch} onChange={e => setParticipantSearch(e.target.value)} aria-label="Buscar participantes por nome ou telefone" placeholder="Buscar por nome ou telefone" className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary" />
            <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {filteredParticipants.length === 0 && <p className="p-4 text-center text-xs text-slate-500">Nenhum participante encontrado.</p>}
              {filteredParticipants.map(p => <div key={p.jid} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900">{p.contact?.name || (p.phone ? formatPhoneDisplay(p.phone) : "Telefone não disponível")}</p>
                  {p.contact && p.phone && <p className="mt-0.5 text-xs text-slate-500">{formatPhoneDisplay(p.phone)}</p>}
                  {!p.phone && <p className="text-[11px] text-slate-500">Identificador protegido pelo WhatsApp</p>}
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {p.contact && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">Já cadastrado</span>}
                    {p.contactAmbiguous && <span className="text-[11px] text-amber-700">Mais de um cadastro com este telefone</span>}
                    {p.isAdmin && <span className="rounded bg-primary-50 px-1.5 py-0.5 text-[10px] font-medium text-primary-700">Admin do grupo</span>}
                  </div>
                </div>
                {p.contact ? <Link href={`/contatos/${p.contact.id}`} className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary-50">Abrir contato</Link>
                  : canManage && p.phone && !p.contactAmbiguous && <button type="button" onClick={() => { setParticipantsOpen(false); setContactPhone(`+${p.phone}`) }} className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary-50">Cadastrar</button>}
              </div>)}
            </div>
            <p className="text-xs text-slate-500">{participantData.participants.length} participantes disponíveis</p>
          </>}
      </DialogContent>
    </Dialog>
    {contactPhone !== null && <NewContactDialog key={contactPhone} initialPhone={contactPhone} onClose={() => { setContactPhone(null); if (!detailsOpen) onClose() }} />}
    <Dialog open={accessOpen && canManage} onOpenChange={open => { if (!open) closeAccess() }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Acesso da equipe no Kora</DialogTitle><DialogDescription>A permissão inclui o histórico disponível e permite responder ao grupo pelo número {numberName}.</DialogDescription></DialogHeader>
        {accessError && <p role="alert" className="rounded-lg bg-danger-bg p-3 text-sm text-danger">{accessError}</p>}
        {!accessError && (rosterLoading || !roster) ? <div role="status" className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="size-4 animate-spin text-primary" />Carregando equipe…</div> : roster && <fieldset disabled={savingAccess} className="space-y-3">
          {([["management", "Somente gestão", "Proprietário e administradores acompanham o grupo."], ["number_team", "Equipe do número", "Todos os atendentes com acesso a este número."], ["selected", "Selecionar pessoas ou departamento", "Compartilhe apenas com a equipe escolhida."]] as const).map(([value, label, description]) => <label key={value} className={"flex cursor-pointer gap-3 rounded-xl border p-3 " + (mode === value ? "border-primary bg-primary-50" : "border-slate-200 hover:border-primary-200")}><input type="radio" name="group-access" checked={mode === value} onChange={() => setMode(value)} className="mt-1 accent-primary" /><span><span className="block text-sm font-semibold text-slate-800">{label}</span><span className="text-xs text-slate-500">{description}</span></span></label>)}
          {mode === "selected" && <div className="space-y-3 rounded-xl border border-slate-200 p-3">
            <div className="space-y-1"><p className="text-xs font-medium text-slate-600">Departamento</p><SimpleSelect value={departmentId} onChange={setDepartmentId} options={[{ value: "", label: "Nenhum" }, ...roster.departments.map(d => ({ value: d.id, label: d.name }))]} ariaLabel="Departamento com acesso ao grupo" /></div>
            <div className="max-h-36 space-y-1 overflow-y-auto"><p className="text-xs font-medium text-slate-600">Atendentes</p>{roster.members.map(m => <label key={m.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-primary-50"><input type="checkbox" checked={userIds.includes(m.id)} disabled={!m.canUseNumber} onChange={e => setUserIds(prev => e.target.checked ? [...prev, m.id] : prev.filter(id => id !== m.id))} className="accent-primary" /><span className={m.canUseNumber ? "text-slate-700" : "text-slate-400"}>{m.name}{!m.canUseNumber ? " · sem acesso ao número" : ""}</span></label>)}</div>
          </div>}
          {mode !== "management" && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{roster.members.filter(m => m.canUseNumber && (mode === "number_team" || userIds.includes(m.id) || (!!departmentId && m.departmentId === departmentId))).length} atendentes poderão visualizar e responder. O acesso ao número continua obrigatório.</p>}
        </fieldset>}
        <DialogFooter><button type="button" disabled={savingAccess} onClick={closeAccess} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancelar</button><button type="button" onClick={() => void saveAccess()} disabled={!roster || rosterLoading || savingAccess || (mode === "selected" && !departmentId && userIds.length === 0)} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-40">{savingAccess ? "Salvando…" : "Salvar acesso"}</button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
