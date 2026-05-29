"use client"

import {
  Users, Server, MessageCircle, Brain, Megaphone, Database, Contact,
  Infinity as InfinityIcon, AlertCircle, CheckCircle2, Mail,
} from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { LIMIT_META, type LimitInfo, type LimitResource } from "@/lib/limits-shared"

interface Props {
  limits:     LimitInfo[]
  tenantName: string
  tenantPlan: string
}

const PLAN_LABELS: Record<string, string> = {
  trial: "Trial", starter: "Starter", pro: "Pro", enterprise: "Enterprise",
}

const PLAN_BADGE: Record<string, string> = {
  trial:      "bg-amber-50 text-amber-700 border-amber-200",
  starter:    "bg-sky-50 text-sky-700 border-sky-200",
  pro:        "bg-emerald-50 text-emerald-700 border-emerald-200",
  enterprise: "bg-violet-50 text-violet-700 border-violet-200",
}

const RESOURCE_ICONS: Record<LimitResource, typeof Users> = {
  users:                Users,
  whatsapp_instances:   Server,
  contacts:             Contact,
  messages_per_month:   MessageCircle,
  broadcasts_per_month: Megaphone,
  storage_mb:           Database,
}

function formatNum(n: number, unit: string): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M${unit ? ` ${unit}` : ""}`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k${unit ? ` ${unit}` : ""}`
  return `${n.toLocaleString("pt-BR")}${unit ? ` ${unit}` : ""}`
}

export function UsageClient({ limits, tenantName, tenantPlan }: Props) {
  const overLimit  = limits.filter((l) => !l.ok)
  const nearLimit  = limits.filter((l) => l.ok && l.max && l.used / l.max >= 0.8)
  const healthy    = limits.filter((l) => l.ok && (!l.max || l.used / l.max < 0.8))

  return (
    <div className="space-y-6">

      {/* Hero — plano + status geral */}
      <SectionCard>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs text-slate-500 mb-1">Seu plano</p>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-bold px-3 py-1 rounded-lg border ${PLAN_BADGE[tenantPlan] ?? "bg-slate-50 text-slate-700 border-slate-200"}`}>
                {PLAN_LABELS[tenantPlan] ?? tenantPlan}
              </span>
              <span className="text-sm font-semibold text-slate-900">{tenantName}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {overLimit.length > 0 && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="size-3.5 text-red-700" />
                <span className="text-xs font-semibold text-red-700">
                  {overLimit.length} {overLimit.length === 1 ? "recurso no limite" : "recursos no limite"}
                </span>
              </div>
            )}
            {nearLimit.length > 0 && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertCircle className="size-3.5 text-amber-700" />
                <span className="text-xs font-semibold text-amber-700">
                  {nearLimit.length} próximo do limite
                </span>
              </div>
            )}
            {overLimit.length === 0 && nearLimit.length === 0 && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg">
                <CheckCircle2 className="size-3.5 text-emerald-700" />
                <span className="text-xs font-semibold text-emerald-700">
                  Tudo dentro dos limites
                </span>
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      {/* Recursos no limite (destaque) */}
      {overLimit.length > 0 && (
        <SectionCard
          title={
            <span className="flex items-center gap-2 text-red-700">
              <AlertCircle className="size-4" />
              Limites atingidos — ação necessária
            </span>
          }
        >
          <p className="text-xs text-slate-600 mb-3">
            Esses recursos chegaram ao limite. Operações relacionadas podem estar bloqueadas até que você libere espaço ou solicite aumento.
          </p>
          <div className="space-y-2">
            {overLimit.map((l) => <UsageRow key={l.resource} limit={l} />)}
          </div>
        </SectionCard>
      )}

      {/* Próximos do limite */}
      {nearLimit.length > 0 && (
        <SectionCard
          title={
            <span className="flex items-center gap-2 text-amber-700">
              <AlertCircle className="size-4" />
              Próximos do limite ({"≥"}80%)
            </span>
          }
        >
          <div className="space-y-2">
            {nearLimit.map((l) => <UsageRow key={l.resource} limit={l} />)}
          </div>
        </SectionCard>
      )}

      {/* Demais */}
      <SectionCard title="Todos os recursos">
        <div className="space-y-2">
          {[...overLimit, ...nearLimit, ...healthy].map((l) => (
            <UsageRow key={l.resource} limit={l} />
          ))}
        </div>
      </SectionCard>

      {/* Solicitar aumento */}
      <SectionCard
        title={
          <span className="flex items-center gap-2">
            <Mail className="size-3.5 text-primary-600" />
            Precisa de mais?
          </span>
        }
      >
        <p className="text-xs text-slate-600 leading-relaxed mb-3">
          Os limites mostrados refletem seu plano atual e podem ser ajustados sob demanda.
          Pra solicitar aumento de qualquer recurso, fale com o suporte:
        </p>
        <a
          href={`mailto:suporte@kora.app?subject=${encodeURIComponent("Solicitação de aumento de limite — " + tenantName)}&body=${encodeURIComponent(buildEmailBody(tenantName, tenantPlan, limits))}`}
          className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors"
        >
          <Mail className="size-3.5" />
          Solicitar aumento de limite
        </a>
        <p className="text-[10px] text-slate-400 mt-2">
          Geramos um email com seus limites atuais pré-preenchidos. Você pode editar antes de enviar.
        </p>
      </SectionCard>
    </div>
  )
}

// ── Row read-only ──────────────────────────────────────────────

function UsageRow({ limit }: { limit: LimitInfo }) {
  const meta = LIMIT_META[limit.resource]
  const Icon = RESOURCE_ICONS[limit.resource]

  const pct = limit.max && limit.max > 0 ? Math.min(100, Math.round((limit.used / limit.max) * 100)) : 0
  const isOver = !limit.ok
  const isNear = limit.max && limit.used / limit.max >= 0.8 && limit.ok

  const barColor   = isOver ? "bg-red-500" : isNear ? "bg-amber-500" : "bg-emerald-500"
  const textColor  = isOver ? "text-red-700" : isNear ? "text-amber-700" : "text-slate-700"
  const bgRow      = isOver ? "bg-red-50/50 border-red-100" : isNear ? "bg-amber-50/40 border-amber-100" : "bg-white border-slate-100"

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${bgRow}`}>
      <div className={`size-8 rounded-lg bg-slate-100 flex items-center justify-center ${textColor}`}>
        <Icon className="size-3.5" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <p className="text-sm font-semibold text-slate-900">{meta.label}</p>
          <p className={`text-xs font-semibold tabular-nums ${textColor}`}>
            {limit.max === null ? (
              <span className="inline-flex items-center gap-1">
                {formatNum(limit.used, meta.unit)} <InfinityIcon className="size-3" />
              </span>
            ) : (
              <>
                {formatNum(limit.used, meta.unit)}
                <span className="text-slate-400 font-normal"> / {formatNum(limit.max, meta.unit)}</span>
              </>
            )}
          </p>
        </div>

        {limit.max !== null && (
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        <p className="text-[11px] text-slate-500 mt-1.5">{meta.description}</p>
      </div>
    </div>
  )
}

function buildEmailBody(tenantName: string, plan: string, limits: LimitInfo[]): string {
  const lines = [
    `Olá, equipe Kora!`,
    ``,
    `Quero solicitar aumento de limite pra minha conta.`,
    ``,
    `Empresa: ${tenantName}`,
    `Plano atual: ${PLAN_LABELS[plan] ?? plan}`,
    ``,
    `Recursos que preciso aumentar (assinale ou edite):`,
    ``,
  ]
  for (const l of limits) {
    if (l.max === null) continue
    const meta = LIMIT_META[l.resource]
    const status = !l.ok ? " ← NO LIMITE" : (l.used / l.max >= 0.8 ? " ← próximo do limite" : "")
    lines.push(`[ ] ${meta.label}: usando ${l.used}/${l.max}${status}`)
  }
  lines.push("")
  lines.push("Comentários adicionais:")
  lines.push("")
  return lines.join("\n")
}
