import type { LucideIcon } from "lucide-react"

interface PageShellProps {
  title:           string
  description?:    string
  icon?:           LucideIcon
  iconWrapClass?:  string  // override do container do ícone (bg/cor)
  iconClass?:      string  // override do ícone em si (cor/tamanho)
  actions?:        React.ReactNode
  /** Padding do body. Default cobre mobile + desktop. */
  bodyClass?:      string
  children:        React.ReactNode
}

/**
 * Shell padrão de página em /(app) e (raramente) /(admin).
 * Header full-width branco com ícone+título+descrição+ações.
 * Body com padding responsivo (`px-4 sm:px-6 py-6`).
 *
 * Filhos decidem max-width interno (se for form, use max-w-3xl mx-auto).
 *
 * Referência: `.claude/skills/design-system/SKILL.md` §Page Shell.
 */
export function PageShell({
  title,
  description,
  icon: Icon,
  iconWrapClass = "size-10 rounded-xl bg-[#004add]/10 flex items-center justify-center shrink-0",
  iconClass     = "size-5 text-[#004add]",
  actions,
  bodyClass     = "px-4 sm:px-6 py-6",
  children,
}: PageShellProps) {
  return (
    <div className="min-h-full bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-5">
        <div className="flex items-center gap-3">
          {Icon && (
            <div className={iconWrapClass}>
              <Icon className={iconClass} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight truncate">
              {title}
            </h1>
            {description && (
              <p className="text-xs text-slate-400 mt-0.5 line-clamp-2 sm:line-clamp-1">
                {description}
              </p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2 shrink-0">
              {actions}
            </div>
          )}
        </div>
      </div>

      <div className={bodyClass}>{children}</div>
    </div>
  )
}
