"use client"

import { useId, useRef, useState } from "react"
import { ArrowRight, Building2, Check, Inbox, Loader2, MessageSquare, Search, Users, X } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { FormRow } from "@/components/ui/form-row"
import { SimpleSelect } from "@/components/ui/select"
import { UserAvatar } from "@/components/ui/user-avatar"

interface DepartmentMini { id: string; name: string; color: string }
interface AgentMini { id: string; full_name: string | null; department_id?: string | null }

export interface TransferOpts {
  mode: "department" | "agent" | "pool"
  departmentId?: string | null
  agentId?: string | null
  stayAsParticipant?: boolean
}

interface Props {
  open: boolean
  onClose: () => void
  departments: DepartmentMini[]
  agents: AgentMini[]
  currentAssignedTo: string | null
  contactName?: string
  onTransfer: (opts: TransferOpts) => Promise<void>
}

// A fresh form per opening prevents confirming an old destination by accident.
export function TransferDialog(props: Props) {
  return props.open ? <TransferForm {...props} /> : null
}

function TransferForm({ onClose, departments, agents, currentAssignedTo, contactName, onTransfer }: Props) {
  const id = useId()
  const [mode, setMode] = useState<TransferOpts["mode"]>("agent")
  const [departmentId, setDepartmentId] = useState("")
  const [deptAssign, setDeptAssign] = useState<"queue" | "agent">("queue")
  const [agentId, setAgentId] = useState("")
  const [search, setSearch] = useState("")
  const [stay, setStay] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const busy = useRef(false)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const department = departments.find(d => d.id === departmentId)
  const currentAgent = agents.find(a => a.id === currentAssignedTo)
  const needsAgent = mode === "agent" || (mode === "department" && deptAssign === "agent")
  const candidates = agents.filter(a => mode === "department" ? a.department_id === departmentId : a.id !== currentAssignedTo)
  const selectedAgent = candidates.find(a => a.id === agentId)
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")
  const shownAgents = candidates.filter(a => normalize(a.full_name ?? "Integrante da equipe").includes(normalize(search.trim())))
    .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "", "pt-BR"))

  // Resolve only candidates that still exist in the current destination.
  const opts: TransferOpts | null = mode === "pool"
    ? currentAssignedTo ? { mode, stayAsParticipant: stay } : null
    : mode === "department"
      ? department && (!needsAgent || selectedAgent)
        ? { mode, departmentId: department.id, agentId: needsAgent ? selectedAgent!.id : null, stayAsParticipant: stay }
        : null
      : selectedAgent ? { mode, agentId: selectedAgent.id, stayAsParticipant: stay } : null
  const destination = mode === "pool" ? "Fila geral"
    : needsAgent ? selectedAgent?.full_name || (selectedAgent ? "Integrante da equipe" : "Selecione um atendente")
      : department ? `Fila de ${department.name}` : "Selecione um departamento"
  const destinationHint = mode === "pool" ? "Sem atendente e sem departamento. Pessoas com acesso à fila geral poderão assumir."
    : needsAgent ? mode === "department" ? department?.name : departments.find(d => d.id === selectedAgent?.department_id)?.name
      : "Sem atendente atribuído. Pessoas com acesso à fila do departamento poderão assumir."

  function changeMode(next: TransferOpts["mode"]) {
    setMode(next); setAgentId(""); setSearch(""); setError("")
  }
  async function submit() {
    if (!opts || busy.current) return
    busy.current = true; setPending(true); setError("")
    try { await onTransfer(opts); onClose() }
    catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível transferir. Tente novamente.")
      requestAnimationFrame(() => errorRef.current?.focus())
    } finally { busy.current = false; setPending(false) }
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy.current) onClose() }}>
    <DialogContent showCloseButton={false} className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 shadow-xl sm:max-w-[560px]">
      <DialogHeader className="shrink-0 border-b border-slate-100 p-5 pr-14">
        <DialogTitle className="text-lg font-bold text-slate-900">Transferir atendimento</DialogTitle>
        <DialogDescription className="text-sm text-slate-500">Escolha quem dará continuidade à conversa.</DialogDescription>
      </DialogHeader>
      <Button variant="ghost" size="icon" aria-label="Fechar transferência" disabled={pending} onClick={onClose} className="absolute right-4 top-4 text-slate-500"><X className="size-4" /></Button>
      <div className="min-h-0 flex-1 overflow-y-auto p-5" aria-busy={pending}>
        <div className="mb-5 flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
          <MessageSquare className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            {contactName && <p className="truncate text-sm font-semibold text-slate-800" title={contactName}>{contactName}</p>}
            <p className="text-xs text-slate-500">Atendendo agora: <span className="font-medium text-slate-700">{currentAssignedTo ? currentAgent?.full_name || "Atendente atribuído" : "Sem atendente"}</span></p>
          </div>
        </div>
        <fieldset disabled={pending} className="min-w-0 space-y-5">
          <fieldset>
            <legend className="mb-2 text-xs font-semibold text-slate-700">Destino do atendimento</legend>
            <div className={`grid gap-2 ${currentAssignedTo ? "grid-cols-3" : "grid-cols-2"}`}>
              {([
                { value: "agent", label: "Atendente", icon: Users, disabled: false },
                { value: "department", label: "Departamento", icon: Building2, disabled: !departments.length },
                ...(currentAssignedTo ? [{ value: "pool" as const, label: "Fila geral", icon: Inbox, disabled: false }] : []),
              ] as const).map(option => <label key={option.value} className={`relative flex min-w-0 flex-col items-center gap-2 rounded-xl border py-3 text-center text-[11px] font-semibold transition-colors sm:text-xs has-focus-visible:ring-2 has-focus-visible:ring-primary/40 ${option.disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:border-primary-200 hover:bg-primary-50/50"} ${mode === option.value ? "border-primary-200 bg-primary-50 text-primary-700" : "border-slate-200 text-slate-600"}`}>
                <input type="radio" name={`${id}-mode`} value={option.value} checked={mode === option.value} disabled={option.disabled} onChange={() => changeMode(option.value)} className="sr-only" />
                <option.icon className="size-4" aria-hidden="true" />{option.label}
              </label>)}
            </div>
            {!departments.length && <p className="mt-2 text-xs text-slate-500">Esta empresa ainda não tem departamentos cadastrados.</p>}
          </fieldset>
          {mode === "department" && <div className="space-y-4">
            <FormRow label="Departamento de destino">
              <SimpleSelect ariaLabel="Departamento de destino" value={departmentId} disabled={pending} placeholder="Selecione um departamento" className="h-10 w-full"
                onChange={value => { setDepartmentId(value); setAgentId(""); setSearch(""); setError("") }} options={departments.map(d => ({ value: d.id, label: d.name }))} />
            </FormRow>
            {department && <fieldset className="space-y-2">
              <legend className="mb-2 text-xs font-semibold text-slate-700">Como encaminhar?</legend>
              {([{ value: "queue", label: "Deixar na fila do departamento" }, { value: "agent", label: "Escolher uma pessoa do departamento" }] as const).map(option => <label key={option.value} className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
                <input type="radio" name={`${id}-department-routing`} checked={deptAssign === option.value} onChange={() => { setDeptAssign(option.value); setAgentId(""); setSearch(""); setError("") }} className="size-4 shrink-0 accent-primary" />{option.label}
              </label>)}
            </fieldset>}
          </div>}
          {needsAgent && (mode !== "department" || department) && <fieldset className="min-w-0">
            <legend className="mb-2 text-xs font-semibold text-slate-700">{mode === "department" ? "Atendente do departamento" : "Quem vai atender?"}</legend>
            <label className="relative mb-2 block"><span className="sr-only">Buscar atendente</span><Search className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400" /><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar pelo nome" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-50" /></label>
            {shownAgents.length ? <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
              {shownAgents.map(agent => <label key={agent.id} className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-primary-50/60 has-focus-visible:ring-2 has-focus-visible:ring-inset has-focus-visible:ring-primary/40 ${agent.id === agentId ? "bg-primary-50" : "bg-white"}`}>
                <input type="radio" name={`${id}-agent`} checked={agent.id === agentId} onChange={() => { setAgentId(agent.id); setError("") }} className="sr-only" />
                <UserAvatar userId={agent.id} name={agent.full_name} size={30} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-800" title={agent.full_name ?? undefined}>{agent.full_name || "Integrante da equipe"}</span><span className="block truncate text-xs text-slate-500">{departments.find(d => d.id === agent.department_id)?.name ?? "Sem departamento"}{agent.id === currentAssignedTo ? " · Atendendo agora" : ""}</span></span>
                <span aria-hidden="true" className={`grid size-4 shrink-0 place-items-center rounded-full border ${agent.id === agentId ? "border-primary bg-primary text-white" : "border-slate-300"}`}>{agent.id === agentId && <Check className="size-3" />}</span>
              </label>)}
            </div> : <EmptyState title={search.trim() ? "Nenhum atendente encontrado" : "Nenhum atendente disponível"} description={search.trim() ? "Tente buscar por outro nome." : mode === "department" ? "Você pode encaminhar para a fila do departamento." : "Não há outra pessoa na lista disponível para transferência."} className="py-5" />}
          </fieldset>}
          <label className="flex cursor-pointer items-start gap-3 border-t border-slate-100 pt-4">
            <input type="checkbox" checked={stay} onChange={e => setStay(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-primary" />
            <span><span className="block text-sm font-medium text-slate-800">Permanecer como convidado</span><span className="mt-1 block text-xs leading-relaxed text-slate-500">Ao marcar, você poderá acompanhar e responder nesta conversa após a transferência. Convites e outras permissões existentes são mantidos.</span></span>
          </label>
        </fieldset>
        <p className="mt-4 text-xs leading-relaxed text-slate-500">A transferência muda o atendimento atual. O vínculo do contato e o responsável pelo negócio no CRM são mantidos.</p>
        {error && <p ref={errorRef} tabIndex={-1} role="alert" className="mt-4 rounded-lg border border-red-100 bg-danger-bg p-3 text-sm text-danger outline-none">{error}</p>}
      </div>
      <DialogFooter className="m-0 shrink-0 flex-col gap-3 rounded-none border-slate-100 bg-slate-50 px-5 py-3 sm:flex-col">
        <div aria-live="polite" aria-atomic="true" className="flex items-start gap-2">
          <ArrowRight className={`mt-0.5 size-4 shrink-0 ${opts ? "text-primary" : "text-slate-400"}`} />
          <div className="min-w-0"><p className="break-words text-sm font-semibold text-slate-800">{destination}</p>{opts && destinationHint && <p className="mt-1 text-xs leading-relaxed text-slate-500">{destinationHint}</p>}{stay && <p className="mt-1 text-xs text-primary-700">Você acompanha como convidado.</p>}</div>
        </div>
        <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={pending} onClick={onClose} className="h-10 px-3 text-xs sm:text-sm">Cancelar</Button>
        <Button disabled={!opts || pending} onClick={() => void submit()} className="h-10 px-3 text-xs hover:bg-primary-700 sm:text-sm">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
          {pending ? "Transferindo…" : mode === "pool" || (mode === "department" && !needsAgent) ? "Enviar para a fila" : <><span className="sm:hidden">Transferir</span><span className="hidden sm:inline">Confirmar transferência</span></>}
        </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
