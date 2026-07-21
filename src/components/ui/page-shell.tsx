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
  /**
   * `bar` (default) — header full-width branco com ícone (design-system §2).
   * `list` — título grande NO CANVAS, sem barra branca nem ícone, descrição
   *   vira subtítulo (design-system §2.3). Pra páginas de lista/dashboard.
   */
  variant?:        "bar" | "list"
  children:        React.ReactNode
}

/**
 * Shell padrão de página em /(app) e (raramente) /(admin).
 *
 * - `variant="bar"` (default): header branco com ícone+título+descrição+ações.
 * - `variant="list"`: título no canvas + subtítulo + ações (§2.3), sem barra branca.
 *
 * Body com padding responsivo. Filhos decidem max-width interno.
 * Referência: `.claude/skills/design-system/SKILL.md` §2 / §2.3.
 */
export function PageShell({
  title,
  description,
  icon: Icon,
  iconWrapClass = "size-10 rounded-xl bg-[#004add]/10 flex items-center justify-center shrink-0",
  iconClass     = "size-5 text-[#004add]",
  actions,
  bodyClass,
  variant = "bar",
  children,
}: PageShellProps) {
  if (variant === "list") {
    return (
      <div className="min-h-full bg-canvas">
        {/* Respiro simétrico topo/baixo — mesmo padrão do header analítico (§2.1). */}
        <div className="px-4 sm:px-6 pt-10 pb-10">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h1>
              {description && (
                <p className="text-sm text-slate-500 mt-0.5 max-w-3xl">{description}</p>
              )}
            </div>
            {actions && (
              <div className="flex items-center gap-2 shrink-0">{actions}</div>
            )}
          </div>
        </div>
        <div className={bodyClass ?? "px-4 sm:px-6 pb-6"}>{children}</div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-canvas">
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

      <div className={bodyClass ?? "px-4 sm:px-6 py-6"}>{children}</div>
    </div>
  )
}
