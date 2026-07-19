"use client"

import Link from "next/link"
import {
  User, Network, BookOpen, Activity, ChevronRight, Sparkles, Lock,
} from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import type { StudioConfig } from "@/types/studio"

interface Props {
  config:         StudioConfig | null
  flowCount:      number
  knowledgeCount: number
  hasAi:          boolean   // add-on IA licenciado? sem ele, Persona/Conhecimento cadeados
}

export function StudioOverviewClient({ config, flowCount, knowledgeCount, hasAi }: Props) {
  const personaReady = !!(config?.identity_text?.trim() || config?.ai_name?.trim())

  return (
    <div className="space-y-6">
      {/* Status (o liga/desliga agora é da plataforma — o cliente não ativa mais aqui) */}
      <SectionCard
        title="Kora Studio"
        description="Motor de automação e IA da sua conta, gerenciado pela plataforma."
        icon={Sparkles}
      >
        <div className="flex items-center gap-2.5">
          <span className="size-2.5 rounded-full bg-emerald-500 shrink-0" />
          <p className="text-sm font-medium text-slate-900">Ativo</p>
          <span className="text-xs text-slate-400">Mensagens recebidas passam pelos seus fluxos e pela IA.</span>
        </div>
      </SectionCard>

      {/* Navegação */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        <NavCard
          href="/studio/persona"
          icon={User}
          title="Persona"
          subtitle={hasAi ? (personaReady ? "Identidade definida" : "Defina quem é a sua IA") : "Disponível no plano com IA"}
          locked={!hasAi}
        />
        <NavCard
          href="/studio/fluxos"
          icon={Network}
          title="Fluxos"
          subtitle={flowCount > 0 ? `${flowCount} fluxo${flowCount > 1 ? "s" : ""}` : "Monte seu primeiro fluxo"}
        />
        <NavCard
          href="/studio/conhecimento"
          icon={BookOpen}
          title="Base de conhecimento"
          subtitle={hasAi ? (knowledgeCount > 0 ? `${knowledgeCount} item${knowledgeCount > 1 ? "s" : ""}` : "Ensine sua IA sobre o negócio") : "Disponível no plano com IA"}
          locked={!hasAi}
        />
        <NavCard
          href="/studio/atividade"
          icon={Activity}
          title="Atividade da IA"
          subtitle="Turnos, tools e custo"
        />
      </div>
    </div>
  )
}

function NavCard({
  href, icon: Icon, title, subtitle, soon, locked,
}: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  title: string
  subtitle: string
  soon?: boolean
  locked?: boolean   // sem add-on IA: vitrine cadeada (upsell), não navega
}) {
  const disabled = soon || locked
  const inner = (
    <div className={`group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-colors ${disabled ? "" : "hover:border-primary-200 hover:bg-primary-50/40"}`}>
      <div className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${locked ? "bg-slate-100" : "bg-primary-50"}`}>
        <Icon className={`size-5 ${locked ? "text-slate-400" : "text-primary-600"}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-slate-900 truncate">{title}</p>
          {soon && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">
              em breve
            </span>
          )}
          {locked && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-700 bg-violet-50 rounded px-1.5 py-0.5">
              IA
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-0.5 truncate">{subtitle}</p>
      </div>
      {locked
        ? <Lock className="size-4 text-slate-300 shrink-0" />
        : !soon && <ChevronRight className="size-4 text-slate-300 group-hover:text-primary-600 shrink-0" />}
    </div>
  )

  if (disabled) return <div className="opacity-60 cursor-default" aria-disabled>{inner}</div>
  return <Link href={href}>{inner}</Link>
}
