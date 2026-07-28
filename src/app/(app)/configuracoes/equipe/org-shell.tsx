import type { ReactNode } from "react"
import { OrgTabs } from "./org-tabs"

/** Casca da seção Organização — header no canvas (estilo Relatórios, design-system
    §2.2) + abas. Compartilhada pelas páginas de cada aba (Equipe · Departamentos). */
export function OrgShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full bg-canvas">
      <div className="px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Organização</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Pessoas, papéis e departamentos da conta
          </p>
        </div>
        <OrgTabs />
        {children}
      </div>
    </div>
  )
}
