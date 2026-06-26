import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

// ═══════════════════════════════════════════════════════════════
// Select — <select> nativo estilizado igual ao <Input> (design system)
// ═══════════════════════════════════════════════════════════════
// Native (acessível, mobile-friendly) com chevron próprio. Use no lugar de
// <select> cru pra manter altura/borda/foco consistentes nos forms e modais.

export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        className={cn(
          "h-9 w-full appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 text-sm text-slate-800",
          "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-300",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
    </div>
  )
}
