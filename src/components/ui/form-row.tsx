import { cn } from "@/lib/utils"

interface Props {
  label:        string
  htmlFor?:     string
  description?: string
  hint?:        string
  error?:       string | null
  required?:    boolean
  children:     React.ReactNode
  className?:   string
  /**
   * Horizontal layout: label à esquerda, control à direita (desktop ≥ md).
   * Default: stacked (label em cima).
   */
  horizontal?:  boolean
}

export function FormRow({
  label, htmlFor, description, hint, error, required, children, className, horizontal,
}: Props) {
  if (horizontal) {
    return (
      <div className={cn("grid grid-cols-1 md:grid-cols-[200px_1fr] md:items-start gap-2 md:gap-6", className)}>
        <div className="pt-2">
          <label htmlFor={htmlFor} className="block text-xs font-semibold text-slate-700">
            {label}
            {required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          {description && (
            <p className="text-[11px] text-slate-400 mt-0.5">{description}</p>
          )}
        </div>
        <div>
          {children}
          {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
          {!error && hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-slate-700">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {description && (
        <p className="text-[11px] text-slate-400">{description}</p>
      )}
      {children}
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      {!error && hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}
