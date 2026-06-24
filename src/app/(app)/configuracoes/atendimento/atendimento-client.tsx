"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import {
  Save, Loader2, AlertCircle, CheckCircle2, Check, Sparkles,
  Settings as SettingsIcon, Users, Pause, Play, UserCheck, Bell, Shuffle, Bot,
} from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { FormRow } from "@/components/ui/form-row"
import { StatusDot } from "@/components/ui/status-dot"
import { EmptyState } from "@/components/ui/empty-state"
import { Switch } from "@/components/ui/switch"
import {
  updateAutoAssignConfig, setAgentPause,
  type AutoAssignConfig, type AgentInfo,
} from "@/lib/actions/auto-assign"
import { updateAtendimentoPolicy } from "@/lib/actions/atendimento"

type IAct = "notify" | "redistribute" | "ai"
type Bind = "carteira" | "pool"
type Tab  = "distribuicao" | "vinculo" | "inatividade"

interface Props {
  initialConfig:     AutoAssignConfig
  initialAgents:     AgentInfo[]
  hasAi:             boolean
  hasStudio:         boolean
  flows:             { id: string; name: string }[]
  binding:           Bind
  reopenToAi:        boolean
  reopenFlowId:      string | null
  inactivityEnabled: boolean
  inactivityHours:   number
  inactivityAction:  IAct
}

const ROLE_LABEL: Record<string, string>    = { owner: "Owner", admin: "Admin", agent: "Atendente" }
const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", site: "Site (widget)", manual: "Manual" }

export function AtendimentoClient(props: Props) {
  const [tab, setTab]       = useState<Tab>("distribuicao")
  // ── Distribuição ──
  const [config, setConfig] = useState<AutoAssignConfig>(props.initialConfig)
  const [agents, setAgents] = useState<AgentInfo[]>(props.initialAgents)
  // ── Política (vínculo + IA-no-retorno + inatividade) ──
  const [bind, setBind]     = useState<Bind>(props.binding)
  const [aiFirst, setAiFirst] = useState(props.reopenToAi)
  const [reopenFlow, setReopenFlow] = useState<string | null>(props.reopenFlowId)
  const [inact, setInact]   = useState(props.inactivityEnabled)
  const [hours, setHours]   = useState(props.inactivityHours)
  const [act, setAct]       = useState<IAct>(props.inactivityAction)
  // Sem IA → opções de IA somem; valores caem no fallback humano na exibição.
  const aiOn  = props.hasAi && aiFirst
  const dispAct: IAct = props.hasAi || act !== "ai" ? act : "notify"

  const [pending, startT]   = useTransition()
  const [fb, setFb]         = useState<{ ok: boolean; text: string } | null>(null)
  const flash = (ok: boolean, text: string) => { setFb({ ok, text }); setTimeout(() => setFb(null), 3000) }
  const patch = (p: Partial<AutoAssignConfig>) => setConfig((c) => ({ ...c, ...p }))

  function save() {
    setFb(null)
    startT(async () => {
      const r1 = await updateAutoAssignConfig(config)
      if ("error" in r1) return flash(false, r1.error)
      const r2 = await updateAtendimentoPolicy({
        handoff_binding: bind,
        // "IA atende o retorno" só com IA no tenant; o fluxo só com Studio (coerção
        // defensiva — espelha o gate do servidor).
        reopen_to_ai: props.hasAi ? aiFirst : false,
        reopen_flow_id: (props.hasAi && aiFirst && props.hasStudio) ? reopenFlow : null,
        inactivity_enabled: inact, inactivity_hours: hours,
        inactivity_action: (!props.hasAi && act === "ai") ? "notify" : act,
      })
      if (r2?.error) return flash(false, r2.error)
      flash(true, "Configuração salva")
    })
  }

  function toggleRole(role: string) {
    const next = config.eligible_roles.includes(role) ? config.eligible_roles.filter((r) => r !== role) : [...config.eligible_roles, role]
    if (next.length === 0) return
    patch({ eligible_roles: next })
  }
  function toggleChannel(ch: string) {
    const next = config.channels.includes(ch) ? config.channels.filter((c) => c !== ch) : [...config.channels, ch]
    if (next.length === 0) return
    patch({ channels: next })
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "distribuicao", label: "Distribuição" },
    { id: "vinculo",      label: "Vínculo" },
    { id: "inatividade",  label: "Inatividade" },
  ]

  return (
    <div className="space-y-5">
      {/* Abas */}
      <div className="inline-flex bg-slate-100 rounded-lg p-1 gap-1">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`h-8 px-4 text-xs font-semibold rounded-md transition-colors ${tab === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ───────── Distribuição ───────── */}
      {tab === "distribuicao" && (
        <div className="space-y-5">
          <SectionCard>
            <div className="flex items-start gap-3">
              <Switch size="lg" checked={config.enabled} onChange={(n) => patch({ enabled: n })} />
              <div className="flex-1">
                <p className="text-sm font-bold text-slate-900 flex items-center gap-2"><Sparkles className="size-3.5 text-primary-600" /> Distribuir novas conversas automaticamente</p>
                <p className="text-xs text-slate-500 mt-0.5">Desligado: a conversa cai no pool (o 1º que responder atende). Ligado: cada conversa nova é atribuída a um atendente conforme a regra abaixo.</p>
              </div>
            </div>
          </SectionCard>

          <div className="flex items-start gap-2 rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-xs text-slate-600">
            <Users className="size-4 shrink-0 text-slate-400 mt-0.5" />
            <p className="leading-relaxed">Atendentes que <strong>não veem o pool</strong> dependem desta distribuição (ou de atribuição manual) pra receber conversas. Configure quem vê o pool em <Link href="/configuracoes/equipe" className="font-semibold text-primary-700 hover:underline">Equipe</Link>.</p>
          </div>

          <div className={config.enabled ? "" : "opacity-50 pointer-events-none"}>
            <SectionCard icon={SettingsIcon} title="Como distribuir">
              <div className="space-y-4">
                <FormRow label="Estratégia" hint="Como o sistema escolhe qual atendente recebe a próxima conversa.">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <RadioCard active={config.strategy === "round_robin"} onClick={() => patch({ strategy: "round_robin" })} title="Round-robin" description="Alfabético, distribuição justa entre todos" />
                    <RadioCard active={config.strategy === "least_busy"} onClick={() => patch({ strategy: "least_busy" })} title="Menos ocupado" description="Quem tem menos conversas abertas recebe" />
                  </div>
                </FormRow>
                <FormRow label="Quem pode receber" hint="Papéis que entram na rotação. Atendente é o padrão.">
                  <div className="flex flex-wrap gap-2">
                    {(["agent", "admin", "owner"] as const).map((role) => (
                      <CheckChip key={role} active={config.eligible_roles.includes(role)} onClick={() => toggleRole(role)} label={ROLE_LABEL[role]} />
                    ))}
                  </div>
                </FormRow>
                <FormRow label="De quais canais" hint="Só conversas dos canais marcados disparam auto-assign; os outros caem no pool.">
                  <div className="flex flex-wrap gap-2">
                    {(["whatsapp", "site", "manual"] as const).map((ch) => (
                      <CheckChip key={ch} active={config.channels.includes(ch)} onClick={() => toggleChannel(ch)} label={CHANNEL_LABEL[ch]} />
                    ))}
                  </div>
                </FormRow>
                <FormRow label="Limite diário por atendente" hint="Evita sobrecarga. Vazio = ilimitado. Todos no cap → vai pro pool.">
                  <div className="flex items-center gap-2">
                    <input type="number" value={config.max_per_day ?? ""} min={1} max={9999} placeholder="sem limite"
                      onChange={(e) => { const v = e.target.value.trim(); patch({ max_per_day: v === "" ? null : Math.max(1, Math.min(9999, Number(v) || 0)) }) }}
                      className="h-9 w-32 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 tabular-nums" />
                    <span className="text-xs text-slate-500">conversas/dia</span>
                  </div>
                </FormRow>
                <div className="pt-2 border-t border-slate-100 space-y-3">
                  <Switch size="md" checked={config.skip_groups} onChange={(n) => patch({ skip_groups: n })} label="Pular conversas em grupo" description="Grupos não fazem sentido pra 1:1; recomendado deixar ligado." />
                  <Switch size="md" checked={config.only_in_hours} onChange={(n) => patch({ only_in_hours: n })} label="Distribuir apenas em horário comercial" description={<>Usa o horário comercial (em <em>Mensagens automáticas</em>). Fora do horário, cai no pool.</>} />
                </div>
              </div>
            </SectionCard>

            <div className="mt-5">
              <SectionCard icon={Users} title="Atendentes" description="Pause individualmente (férias, reunião, sobrecarga)." flush>
                {agents.length === 0 ? (
                  <EmptyState icon={Users} title="Sem atendentes ativos" description="Convide pessoas em Configurações → Equipe." bordered={false} />
                ) : (
                  <div className="divide-y divide-slate-100">
                    {agents.map((a) => (
                      <AgentRow key={a.user_id} agent={a} onChange={(p) => setAgents((prev) => prev.map((x) => x.user_id === a.user_id ? { ...x, ...p } : x))} onFlash={flash} />
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>
          </div>
        </div>
      )}

      {/* ───────── Vínculo ───────── */}
      {tab === "vinculo" && (
        <SectionCard icon={UserCheck} title="Quando o cliente volta a falar" description="Depois que um atendimento é encerrado e o cliente manda mensagem de novo, ele cai com quem?">
          <div className="space-y-2">
            {/* Dono no retorno — escolha UM (radio) */}
            <RadioCard active={bind === "carteira"} onClick={() => setBind("carteira")} icon={UserCheck} title="Volta pro mesmo atendente" description="Carteira — cada cliente fica com o atendente responsável. Bom pra vendas com vendedor dono." />
            <RadioCard active={bind === "pool"} onClick={() => setBind("pool")} icon={Users} title="Cai na fila de novo" description="Pool — volta pra fila do setor; quem estiver livre atende. Bom pra suporte compartilhado." />

            {/* IA atende o retorno — toggle INDEPENDENTE (combina com a opção acima) */}
            {props.hasAi && (
              <ToggleCard
                active={aiFirst}
                onClick={() => setAiFirst((v) => !v)}
                icon={Bot}
                title="Deixar a IA responder primeiro"
                description={bind === "carteira"
                  ? "A IA tria o retorno (responde/qualifica/vende) e, ao terminar o fluxo, devolve pro MESMO atendente. Se ela encaminhar, segue o encaminhamento."
                  : "A IA tria o retorno antes de cair na fila. Se a IA estiver desligada, vai direto pra fila."}
              />
            )}

            {/* Fluxo de retorno — habilita ABAIXO quando a IA-no-retorno está ligada (+ Studio) */}
            {aiOn && props.hasStudio && (
              <div className="ml-1 pl-4 border-l-2 border-primary-100 space-y-2 pb-1">
                <label className="text-xs font-semibold text-slate-700 block">Qual fluxo a IA roda no retorno</label>
                {props.flows.length === 0 ? (
                  <p className="text-[11px] text-slate-500">
                    Você ainda não tem fluxos publicados. A IA vai responder pela persona (Atendente de IA).{" "}
                    <Link href="/studio/fluxos" className="font-semibold text-primary-700 hover:underline">Criar um fluxo</Link>.
                  </p>
                ) : (
                  <>
                    <select
                      value={reopenFlow ?? ""}
                      onChange={(e) => setReopenFlow(e.target.value || null)}
                      className="h-9 w-full max-w-sm px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20">
                      <option value="">A IA decide pelo gatilho da mensagem</option>
                      {props.flows.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                    {reopenFlow && !props.flows.some((f) => f.id === reopenFlow) && (
                      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
                        O fluxo escolhido não está mais publicado. Escolha outro — senão, no retorno, a IA cai na persona.
                      </p>
                    )}
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Dica: pra <b>devolver pro mesmo atendente</b> (carteira), o fluxo precisa <b>terminar</b> (nó Fim) —
                      se ele encaminhar pra um setor, a IA fica sendo o encaminhamento. E crie um fluxo <b>dedicado ao retorno</b>,
                      sem a condição de “é cliente?”, senão a etapa do funil desvia quem já é lead/cliente.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {/* ───────── Inatividade ───────── */}
      {tab === "inatividade" && (
        <SectionCard>
          <div className="flex items-start gap-3">
            <Switch size="lg" checked={inact} onChange={setInact} />
            <div className="flex-1">
              <p className="text-sm font-bold text-slate-900">Quando ninguém responde o cliente</p>
              <p className="text-xs text-slate-500 mt-0.5">Se o cliente manda mensagem e nenhum atendente responde por um tempo, o sistema age sozinho.</p>
            </div>
          </div>
          {inact && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2 text-sm text-slate-700">
                Depois de
                <input type="number" min={1} max={168} value={hours} onChange={(e) => setHours(Math.max(1, Math.min(168, Number(e.target.value) || 1)))}
                  className="w-16 h-9 px-2 text-sm border border-slate-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-primary/30" />
                horas sem resposta humana:
              </div>
              <div className="space-y-2">
                <RadioCard active={dispAct === "notify"}       onClick={() => setAct("notify")}       icon={Bell}    title="Avisar a equipe" description="Deixa um aviso interno na conversa. Não muda quem atende." />
                <RadioCard active={dispAct === "redistribute"} onClick={() => setAct("redistribute")} icon={Shuffle} title="Redistribuir"    description="Tira do atendente que sumiu e passa adiante: pra outro atendente se a Distribuição estiver ligada, senão pra fila do setor." />
                {props.hasAi && (
                  <RadioCard active={dispAct === "ai"}         onClick={() => setAct("ai")}           icon={Bot}     title="Devolver pra IA" description="A IA reassume o atendimento." />
                )}
              </div>
            </div>
          )}
        </SectionCard>
      )}

      <p className="text-[11px] text-slate-400 px-1">A regra de ouro continua: a IA <b>nunca</b> fala por cima de um atendente ativo na conversa.</p>

      {/* Save sticky */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-card p-4 flex items-center gap-3 sticky bottom-4">
        <button type="button" onClick={save} disabled={pending}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Salvar
        </button>
        {fb && (
          <span className={`inline-flex items-center gap-1.5 text-xs ${fb.ok ? "text-emerald-700" : "text-red-600"}`}>
            {fb.ok ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />} {fb.text}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Sub-componentes ────────────────────────────────────────
function RadioCard({ active, onClick, title, description, icon: Icon }: { active: boolean; onClick: () => void; title: string; description: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border-2 transition-all ${active ? "border-primary bg-primary-50/50 ring-2 ring-primary/10" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}>
      <p className={`text-sm font-semibold flex items-center gap-1.5 ${active ? "text-primary-700" : "text-slate-900"}`}>
        {Icon && <Icon className="size-3.5" />} {title}
      </p>
      <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{description}</p>
    </button>
  )
}

// Mesmo visual do RadioCard, mas é um toggle INDEPENDENTE (checkbox à direita) —
// combina com a escolha de radio acima (dá pra ver "dois selecionados").
function ToggleCard({ active, onClick, title, description, icon: Icon }: { active: boolean; onClick: () => void; title: string; description: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border-2 transition-all flex items-start gap-2.5 ${active ? "border-primary bg-primary-50/50 ring-2 ring-primary/10" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold flex items-center gap-1.5 ${active ? "text-primary-700" : "text-slate-900"}`}>
          {Icon && <Icon className="size-3.5" />} {title}
        </p>
        <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{description}</p>
      </div>
      <span className={`mt-0.5 size-4 rounded-md border flex items-center justify-center shrink-0 transition-colors ${active ? "bg-primary border-primary text-white" : "border-slate-300 bg-white"}`}>
        {active && <Check className="size-3" strokeWidth={3} />}
      </span>
    </button>
  )
}

function CheckChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg border transition-colors ${active ? "bg-primary-50 border-primary-200 text-primary-700" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
      {active && <CheckCircle2 className="size-3" />} {label}
    </button>
  )
}

function formatPauseUntil(iso: string | null): string {
  if (!iso) return "indefinido"
  const date = new Date(iso), today = new Date(), tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  if (date.toDateString() === today.toDateString())    return `hoje às ${time}`
  if (date.toDateString() === tomorrow.toDateString()) return `amanhã às ${time}`
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) + ` ${time}`
}

function AgentRow({ agent, onChange, onFlash }: { agent: AgentInfo; onChange: (p: Partial<AgentInfo>) => void; onFlash: (ok: boolean, t: string) => void }) {
  const [pending, startT] = useTransition()
  const [showOpts, setShowOpts] = useState(false)
  // eslint-disable-next-line react-hooks/purity -- exibição do pause depende do "agora"; benigno numa tela de config
  const expired = agent.auto_assign_paused_until && new Date(agent.auto_assign_paused_until).getTime() < Date.now()
  const paused  = agent.auto_assign_paused && !expired
  const name    = agent.full_name ?? agent.email

  function pauseFor(h: number | null) {
    setShowOpts(false)
    // eslint-disable-next-line react-hooks/purity -- handler de clique; Date.now é correto aqui
    const until = h === null ? null : new Date(Date.now() + h * 3_600_000).toISOString()
    startT(async () => {
      const r = await setAgentPause(agent.user_id, true, until)
      if ("error" in r) onFlash(false, r.error)
      else { onChange({ auto_assign_paused: true, auto_assign_paused_until: until }); onFlash(true, `${name} pausado`) }
    })
  }
  function unpause() {
    startT(async () => {
      const r = await setAgentPause(agent.user_id, false, null)
      if ("error" in r) onFlash(false, r.error)
      else { onChange({ auto_assign_paused: false, auto_assign_paused_until: null }); onFlash(true, `${name} retomado`) }
    })
  }

  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <div className="size-9 rounded-full bg-primary-100 border border-primary-200 flex items-center justify-center shrink-0">
        <span className="text-xs font-bold text-primary-700">{name[0]?.toUpperCase()}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 truncate">{name}</p>
        <p className="text-xs text-slate-500 truncate">{agent.email} · {ROLE_LABEL[agent.role] ?? agent.role}</p>
      </div>
      <div className="shrink-0">
        {paused
          ? <StatusDot tone="warning" label={`Pausado${agent.auto_assign_paused_until ? ` até ${formatPauseUntil(agent.auto_assign_paused_until)}` : ""}`} />
          : <StatusDot tone="success" label="Recebendo conversas" />}
      </div>
      <div className="shrink-0 relative">
        {paused ? (
          <button type="button" onClick={unpause} disabled={pending}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-[11px] font-semibold border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-md transition-colors disabled:opacity-50">
            {pending ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />} Despausar
          </button>
        ) : (
          <>
            <button type="button" onClick={() => setShowOpts((v) => !v)} disabled={pending}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-[11px] font-semibold border border-slate-200 bg-white hover:bg-amber-50 hover:border-amber-200 hover:text-amber-700 text-slate-600 rounded-md transition-colors disabled:opacity-50">
              {pending ? <Loader2 className="size-3 animate-spin" /> : <Pause className="size-3" />} Pausar
            </button>
            {showOpts && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-lg shadow-soft border border-slate-200 z-10 overflow-hidden">
                {[{ h: 1, l: "Por 1 hora" }, { h: 4, l: "Por 4 horas" }, { h: 24, l: "Por 24 horas" }, { h: null, l: "Indefinido" }].map((o) => (
                  <button key={String(o.h)} type="button" onClick={() => pauseFor(o.h)} className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 text-slate-700">{o.l}</button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
