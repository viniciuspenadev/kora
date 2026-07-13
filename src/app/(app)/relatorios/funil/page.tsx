import { redirect } from "next/navigation"
import {
  getFunilMetrics, listAgentsForFilter,
  listTenantPipelines, getFunnelConfig,
} from "@/lib/actions/reports"
import { PeriodPicker } from "@/components/relatorios/period-picker"
import { Filters } from "@/components/relatorios/filters"
import { KpiCard } from "@/components/relatorios/kpi-card"
import { ReportsTabs } from "../tabs"
import { FunilCharts } from "./charts"
import { PipelineSelector } from "./pipeline-selector"
import { parseFilters, getTenantChannels, formatMoneyBRL, formatNumber } from "../_helpers"
import { auth } from "@/auth"
import { hasModule } from "@/lib/modules"
import { Target, Trophy, Clock, AlertOctagon } from "lucide-react"

export default async function FunilReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; agent?: string; channel?: string; pipeline?: string }>
}) {
  const sp       = await searchParams
  const filters  = parseFilters(sp)
  const session  = await auth()
  const tenantId = session?.user?.tenantId
  if (!tenantId) redirect("/auth/signin")

  const hasKanban = await hasModule(tenantId, "kanban")
  if (!hasKanban) redirect("/relatorios")

  const requestedPipelineId = sp.pipeline ?? null

  const [data, agents, availableChannels, hasAi, pipelines] = await Promise.all([
    getFunilMetrics(filters, requestedPipelineId),
    listAgentsForFilter(),
    getTenantChannels(tenantId),
    hasModule(tenantId, "ai_atendente"),
    listTenantPipelines(),
  ])

  // Config do pipeline atualmente selecionado (após resolução)
  const funnelConfig = data.pipelineId ? await getFunnelConfig(data.pipelineId) : null
  const isAdmin = ["owner", "admin"].includes(session.user.role)

  return (
    <div className="min-h-screen bg-canvas">
      <div className="px-6 py-6">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Relatórios</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Conversão do funil, valor ganho e motivos de perda
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {pipelines.length > 1 && (
              <PipelineSelector pipelines={pipelines} activeId={data.pipelineId} />
            )}
            <Filters agents={agents} availableChannels={availableChannels} />
            <PeriodPicker />
          </div>
        </div>

        <ReportsTabs hasKanban={hasKanban} hasAi={hasAi} />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard
            label="Taxa de conversão"
            value={`${data.conversionRatePct.current}%`}
            current={data.conversionRatePct.current}
            previous={data.conversionRatePct.previous}
            icon={<Target className="size-4" />}
          />
          <KpiCard
            label="Valor ganho"
            value={formatMoneyBRL(data.wonValueCents.current)}
            current={data.wonValueCents.current}
            previous={data.wonValueCents.previous}
            icon={<Trophy className="size-4" />}
          />
          <KpiCard
            label="Tempo médio até ganho"
            value={data.avgWinDays.current > 0 ? `${data.avgWinDays.current}d` : "—"}
            current={data.avgWinDays.current}
            previous={data.avgWinDays.previous}
            inverted
            icon={<Clock className="size-4" />}
          />
          <KpiCard
            label="Total no funil"
            value={formatNumber(data.stages.reduce((a, s) => a + s.count, 0))}
            current={data.stages.reduce((a, s) => a + s.count, 0)}
            previous={data.stages.reduce((a, s) => a + s.count, 0)}
            icon={<AlertOctagon className="size-4" />}
          />
        </div>

        <FunilCharts
          stages={data.stages}
          topLost={data.topLostReasons}
          pipelineId={data.pipelineId}
          funnelConfig={funnelConfig}
          canEdit={isAdmin}
        />
      </div>
    </div>
  )
}
