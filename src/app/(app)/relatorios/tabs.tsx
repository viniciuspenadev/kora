"use client"

import { SectionTabs } from "@/components/ui/section-tabs"

interface Props {
  hasKanban: boolean
  hasAi:     boolean
}

export function ReportsTabs({ hasKanban, hasAi }: Props) {
  return (
    <SectionTabs
      preserveQuery
      tabs={[
        { href: "/relatorios",             label: "Geral" },
        { href: "/relatorios/atendimento", label: "Atendimento" },
        { href: "/relatorios/funil",       label: "Funil",    show: hasKanban },
        { href: "/relatorios/origem",      label: "Origem" },
        { href: "/relatorios/site",        label: "Site" },
        { href: "/relatorios/anuncios",    label: "Anúncios" },
        { href: "/relatorios/ia",          label: "IA",       show: hasAi, soon: true },
      ]}
    />
  )
}
