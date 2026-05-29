import { getOverviewMetrics, listAgentsForFilter } from "@/lib/actions/reports"
import { PeriodPicker } from "@/components/relatorios/period-picker"
import { Filters } from "@/components/relatorios/filters"
import { KpiCard } from "@/components/relatorios/kpi-card"
import { OverviewCharts } from "./charts"
import { ReportsTabs } from "./tabs"
import { parseFilters, getTenantChannels, formatSec, formatMoneyBRL, formatNumber } from "./_helpers"
import { auth } from "@/auth"
import { MessageSquare, Inbox, UserPlus, CheckCircle2, Clock, TrendingUp } from "lucide-react"
import { hasModule } from "@/lib/modules"

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; agent?: string; channel?: string }>
}) {
  const sp      = await searchParams
  const filters = parseFilters(sp)
  const session = await auth()
  const tenantId = session?.user?.tenantId

  const [data, agents, availableChannels, hasKanban, hasAi] = await Promise.all([
    getOverviewMetrics(filters),
    listAgentsForFilter(),
    tenantId ? getTenantChannels(tenantId) : Promise.resolve([]),
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
              Dashboard com métricas do seu atendimento e vendas
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Filters agents={agents} availableChannels={availableChannels} />
            <PeriodPicker />
          </div>
        </div>

        <ReportsTabs hasKanban={hasKanban} hasAi={hasAi} />

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          <KpiCard
            label="Conversas novas"
            value={formatNumber(data.newConversations.current)}
            current={data.newConversations.current}
            previous={data.newConversations.previous}
            icon={<Inbox className="size-4" />}
          />
          <KpiCard
            label="Mensagens trocadas"
            value={formatNumber(data.totalMessages.current)}
            current={data.totalMessages.current}
            previous={data.totalMessages.previous}
            icon={<MessageSquare className="size-4" />}
          />
          <KpiCard
            label="Contatos novos"
            value={formatNumber(data.newContacts.current)}
            current={data.newContacts.current}
            previous={data.newContacts.previous}
            icon={<UserPlus className="size-4" />}
          />
          <KpiCard
            label="Resolvidas"
            value={formatNumber(data.resolvedCount.current)}
            current={data.resolvedCount.current}
            previous={data.resolvedCount.previous}
            icon={<CheckCircle2 className="size-4" />}
          />
          <KpiCard
            label="Tempo 1ª resposta"
            value={formatSec(data.avgFirstResponseSec.current)}
            current={data.avgFirstResponseSec.current}
            previous={data.avgFirstResponseSec.previous}
            inverted
            icon={<Clock className="size-4" />}
          />
          <KpiCard
            label="Pipeline ativo"
            value={formatMoneyBRL(data.pipelineValueCents.current)}
            current={data.pipelineValueCents.current}
            previous={data.pipelineValueCents.previous}
            icon={<TrendingUp className="size-4" />}
          />
        </div>

        <OverviewCharts daily={data.daily} channels={data.channels} />
      </div>
    </div>
  )
}
