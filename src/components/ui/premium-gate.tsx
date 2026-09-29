"use client"

import { Lock } from "lucide-react"

// ═══════════════════════════════════════════════════════════════
// PremiumGate — mostra um recurso BLOQUEADO (upsell), não o esconde
// ═══════════════════════════════════════════════════════════════
// `locked=false` → renderiza os filhos normalmente.
// `locked=true`  → filhos esmaecidos + sem clique, selo 🔒 Premium e CTA.
// ⚠️ É COSMÉTICO: a trava real é o backend (entitlement por módulo). Aqui só
//    comunica + bloqueia a interação visual. Serve pra qualquer feature premium.

export function PremiumGate({
  locked, description, ctaLabel = "Quero ativar", onCta, children,
}: {
  locked: boolean
  description?: string
  ctaLabel?: string
  onCta?: () => void
  children: React.ReactNode
}) {
  if (!locked) return <>{children}</>
  return (
    <div className="relative rounded-xl border border-violet-200 bg-violet-50/30 overflow-hidden">
      <span className="absolute top-2 right-2 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-semibold ring-1 ring-violet-200">
        <Lock className="size-3" /> Premium
      </span>
      <div className="opacity-50 pointer-events-none select-none">{children}</div>
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-violet-200 bg-violet-50">
        <p className="text-xs text-violet-900">
          <span className="font-semibold">Recurso premium.</span> {description ?? "Disponível no upgrade do plano."}
        </p>
        {onCta && (
          <button type="button" onClick={onCta} className="shrink-0 text-xs font-semibold text-violet-700 hover:text-violet-900 underline">
            {ctaLabel}
          </button>
        )}
      </div>
    </div>
  )
}
