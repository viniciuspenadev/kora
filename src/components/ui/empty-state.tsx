import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  icon?:        LucideIcon
  title:        string
  description?: string
  action?:      React.ReactNode
  className?:   string
  bordered?:    boolean
}

export function EmptyState({ icon: Icon, title, description, action, className, bordered = true }: Props) {
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center px-6 py-12 rounded-xl bg-white",
        bordered && "border border-dashed border-slate-200",
        className,
      )}
    >
      {Icon && (
        <div className="size-10 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center mb-4">
          <Icon className="size-5 text-slate-400" strokeWidth={1.75} />
        </div>
      )}
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {description && (
        <p className="text-xs text-slate-500 mt-1 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
