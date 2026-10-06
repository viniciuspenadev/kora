import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  title?:       React.ReactNode
  description?: React.ReactNode
  icon?:        LucideIcon
  actions?:     React.ReactNode
  children:     React.ReactNode
  className?:   string
  bodyClassName?: string
  /**
   * Quando `flush`, o body fica sem padding — útil quando contém uma DataTable
   * ou lista que precisa ir borda-a-borda.
   */
  flush?:       boolean
  /**
   * `soft` (default) = borda clara + shadow-card (look atual).
   * `outline` = flat sem sombra + stroke escuro firme (look editorial, menos "cara de IA").
   * Em experimentação na página de detalhe do template.
   */
  variant?:     "soft" | "outline"
}

export function SectionCard({
  title, description, icon: Icon, actions, children, className, bodyClassName, flush, variant = "soft",
}: Props) {
  const hasHeader = title || actions
  const outline = variant === "outline"

  return (
    <section
      className={cn(
        "bg-white rounded-xl overflow-hidden",
        outline ? "border border-slate-900/15" : "border border-slate-200 shadow-card",
        className,
      )}
    >
      {hasHeader && (
        <header className={cn("flex items-start gap-3 px-5 py-4 border-b", outline ? "border-slate-900/10" : "border-slate-100")}>
          {Icon && (
            <div className="size-8 rounded-lg bg-primary-50 flex items-center justify-center shrink-0">
              <Icon className="size-4 text-primary-600" strokeWidth={1.75} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-sm font-semibold text-slate-900 leading-5">{title}</h2>}
            {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cn(!flush && "p-5", bodyClassName)}>{children}</div>
    </section>
  )
}
