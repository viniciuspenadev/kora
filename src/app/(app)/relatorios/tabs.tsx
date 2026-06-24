"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"

interface Props {
  hasKanban: boolean
  hasAi:     boolean
}

export function ReportsTabs({ hasKanban, hasAi }: Props) {
  const pathname = usePathname()
  const sp       = useSearchParams()
  const qs       = sp.toString() ? `?${sp.toString()}` : ""

  const tabs = [
    { href: "/relatorios",             label: "Geral",       show: true },
    { href: "/relatorios/atendimento", label: "Atendimento", show: true },
    { href: "/relatorios/funil",       label: "Funil",       show: hasKanban },
    { href: "/relatorios/origem",      label: "Origem",      show: true },
    { href: "/relatorios/anuncios",    label: "Anúncios",    show: true },
    { href: "/relatorios/ia",          label: "IA",          show: hasAi, soon: true },
  ]

  return (
    <div className="flex items-center gap-1 mb-6 border-b border-slate-200">
      {tabs.filter((t) => t.show).map((t) => {
        const active = pathname === t.href
        return (
          <Link
            key={t.href}
            href={`${t.href}${qs}`}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px inline-flex items-center gap-1.5 ${
              active
                ? "text-primary-700 border-primary"
                : "text-slate-600 border-transparent hover:text-slate-900"
            }`}
          >
            {t.label}
            {t.soon && <span className="text-[9px] font-semibold bg-slate-100 text-slate-500 px-1 py-0.5 rounded uppercase">em breve</span>}
          </Link>
        )
      })}
    </div>
  )
}
