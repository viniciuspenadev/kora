import { getAgentReport } from "@/lib/reports/agents"
import { PeriodPicker } from "@/components/relatorios/period-picker"
import { AgentReport } from "@/components/relatorios/agent-report"
import { ReportsTabs } from "../tabs"
import { parseFilters } from "../_helpers"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { hasModule } from "@/lib/modules"

// Relatórios → Atendimento = o painel POR ATENDENTE (decisão do owner 2026-07-02:
// a antiga "Visão geral" foi eliminada — KPIs/heatmap migraram pra cá; leaderboard
// é a fonte única de carga por pessoa). Atendente (não-gestor) vê SÓ a própria
// ficha — performance dos colegas é visão de gestão.
export default async function AtendimentoReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const sp      = await searchParams
  const filters = parseFilters(sp)
  const session = await auth()
  if (!session?.user?.tenantId) redirect("/auth/signin")

  const tenantId  = session.user.tenantId
  const isManager = ["owner", "admin"].includes(session.user.role)

  const [report, hasKanban, hasAi] = await Promise.all([
    getAgentReport(tenantId, filters.from, filters.to),
    hasModule(tenantId, "kanban"),
    hasModule(tenantId, "ai_atendente"),
  ])

  // Não-gestor: enxerga apenas os próprios números (filtro no SERVER — nada dos
  // colegas chega ao client).
  const data = isManager
    ? report
    : { ...report, agents: report.agents.filter((a) => a.id === session.user.id) }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="px-6 py-6">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Relatórios</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Performance de atendimento, SLA e carga por agente
            </p>
          </div>
          <PeriodPicker />
        </div>

        <ReportsTabs hasKanban={hasKanban} hasAi={hasAi} />

        <AgentReport data={data} />
      </div>
    </div>
  )
}
