"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Search, UserPlus, Users, X } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { AgentAvatar } from "./agent-avatar"
import { addParticipant, getConversationParticipants, removeParticipant } from "@/lib/actions/conversation-participants"

type Data = Awaited<ReturnType<typeof getConversationParticipants>>
export function ParticipantsDialog({ conversationId, onClose, onChanged }: {
  conversationId: string
  onClose: () => void
  onChanged: (ids: string[], stillVisible: boolean) => void
}) {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [search, setSearch] = useState("")
  const [pending, setPending] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const busy = useRef(false)
  useEffect(() => {
    let alive = true
    setLoading(true); setError(""); setData(null); setRemoving(null)
    getConversationParticipants(conversationId).then(result => { if (alive) setData(result) })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : "Não foi possível carregar os convidados.") })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [conversationId, revision])

  async function change(id: string, add: boolean) {
    if (busy.current || !data) return
    busy.current = true; setPending(id); setError(""); setNotice("")
    try {
      const result = await (add ? addParticipant : removeParticipant)(conversationId, id)
      setData(current => current ? { ...current, participants: result.participants } : current)
      setRemoving(null)
      setNotice(result.warning ?? (add ? "Convidado adicionado." : id === data.currentUserId ? "Você saiu dos convidados." : "Convidado removido."))
      onChanged(result.participants, result.stillVisible)
      if (!result.stillVisible) onClose()
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível atualizar os convidados.") }
    finally { busy.current = false; setPending(null) }
  }

  const label = (id: string) => data?.members.find(m => m.id === id)?.name ?? "Pessoa fora da equipe"
  const normalized = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  const matches = (name: string) => normalized(name).includes(normalized(search.trim()))
  const guests = [...new Set(data?.participants ?? [])].filter(id => id !== data?.assignedTo)
  const shownGuests = guests.filter(id => matches(label(id)))
  const available = data?.canManage ? data.members.filter(m => m.active && m.id !== data.assignedTo && !guests.includes(m.id) && matches(m.name)) : []

  return <Dialog open onOpenChange={open => { if (!open && !busy.current) onClose() }}>
    <DialogContent showCloseButton={false} className="sm:max-w-[540px] max-h-[90dvh] flex flex-col gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 shadow-xl">
      <DialogHeader className="border-b border-slate-100 p-5 pr-14">
        <DialogTitle className="text-lg font-bold text-slate-900">Convidados da conversa</DialogTitle>
        <DialogDescription className="text-sm text-slate-500">Compartilhe este atendimento com pessoas da equipe.</DialogDescription>
      </DialogHeader>
      <button type="button" aria-label="Fechar convidados" disabled={!!pending} onClick={onClose} className="absolute right-4 top-4 grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"><X className="size-4" /></button>
      <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-4" aria-busy={loading || !!pending}>
        <p className="rounded-xl bg-primary-50 px-3 py-2.5 text-xs leading-relaxed text-primary-700">O convite permite ver o histórico e responder nesta conversa, mesmo que ela esteja em outro número. As demais conversas desse número continuam seguindo as permissões da pessoa.</p>
        {loading && <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" /> Carregando convidados…</div>}
        {error && <div role="alert" className="rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-700"><p>{error}</p><button type="button" disabled={!!pending} onClick={() => setRevision(v => v + 1)} className="mt-2 font-semibold underline">Atualizar lista</button></div>}
        {data && <>
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
            <AgentAvatar userId={data.assignedTo} name={data.assignedTo ? label(data.assignedTo) : null} className="size-8" />
            <div className="min-w-0"><p className="text-[11px] text-slate-500">Atendendo</p><p className="truncate text-sm font-semibold text-slate-800">{data.assignedTo ? label(data.assignedTo) : "Sem atendente atribuído"}</p></div>
          </div>
          {!data.canManage && <p className="text-xs leading-relaxed text-slate-500">Somente o atendente atribuído e os administradores podem gerenciar os convidados. Você pode sair da sua própria participação.</p>}
          <label className="relative block"><span className="sr-only">Buscar pessoa</span><Search className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar pessoa pelo nome" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" /></label>
          <section aria-label="Convidados atuais">
            <h3 className="mb-2 text-xs font-semibold text-slate-600">Convidados <span className="ml-1 text-slate-400">{guests.length}</span></h3>
            {shownGuests.length ? <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">{shownGuests.map(id => <div key={id} className="px-3 py-2.5">
              <div className="flex items-center gap-2.5"><AgentAvatar userId={id} name={label(id)} className="size-7" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-700">{label(id)}{id === data.currentUserId && <span className="text-xs font-normal text-slate-400"> · Você</span>}</p>{!data.members.find(m => m.id === id)?.active && <p className="text-[11px] text-slate-400">Sem vínculo ativo</p>}</div>
                {(data.canManage || id === data.currentUserId) && <Button variant="ghost" size="sm" disabled={!!pending} onClick={() => setRemoving(id)} className="text-slate-500 hover:bg-red-50 hover:text-red-600">{id === data.currentUserId ? "Sair" : "Remover"}</Button>}
              </div>
              {removing === id && <div className="mt-3 rounded-lg bg-slate-50 p-3"><p className="text-xs leading-relaxed text-slate-600">Remover o convite de {label(id)}? O acesso será mantido se houver atribuição, supervisão ou outra permissão para esta conversa.</p><div className="mt-2 flex justify-end gap-2"><Button variant="outline" size="sm" disabled={!!pending} onClick={() => setRemoving(null)}>Cancelar</Button><Button variant="destructive" size="sm" disabled={!!pending} onClick={() => void change(id, false)}>{pending === id && <Loader2 className="size-3 animate-spin" />}Confirmar remoção</Button></div></div>}
            </div>)}</div> : <div className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-center"><Users className="mx-auto mb-2 size-5 text-slate-300" /><p className="text-xs text-slate-500">{guests.length ? "Nenhum convidado com esse nome." : "Nenhum convidado nesta conversa."}</p></div>}
          </section>
          {data.canManage && <section aria-label="Adicionar convidados"><h3 className="mb-2 text-xs font-semibold text-slate-600">Adicionar pessoas</h3>
            {available.length ? <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">{available.map(member => <div key={member.id} className="flex items-center gap-2.5 px-3 py-2.5"><AgentAvatar userId={member.id} name={member.name} className="size-7" /><span className="min-w-0 flex-1 truncate text-sm text-slate-700">{member.name}</span><Button variant="ghost" size="sm" disabled={!!pending} onClick={() => void change(member.id, true)} className="text-primary hover:bg-primary-50">{pending === member.id ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}Adicionar</Button></div>)}</div> : <p className="py-3 text-xs text-slate-500">{search.trim() ? "Nenhuma pessoa disponível com esse nome." : "Todas as pessoas disponíveis já estão nesta conversa."}</p>}
          </section>}
        </>}
      </div>
      <DialogFooter className="m-0 flex-row items-center justify-between rounded-none border-slate-100 bg-slate-50 px-5 py-3 sm:justify-between"><p role="status" className="min-w-0 text-xs text-slate-500">{notice || "Cada alteração é salva ao confirmar a ação."}</p><Button variant="outline" disabled={!!pending} onClick={onClose}>Concluir</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
