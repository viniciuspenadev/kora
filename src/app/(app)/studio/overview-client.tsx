"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import {
  AlertCircle, User, Network, BookOpen, Activity, ChevronRight, Sparkles,
} from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { setStudioEnabled } from "@/lib/actions/studio/config"
import type { StudioConfig } from "@/types/studio"

interface Props {
  config:         StudioConfig | null
  flowCount:      number
  knowledgeCount: number
}

export function StudioOverviewClient({ config, flowCount, knowledgeCount }: Props) {
  const [enabled, setEnabled] = useState(config?.ai_enabled ?? false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const personaReady = !!(config?.identity_text?.trim() || config?.ai_name?.trim())

  function toggle() {
    const next = !enabled
    setEnabled(next)              // optimistic
    setError(null)
    startTransition(async () => {
      const r = await setStudioEnabled(next)
      if (r?.error) { setEnabled(!next); setError(r.error) }
    })
  }

  return (
    <div className="space-y-6">
      {/* Master switch */}
      <SectionCard
        title="Automação inteligente"
        description="Liga o motor do Studio. Com isso desligado, a IA e os fluxos não atuam."
        icon={Sparkles}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900">
              {enabled ? "Ativada" : "Desativada"}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {enabled
                ? "Mensagens recebidas passam pelos seus fluxos e pela IA."
                : "Nada é automatizado enquanto estiver desligada."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={toggle}
            disabled={pending}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              enabled ? "bg-primary" : "bg-slate-200"
            }`}
          >
            <span
              className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform ${
                enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
        {error && (
          <div className="mt-3 flex items-center gap-2 text-xs text-danger">
            <AlertCircle className="size-3.5" /> {error}
          </div>
        )}
      </SectionCard>

      {/* Navegação */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        <NavCard
          href="/studio/persona"
          icon={User}
          title="Persona"
          subtitle={personaReady ? "Identidade definida" : "Defina quem é a sua IA"}
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
          subtitle={knowledgeCount > 0 ? `${knowledgeCount} item${knowledgeCount > 1 ? "s" : ""}` : "Ensine sua IA sobre o negócio"}
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
  href, icon: Icon, title, subtitle, soon,
}: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  title: string
  subtitle: string
  soon?: boolean
}) {
  const inner = (
    <div className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-primary-200 hover:bg-primary-50/40">
      <div className="size-10 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
        <Icon className="size-5 text-primary-600" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-slate-900 truncate">{title}</p>
          {soon && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">
              em breve
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-0.5 truncate">{subtitle}</p>
      </div>
      {!soon && <ChevronRight className="size-4 text-slate-300 group-hover:text-primary-600 shrink-0" />}
    </div>
  )

  if (soon) return <div className="opacity-60 cursor-default" aria-disabled>{inner}</div>
  return <Link href={href}>{inner}</Link>
}
