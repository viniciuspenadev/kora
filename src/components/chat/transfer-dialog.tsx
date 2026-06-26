"use client"

import { useMemo, useState, useTransition } from "react"
import { Building2, Users, X, Loader2, ArrowRight } from "lucide-react"

interface DepartmentMini { id: string; name: string; color: string }
interface AgentMini      { id: string; full_name: string | null; department_id?: string | null }

export interface TransferOpts {
  mode:               "department" | "agent" | "pool"
  departmentId?:      string | null
  agentId?:           string | null
  stayAsParticipant?: boolean
}

interface Props {
  open:                boolean
  onClose:             () => void
  departments:         DepartmentMini[]
  agents:              AgentMini[]
  currentAssignedTo:   string | null
  onTransfer:          (opts: TransferOpts) => Promise<void>
}

const selectCls =
  "w-full h-9 px-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"

export function TransferDialog({ open, onClose, departments, agents, currentAssignedTo, onTransfer }: Props) {
  const [mode, setMode]                   = useState<"department" | "agent">(departments.length > 0 ? "department" : "agent")
  const [departmentId, setDepartmentId]   = useState<string>(departments[0]?.id ?? "")
  const [deptAssign, setDeptAssign]       = useState<"queue" | "agent">("queue")
  const [deptAgentId, setDeptAgentId]     = useState<string>("")
  const [directAgentId, setDirectAgentId] = useState<string>("")
  const [stay, setStay]                   = useState(false)
  const [pending, startTransition]        = useTransition()

  const dept       = departments.find((d) => d.id === departmentId) ?? null
  const deptAgents = useMemo(() => agents.filter((a) => a.department_id === departmentId), [agents, departmentId])

  // Resumo + destino resolvido (o que vai pro backend).
  const { summary, valid, opts } = useMemo<{ summary: string; valid: boolean; opts: TransferOpts | null }>(() => {
    if (mode === "agent") {
      const a = agents.find((x) => x.id === directAgentId)
      if (!a) return { summary: "Selecione um atendente.", valid: false, opts: null }
      return {
        summary: `A conversa passa a ser de ${a.full_name ?? "atendente"}.`,
        valid: true,
        opts: { mode: "agent", agentId: a.id, stayAsParticipant: stay },
      }
    }
    if (!dept) return { summary: "Selecione um departamento.", valid: false, opts: null }
    if (deptAssign === "queue") {
      return {
        summary: `A conversa vai pra fila do ${dept.name}.`,
        valid: true,
        opts: { mode: "department", departmentId: dept.id, agentId: null, stayAsParticipant: stay },
      }
    }
    const a = agents.find((x) => x.id === deptAgentId)
    if (!a) return { summary: "Selecione um atendente do setor.", valid: false, opts: null }
    return {
      summary: `A conversa passa a ser de ${a.full_name ?? "atendente"} (${dept.name}).`,
      valid: true,
      opts: { mode: "department", departmentId: dept.id, agentId: a.id, stayAsParticipant: stay },
    }
  }, [mode, dept, deptAssign, deptAgentId, directAgentId, stay, agents])

  if (!open) return null

  function submit() {
    if (!opts) return
    startTransition(async () => {
      await onTransfer(opts)
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl border border-slate-200 shadow-soft w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-900">Transferir conversa</h3>
          <button type="button" onClick={onClose} aria-label="Fechar" className="size-7 rounded-lg hover:bg-slate-100 text-slate-400 flex items-center justify-center">
            <X className="size-4" />
          </button>
        </header>

        <div className="p-5 space-y-4">
          {/* PARA ONDE — toggle */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Para onde</p>
            <div className="grid grid-cols-2 gap-2">
              <ModeBtn active={mode === "department"} disabled={departments.length === 0} onClick={() => setMode("department")} icon={Building2} label="Departamento" />
              <ModeBtn active={mode === "agent"} onClick={() => setMode("agent")} icon={Users} label="Atendente" />
            </div>
            {departments.length === 0 && mode === "agent" && (
              <p className="text-[11px] text-slate-400 mt-1.5">Nenhum departamento criado ainda — transfira direto pra um atendente.</p>
            )}
          </div>

          {mode === "department" ? (
            <>
              <Field label="Departamento">
                <select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setDeptAgentId("") }} className={selectCls}>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>

              <Field label="Quem atende?">
                <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                  <Radio
                    checked={deptAssign === "queue"}
                    onClick={() => setDeptAssign("queue")}
                    title="Deixar na fila do setor"
                    subtitle={dept ? `Qualquer atendente do ${dept.name} pode pegar.` : "Qualquer um do setor pode pegar."}
                  />
                  <div>
                    <Radio
                      checked={deptAssign === "agent"}
                      onClick={() => setDeptAssign("agent")}
                      title="Atribuir a um atendente específico"
                      subtitle={deptAgents.length === 0 ? "Nenhum atendente neste setor." : undefined}
                    />
                    {deptAssign === "agent" && deptAgents.length > 0 && (
                      <div className="px-3 pb-2.5 -mt-1">
                        <select value={deptAgentId} onChange={(e) => setDeptAgentId(e.target.value)} className={selectCls}>
                          <option value="">— Selecionar —</option>
                          {deptAgents.map((a) => <option key={a.id} value={a.id}>{a.full_name ?? "—"}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              </Field>
            </>
          ) : (
            <Field label="Atendente">
              <select value={directAgentId} onChange={(e) => setDirectAgentId(e.target.value)} className={selectCls}>
                <option value="">— Selecionar atendente —</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.full_name ?? "—"}</option>)}
              </select>
            </Field>
          )}

          {/* Continuar acompanhando */}
          <label className="flex items-start gap-2.5 pt-3 border-t border-slate-100 cursor-pointer">
            <input type="checkbox" checked={stay} onChange={(e) => setStay(e.target.checked)} className="size-4 mt-0.5 rounded border-slate-300 text-primary focus:ring-primary/30" />
            <span className="flex-1">
              <span className="block text-sm font-medium text-slate-800">Continuar acompanhando</span>
              <span className="block text-[11px] text-slate-500 mt-0.5">Você deixa de ser o responsável, mas segue na conversa como participante.</span>
            </span>
          </label>

          {/* Resumo dinâmico */}
          <div className={`flex items-center gap-1.5 text-[11px] font-medium ${valid ? "text-primary-700" : "text-slate-400"}`}>
            <ArrowRight className="size-3 shrink-0" />
            {summary}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
          {currentAssignedTo ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(async () => { await onTransfer({ mode: "pool", stayAsParticipant: stay }); onClose() })}
              className="text-[11px] font-medium text-slate-500 hover:text-slate-800 disabled:opacity-50"
            >
              Devolver pra fila geral
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={pending} className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-50">Cancelar</button>
            <button
              type="button"
              onClick={submit}
              disabled={!valid || pending}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg disabled:opacity-40 transition-colors"
            >
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              Transferir
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function ModeBtn({ active, disabled, onClick, icon: Icon, label }: { active: boolean; disabled?: boolean; onClick: () => void; icon: typeof Building2; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-2 h-10 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-40 ${
        active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
      }`}
    >
      <Icon className="size-4" /> {label}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">{label}</p>
      {children}
    </div>
  )
}

function Radio({ checked, onClick, title, subtitle }: { checked: boolean; onClick: () => void; title: string; subtitle?: string }) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-slate-50 transition-colors">
      <span className={`size-4 mt-0.5 rounded-full border-2 shrink-0 flex items-center justify-center ${checked ? "border-primary" : "border-slate-300"}`}>
        {checked && <span className="size-2 rounded-full bg-primary" />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-slate-800">{title}</span>
        {subtitle && <span className="block text-[11px] text-slate-500 mt-0.5">{subtitle}</span>}
      </span>
    </button>
  )
}
