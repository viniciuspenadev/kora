"use client"

import { SectionTabs } from "@/components/ui/section-tabs"

/** Abas da seção Organização (Configurações). Slug de rota segue `equipe` por
    compat; o rótulo visível é "Organização" (header) / "Equipe" (aba de pessoas). */
export function OrgTabs() {
  return (
    <SectionTabs
      tabs={[
        { href: "/configuracoes/equipe",               label: "Equipe" },
        { href: "/configuracoes/equipe/departamentos", label: "Departamentos" },
        { href: "/configuracoes/equipe/unidades",      label: "Unidades" },
      ]}
    />
  )
}
