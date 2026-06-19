import { getAtendimentoMetrics, listAgentsForFilter } from "@/lib/actions/reports"
import { PeriodPicker } from "@/components/relatorios/period-picker"
import { Filters } from "@/components/relatorios/filters"
import { KpiCard } from "@/components/relatorios/kpi-card"
import { ReportsTabs } from "../tabs"
import { AtendimentoCharts } from "./charts"
import { parseFilters, getTenantChannels, getTenantInstances, formatSec, formatNumber } from "../_helpers"
import { auth } from "@/auth"
import { Clock, CheckCircle2, Timer, Zap } from "lucide-react"
import { hasModule } from "@/lib/modules"

export default async function AtendimentoReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; agent?: string; channel?: string }>
}) {
  const sp       = await searchParams
  const filters  = parseFilters(sp)
  const session  = await auth()
  const tenantId = session?.user?.tenantId

  const [data, agents, availableChannels, availableInstances, hasKanban, hasAi] = await Promise.all([
    getAtendimentoMetrics(filters),
    listAgentsForFilter(),
    tenantId ? getTenantChannels(tenantId) : Promise.resolve([]),
    tenantId ? getTenantInstances(tenantId) : Promise.resolve([]),
    tenantId ? hasModule(tenantId, "kanban")       : Promise.resolve(false),
    tenantId ? hasModule(tenantId, "ai_atendente") : Promise.resolve(false),
  ])

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="px-6 py-6">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Relatórios</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Performance de atendimento, SLA e carga por agente
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Filters agents={agents} availableChannels={availableChannels} availableInstances={availableInstances} />
            <PeriodPicker />
          </div>
        </div>

        <ReportsTabs hasKanban={hasKanban} hasAi={hasAi} />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard
            label="Tempo 1ª resposta"
            value={formatSec(data.avgFirstResponseSec.current)}
            current={data.avgFirstResponseSec.current}
            previous={data.avgFirstResponseSec.previous}
            inverted
            icon={<Clock className="size-4" />}
          />
          <KpiCard
            label="Tempo até resolver"
            value={formatSec(data.avgResolutionSec.current)}
            current={data.avgResolutionSec.current}
            previous={data.avgResolutionSec.previous}
            inverted
            icon={<Timer className="size-4" />}
          />
          <KpiCard
            label="SLA < 5min"
            value={`${data.withinSLA5min.current}%`}
            current={data.withinSLA5min.current}
            previous={data.withinSLA5min.previous}
            icon={<Zap className="size-4" />}
          />
          <KpiCard
            label="Resolvidas"
            value={formatNumber(data.resolvedCount.current)}
            current={data.resolvedCount.current}
            previous={data.resolvedCount.previous}
            icon={<CheckCircle2 className="size-4" />}
          />
        </div>

        <AtendimentoCharts
          firstResponseDaily={data.firstResponseDaily}
          resolutionDaily={data.resolutionDaily}
          heatmap={data.heatmap}
          agentLoad={data.agentLoad}
        />
      </div>
    </div>
  )
}
