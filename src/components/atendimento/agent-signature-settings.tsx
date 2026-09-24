"use client"
import { useEffect, useState } from "react"
import { PenLine, Loader2, Save, CheckCheck } from "lucide-react"
import { getSignatureSettings, saveSignatureSettings } from "@/lib/actions/agent-signature"
import { emptySignaturePolicy, resolveSignature, signatureName, type SignatureMode, type SignaturePolicy } from "@/lib/atendimento/agent-signature"
import { SectionCard } from "@/components/ui/section-card"
import { Switch } from "@/components/ui/switch"
import { SimpleSelect } from "@/components/ui/select"
type Data = Awaited<ReturnType<typeof getSignatureSettings>>
const modes = [{ value: "inherit", label: "Herdar regra anterior" }, { value: "on", label: "Mostrar nome" }, { value: "off", label: "Não mostrar nome" }]
export function AgentSignatureSettings() {
  const [data, setData] = useState<Data | null>(null)
  const [policy, setPolicy] = useState<SignaturePolicy>(emptySignaturePolicy)
  const [agentId, setAgentId] = useState("")
  const [departmentId, setDepartmentId] = useState("")
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { let current = true
    getSignatureSettings().then(value => { if (current) {
      setData(value); setPolicy({ ...value.policy,
        departments: Object.fromEntries(Object.entries(value.policy.departments).filter(([id]) => value.departments.some(d => d.id === id))),
        agents: Object.fromEntries(Object.entries(value.policy.agents).filter(([id]) => value.agents.some(a => a.id === id))) })
      setAgentId(value.agents[0]?.id ?? ""); setDepartmentId(value.departments[0]?.id ?? "")
    } }).catch(() => { if (current) setError("Não foi possível carregar a configuração. Atualize a página para tentar novamente.") })
    return () => { current = false }
  }, [])
  function change(next: SignaturePolicy) { setPolicy(next); setSaved(false); setError("") }
  const agent = policy.agents[agentId] ?? { mode: "inherit" as SignatureMode, name: "" }
  function changeAgent(patch: Partial<typeof agent>) { change({ ...policy, agents: { ...policy.agents, [agentId]: { ...agent, ...patch } } }) }
  const departmentMode = typeof policy.departments[departmentId] === "boolean" ? policy.departments[departmentId] ? "on" : "off" : "inherit"
  const exampleName = signatureName(agent.name || data?.agents.find(a => a.id === agentId)?.name || "Nome do atendente") || "Nome do atendente"
  let preview: string | null = null
  try { preview = resolveSignature(policy, agentId, departmentId || null, data?.agents.find(a => a.id === agentId)?.name ?? "Nome do atendente")?.name ?? null } catch { /* empty name explained on save/send */ }
  async function save() {
    if (!data || busy) return
    setBusy(true); setError(""); setSaved(false)
    try { const result = await saveSignatureSettings(policy, data.raw)
      if (result.error) setError(result.error)
      else { setData({ ...data, raw: policy, exists: true }); setSaved(true) }
    } catch { setError("Não foi possível confirmar a alteração. Recarregue antes de tentar novamente.") }
    finally { setBusy(false) }
  }
  if (!data) return <SectionCard title="Nome do atendente nas mensagens" icon={PenLine}><p role="status" className="flex items-center gap-2 text-sm text-slate-500">{!error && <Loader2 className="size-4 animate-spin" />}{error || "Carregando regras de assinatura…"}</p></SectionCard>
  return <div className="space-y-4">
    <SectionCard title="Como o cliente recebe" description="O nome de quem envia aparece em negrito, acima da mensagem. Você não precisa digitá-lo a cada resposta.">
      <div className="grid gap-3 sm:grid-cols-2">
        <SignatureMessagePreview label="Sem assinatura" name={null} />
        <SignatureMessagePreview label="Com assinatura" name={exampleName} />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-slate-500">Demonstração do recurso. As regras abaixo determinam quando o nome será incluído. Nenhuma mensagem é enviada por esta prévia.</p>
    </SectionCard>
    {!data.ready && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Configuração em preparação. O envio atual permanece sem assinatura até a liberação desta funcionalidade.</p>}
    <fieldset disabled={busy || !data.ready} className="min-w-0 space-y-4 disabled:opacity-60">
      <SectionCard title="Nome do atendente nas mensagens" icon={PenLine} description="Identifique quem respondeu pelo Kora no WhatsApp e na API Oficial.">
        <div className="flex items-start justify-between gap-4"><div><label htmlFor="agent-signature-default" className="text-sm font-semibold text-slate-900">Padrão da empresa</label><p className="mt-1 text-xs text-slate-500">Mostrar o nome antes de textos e legendas enviados pelos atendentes.</p></div><Switch id="agent-signature-default" checked={policy.enabled} onChange={enabled => change({ ...policy, enabled })} /></div>
        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">Prioridade: agente → departamento da conversa → empresa. Herdar mantém a regra anterior. Grupos seguem a mesma configuração. Templates, automações, notas internas e áudios ficam fora.</p>
      </SectionCard>
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Por departamento" description="Usamos o departamento da conversa, mesmo que o agente pertença a outro setor.">
          {data.departments.length ? <div className="space-y-3"><SimpleSelect ariaLabel="Departamento da assinatura" value={departmentId} onChange={setDepartmentId} options={data.departments.map(d => ({ value: d.id, label: d.name }))} disabled={busy || !data.ready} />
            <SimpleSelect ariaLabel="Regra de assinatura do departamento" value={departmentMode} options={modes} disabled={busy || !data.ready} onChange={value => { const departments = { ...policy.departments }; if (value === "inherit") delete departments[departmentId]; else departments[departmentId] = value === "on"; change({ ...policy, departments }) }} />
          </div> : <p className="text-sm text-slate-500">Sem departamentos. A regra da empresa será usada quando o agente herdar.</p>}
        </SectionCard>
        <SectionCard title="Por agente" description="A exceção do agente prevalece sobre o departamento e a empresa.">
          {data.agents.length ? <div className="space-y-3"><SimpleSelect ariaLabel="Agente da assinatura" value={agentId} onChange={setAgentId} options={data.agents.map(a => ({ value: a.id, label: a.name }))} disabled={busy || !data.ready} />
            <SimpleSelect ariaLabel="Regra de assinatura do agente" value={agent.mode} options={modes} onChange={mode => changeAgent({ mode: mode as SignatureMode })} disabled={busy || !data.ready} />
            <label className="block space-y-1.5 text-xs font-medium text-slate-700">Nome de atendimento<input maxLength={80} value={agent.name} onChange={e => changeAgent({ name: e.target.value })} placeholder={data.agents.find(a => a.id === agentId)?.name} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-primary" /></label>
            <p className="text-xs text-slate-500">Deixe vazio para usar o nome do perfil. Alterações valem para novas mensagens.</p>
          </div> : <p className="text-sm text-slate-500">Nenhum atendente disponível.</p>}
        </SectionCard>
      </div>
      <SectionCard title="Resultado das regras selecionadas" description="Esta prévia acompanha o agente, o departamento e o nome de atendimento escolhidos acima."><div className="max-w-md" aria-live="polite"><SignatureMessagePreview label={preview ? "Enviará com assinatura" : "Enviará sem assinatura"} name={preview} /></div><p className="mt-2 text-xs text-slate-500">As alterações passam a valer depois de salvar.</p></SectionCard>
    </fieldset>
    <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card"><button type="button" onClick={() => void save()} disabled={busy || !data.ready} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}Salvar assinatura</button>{saved && <p role="status" className="text-xs text-emerald-700">Regras de assinatura salvas.</p>}{error && <p role="alert" className="text-xs text-red-700">{error}</p>}</div>
  </div>
}

function SignatureMessagePreview({ label, name }: { label: string; name: string | null }) {
  return <figure className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4">
    <figcaption className="mb-3 text-xs font-semibold text-slate-600">{label}</figcaption>
    <div className="ml-auto max-w-sm rounded-xl rounded-tr-sm border border-primary-100 bg-primary-50 px-4 py-3 text-sm leading-relaxed text-slate-800">
      {name && <p className="mb-3 break-words font-bold text-slate-900">{name}</p>}
      <p>Olá, tudo bem?</p>
      <div aria-hidden="true" className="mt-2 flex items-center justify-end gap-1 text-[10px] tabular-nums text-slate-400"><span>10:30</span><CheckCheck className="size-3.5 text-primary" /></div>
    </div>
  </figure>
}
