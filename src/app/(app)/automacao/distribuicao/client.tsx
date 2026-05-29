"use client"

import { useState, useTransition } from "react"
import {
  Save, Loader2, AlertCircle, CheckCircle2, Sparkles,
  Settings as SettingsIcon, Users, Pause, Play,
} from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { FormRow } from "@/components/ui/form-row"
import { StatusDot } from "@/components/ui/status-dot"
import { EmptyState } from "@/components/ui/empty-state"
import { Switch } from "@/components/ui/switch"
import {
  updateAutoAssignConfig, setAgentPause,
  type AutoAssignConfig, type AutoAssignStrategy, type AgentInfo,
} from "@/lib/actions/auto-assign"

interface Props {
  initialConfig: AutoAssignConfig
  initialAgents: AgentInfo[]
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner", admin: "Admin", agent: "Atendente",
}

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp", site: "Site (widget)", manual: "Manual",
}

function formatPauseUntil(iso: string | null): string {
  if (!iso) return "indefinido"
  const date = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const isToday    = date.toDateString() === today.toDateString()
  const isTomorrow = date.toDateString() === tomorrow.toDateString()
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  if (isToday)    return `hoje às ${time}`
  if (isTomorrow) return `amanhã às ${time}`
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) + ` ${time}`
}

export function DistribuicaoClient({ initialConfig, initialAgents }: Props) {
  const [config, setConfig] = useState<AutoAssignConfig>(initialConfig)
  const [agents, setAgents] = useState<AgentInfo[]>(initialAgents)
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  function flash(kind: "ok" | "error", text: string) {
    setFeedback({ kind, text })
    setTimeout(() => setFeedback(null), 3000)
  }

  function patch(p: Partial<AutoAssignConfig>) {
    setConfig((c) => ({ ...c, ...p }))
  }

  function handleSave() {
    setFeedback(null)
    startTransition(async () => {
      const result = await updateAutoAssignConfig(config)
      if ("error" in result) flash("error", result.error)
      else flash("ok", "Configuração salva")
    })
  }

  function toggleRole(role: string) {
    const next = config.eligible_roles.includes(role)
      ? config.eligible_roles.filter((r) => r !== role)
      : [...config.eligible_roles, role]
    if (next.length === 0) return  // pelo menos um deve estar marcado
    patch({ eligible_roles: next })
  }

  function toggleChannel(ch: string) {
    const next = config.channels.includes(ch)
      ? config.channels.filter((c) => c !== ch)
      : [...config.channels, ch]
    if (next.length === 0) return
    patch({ channels: next })
  }

  const isDisabled = !config.enabled

  return (
    <div className="space-y-6">

      {/* Master toggle */}
      <SectionCard>
        <div className="flex items-start gap-3">
          <Switch
            size="lg"
            checked={config.enabled}
            onChange={(next) => patch({ enabled: next })}
          />
          <div className="flex-1">
            <p className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="size-3.5 text-primary-600" />
              Distribuir novas conversas automaticamente
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Quando desligado, conversas caem no pool e o primeiro atendente que responder atende.
              Com auto-assign, cada conversa nova é atribuída a um atendente específico conforme a regra abaixo.
            </p>
          </div>
        </div>
      </SectionCard>

      <div className={isDisabled ? "opacity-50 pointer-events-none" : ""}>

        {/* Regras */}
        <SectionCard icon={SettingsIcon} title="Como distribuir">
          <div className="space-y-4">

            <FormRow
              label="Estratégia"
              hint="Como o sistema escolhe qual atendente recebe a próxima conversa."
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <StrategyCard
                  active={config.strategy === "round_robin"}
                  onClick={() => patch({ strategy: "round_robin" })}
                  title="Round-robin"
                  description="Alfabético, distribuição justa entre todos"
                />
                <StrategyCard
                  active={config.strategy === "least_busy"}
                  onClick={() => patch({ strategy: "least_busy" })}
                  title="Menos ocupado"
                  description="Quem tem menos conversas abertas recebe"
                />
              </div>
            </FormRow>

            <FormRow
              label="Quem pode receber"
              hint="Roles que entram na rotação. Atendentes é o padrão; owner/admin geralmente não atendem operacionalmente."
            >
              <div className="flex flex-wrap gap-2">
                {(["agent", "admin", "owner"] as const).map((role) => (
                  <CheckChip
                    key={role}
                    active={config.eligible_roles.includes(role)}
                    onClick={() => toggleRole(role)}
                    label={ROLE_LABEL[role]}
                  />
                ))}
              </div>
            </FormRow>

            <FormRow
              label="De quais canais"
              hint="Só conversas vindas dos canais marcados disparam auto-assign. Os outros caem no pool normalmente."
            >
              <div className="flex flex-wrap gap-2">
                {(["whatsapp", "site", "manual"] as const).map((ch) => (
                  <CheckChip
                    key={ch}
                    active={config.channels.includes(ch)}
                    onClick={() => toggleChannel(ch)}
                    label={CHANNEL_LABEL[ch]}
                  />
                ))}
              </div>
            </FormRow>

            <FormRow
              label="Limite diário por atendente"
              hint="Evita sobrecarga. Vazio = ilimitado. Quando todos os elegíveis estão no cap, a conversa vai pro pool."
            >
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={config.max_per_day ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.trim()
                    patch({ max_per_day: v === "" ? null : Math.max(1, Math.min(9999, Number(v) || 0)) })
                  }}
                  placeholder="sem limite"
                  min={1}
                  max={9999}
                  className="h-9 w-32 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 tabular-nums"
                />
                <span className="text-xs text-slate-500">conversas/dia</span>
              </div>
            </FormRow>

            <div className="pt-2 border-t border-slate-100 space-y-3">
              <Switch
                size="md"
                checked={config.skip_groups}
                onChange={(next) => patch({ skip_groups: next })}
                label="Pular conversas em grupo"
                description="Grupos não fazem sentido pra 1:1; recomendado deixar ligado."
              />

              <Switch
                size="md"
                checked={config.only_in_hours}
                onChange={(next) => patch({ only_in_hours: next })}
                label="Distribuir apenas em horário comercial"
                description={<>Usa a configuração de horário comercial (em <em>Mensagens automáticas</em>). Fora do horário, conversas caem no pool.</>}
              />
            </div>

          </div>
        </SectionCard>

        {/* Atendentes (pause individual) */}
        <div className="mt-6">
          <SectionCard
            icon={Users}
            title="Atendentes"
            description="Pause individualmente cada atendente. Útil pra férias, reunião, sobrecarga."
            flush
          >
            {agents.length === 0 ? (
              <EmptyState
                icon={Users}
                title="Sem atendentes ativos"
                description="Convide pessoas em Configurações → Equipe."
                bordered={false}
              />
            ) : (
              <div className="divide-y divide-slate-100">
                {agents.map((a) => (
                  <AgentRow
                    key={a.user_id}
                    agent={a}
                    onChange={(partial) => setAgents((prev) => prev.map((x) => x.user_id === a.user_id ? { ...x, ...partial } : x))}
                    onFlash={flash}
                  />
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      {/* Save bar sticky */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-card p-4 flex items-center gap-3 sticky bottom-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Salvar
        </button>
        {feedback && (
          <span className={`inline-flex items-center gap-1.5 text-xs ${feedback.kind === "ok" ? "text-emerald-700" : "text-red-600"}`}>
            {feedback.kind === "ok" ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
            {feedback.text}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Sub-componentes ────────────────────────────────────────

function StrategyCard({
  active, onClick, title, description,
}: {
  active: boolean
  onClick: () => void
  title: string
  description: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-3 rounded-lg border-2 transition-all ${
        active
          ? "border-primary bg-primary-50/50 ring-2 ring-primary/10"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <p className={`text-sm font-semibold ${active ? "text-primary-700" : "text-slate-900"}`}>{title}</p>
      <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{description}</p>
    </button>
  )
}

function CheckChip({
  active, onClick, label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg border transition-colors ${
        active
          ? "bg-primary-50 border-primary-200 text-primary-700"
          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
      }`}
    >
      {active && <CheckCircle2 className="size-3" />}
      {label}
    </button>
  )
}

function AgentRow({
  agent, onChange, onFlash,
}: {
  agent:    AgentInfo
  onChange: (partial: Partial<AgentInfo>) => void
  onFlash:  (kind: "ok" | "error", text: string) => void
}) {
  const [pending, startTransition] = useTransition()
  const [showOptions, setShowOptions] = useState(false)

  const isPaused = agent.auto_assign_paused
  const pausedUntilExpired = agent.auto_assign_paused_until && new Date(agent.auto_assign_paused_until).getTime() < Date.now()
  const effectivelyPaused = isPaused && !pausedUntilExpired

  function pauseFor(hours: number | null) {
    setShowOptions(false)
    const until = hours === null
      ? null
      : new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
    startTransition(async () => {
      const result = await setAgentPause(agent.user_id, true, until)
      if ("error" in result) onFlash("error", result.error)
      else {
        onChange({ auto_assign_paused: true, auto_assign_paused_until: until })
        onFlash("ok", `${agent.full_name ?? agent.email} pausado`)
      }
    })
  }

  function unpause() {
    startTransition(async () => {
      const result = await setAgentPause(agent.user_id, false, null)
      if ("error" in result) onFlash("error", result.error)
      else {
        onChange({ auto_assign_paused: false, auto_assign_paused_until: null })
        onFlash("ok", `${agent.full_name ?? agent.email} retomado`)
      }
    })
  }

  const displayName = agent.full_name ?? agent.email

  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <div className="size-9 rounded-full bg-primary-100 border border-primary-200 flex items-center justify-center shrink-0">
        <span className="text-xs font-bold text-primary-700">{displayName[0]?.toUpperCase()}</span>
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 truncate">{displayName}</p>
        <p className="text-xs text-slate-500 truncate">{agent.email} · {ROLE_LABEL[agent.role] ?? agent.role}</p>
      </div>

      <div className="shrink-0">
        {effectivelyPaused ? (
          <StatusDot
            tone="warning"
            label={`Pausado${agent.auto_assign_paused_until ? ` até ${formatPauseUntil(agent.auto_assign_paused_until)}` : ""}`}
          />
        ) : (
          <StatusDot tone="success" label="Recebendo conversas" />
        )}
      </div>

      <div className="shrink-0 relative">
        {effectivelyPaused ? (
          <button
            type="button"
            onClick={unpause}
            disabled={pending}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-[11px] font-semibold border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-md transition-colors disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
            Despausar
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setShowOptions((v) => !v)}
              disabled={pending}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-[11px] font-semibold border border-slate-200 bg-white hover:bg-amber-50 hover:border-amber-200 hover:text-amber-700 text-slate-600 rounded-md transition-colors disabled:opacity-50"
            >
              {pending ? <Loader2 className="size-3 animate-spin" /> : <Pause className="size-3" />}
              Pausar
            </button>

            {showOptions && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-lg shadow-soft border border-slate-200 z-10 overflow-hidden">
                {[
                  { hours: 1,    label: "Por 1 hora"      },
                  { hours: 4,    label: "Por 4 horas"     },
                  { hours: 24,   label: "Por 24 horas"    },
                  { hours: null, label: "Indefinido"      },
                ].map((opt) => (
                  <button
                    key={String(opt.hours)}
                    type="button"
                    onClick={() => pauseFor(opt.hours)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 text-slate-700"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
