"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"

// ═══════════════════════════════════════════════════════════════
// SectionTabs — abas underline (design-system §2.2). Padrão ÚNICO de
// navegação por abas em seções (Relatórios, Organização, …). Link-based
// (sub-rotas), item ativo por pathname exato. NÃO reimplementar inline.
// ═══════════════════════════════════════════════════════════════

export interface SectionTab {
  href:  string
  label: string
  /** default true — passe false pra esconder (feature-gate). */
  show?: boolean
  /** exibe pill "em breve". */
  soon?: boolean
}

export function SectionTabs({
  tabs,
  preserveQuery = false,
}: {
  tabs: SectionTab[]
  /** carrega a query string atual pros links (filtros que valem entre abas). */
  preserveQuery?: boolean
}) {
  const pathname = usePathname()
  const sp       = useSearchParams()
  const qs       = preserveQuery && sp.toString() ? `?${sp.toString()}` : ""

  return (
    <div className="flex items-center gap-1 mb-6 border-b border-slate-200 overflow-x-auto">
      {tabs.filter((t) => t.show !== false).map((t) => {
        const active = pathname === t.href
        return (
          <Link
            key={t.href}
            href={`${t.href}${qs}`}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px inline-flex items-center gap-1.5 whitespace-nowrap ${
              active
                ? "text-primary-700 border-primary"
                : "text-slate-600 border-transparent hover:text-slate-900"
            }`}
          >
            {t.label}
            {t.soon && (
              <span className="text-[9px] font-semibold bg-slate-100 text-slate-500 px-1 py-0.5 rounded uppercase">
                em breve
              </span>
            )}
          </Link>
        )
      })}
    </div>
  )
}
