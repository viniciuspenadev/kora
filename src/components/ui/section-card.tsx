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
}

export function SectionCard({
  title, description, icon: Icon, actions, children, className, bodyClassName, flush,
}: Props) {
  const hasHeader = title || actions

  return (
    <section
      className={cn(
        "bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden",
        className,
      )}
    >
      {hasHeader && (
        <header className="flex items-start gap-3 px-5 py-4 border-b border-slate-100">
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
