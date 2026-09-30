"use client"

// ═══════════════════════════════════════════════════════════════
// Switch — toggle slide left→right (substitui checkbox em toggles on/off)
// ═══════════════════════════════════════════════════════════════
// Acessível: usa role="switch" + aria-checked.
// Trigger: click no track ou no thumb. Não use pra opção dentro de
// múltipla escolha (use checkbox tradicional pra checkboxes plurais).

import { cn } from "@/lib/utils"

interface Props {
  checked:     boolean
  onChange:    (next: boolean) => void
  disabled?:   boolean
  size?:       "sm" | "md" | "lg"
  label?:      string                  // visible label à direita
  description?: React.ReactNode        // texto auxiliar abaixo (com Switch grande)
  id?:         string
  className?:  string
}

const sizes = {
  sm: { track: "h-4 w-7",    thumb: "size-3",   translate: "translate-x-3"   },
  md: { track: "h-5 w-9",    thumb: "size-4",   translate: "translate-x-4"   },
  lg: { track: "h-6 w-11",   thumb: "size-5",   translate: "translate-x-5"   },
}

export function Switch({
  checked, onChange, disabled, size = "md", label, description, id, className,
}: Props) {
  const s = sizes[size]

  const switchEl = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      id={id}
      className={cn(
        "relative inline-flex shrink-0 rounded-full transition-colors duration-200",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        s.track,
        checked ? "bg-primary" : "bg-slate-300",
      )}
    >
      <span
        className={cn(
          "pointer-events-none absolute top-0.5 left-0.5 inline-block rounded-full bg-white shadow-sm",
          "transition-transform duration-200 ease-out",
          s.thumb,
          checked && s.translate,
        )}
      />
    </button>
  )

  // Apenas o switch (sem label)
  if (!label && !description) {
    return <span className={className}>{switchEl}</span>
  }

  // Switch + label (clicável no label inteiro)
  return (
    <label
      className={cn(
        "flex items-start gap-3",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        className,
      )}
    >
      {switchEl}
      <div className="flex-1 min-w-0 select-none">
        {label && <span className="text-sm font-medium text-slate-900 block leading-tight">{label}</span>}
        {description && <span className="text-[11px] text-slate-500 block mt-0.5 leading-relaxed">{description}</span>}
      </div>
    </label>
  )
}
