"use client"

import { useEffect } from "react"
import type { LucideIcon } from "lucide-react"

// ═══════════════════════════════════════════════════════════════
// ModalShell — casca única dos modais de assinatura
// ═══════════════════════════════════════════════════════════════
// DECISÃO: mesma anatomia dos modais da ficha do negócio (header com ícone +
// título + subtítulo, corpo, rodapé slate-50 com as ações à direita). Modal de
// cobrança que parece diferente do resto do produto lê como pop-up de terceiro
// — exatamente a desconfiança que não se pode ter na hora de pagar.

export function ModalShell({
  title, desc, icon: Icon, accent = "bg-primary-50 text-primary-600",
  onClose, footer, children, size = "md",
}: {
  title:    string
  desc?:    string
  icon:     LucideIcon
  /** Classes do quadradinho do ícone — carrega o tom do assunto. */
  accent?:  string
  onClose:  () => void
  footer?:  React.ReactNode
  children: React.ReactNode
  size?:    "md" | "lg"
}) {
  // Esc fecha — no document, não no wrapper: o foco pode estar num input interno.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-xl shadow-xl w-full ${size === "lg" ? "max-w-lg" : "max-w-md"} overflow-hidden max-h-[90dvh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100 shrink-0">
          <span className={`size-8 rounded-lg grid place-items-center shrink-0 ${accent}`}>
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            {desc && <p className="text-[11px] text-slate-400 truncate">{desc}</p>}
          </div>
        </div>

        <div className="p-5 overflow-y-auto">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/** Botões dos modais — mesma régua do resto do app (h-9, text-xs, semibold). */
export const BTN_PRIMARY = "inline-flex items-center justify-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50"
export const BTN_WHITE   = "inline-flex items-center justify-center gap-1.5 h-9 px-4 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 rounded-lg transition-colors disabled:opacity-50"
export const BTN_GHOST   = "inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
