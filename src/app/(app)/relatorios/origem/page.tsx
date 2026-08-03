import { getOrigemMetrics, listAgentsForFilter } from "@/lib/actions/reports"
import { PeriodPicker } from "@/components/relatorios/period-picker"
import { Filters } from "@/components/relatorios/filters"
import { KpiCard } from "@/components/relatorios/kpi-card"
import { ReportsTabs } from "../tabs"
import { OrigemCharts } from "./charts"
import { InstanceBreakdown } from "@/components/relatorios/instance-breakdown"
import { parseFilters, getTenantChannels, getTenantInstances, formatMoneyBRL, formatNumber } from "../_helpers"
import { auth } from "@/auth"
import { hasModule } from "@/lib/modules"
import { Globe, Megaphone, Users } from "lucide-react"

export default async function OrigemReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; agent?: string; channel?: string }>
}) {
  const sp       = await searchParams
  const filters  = parseFilters(sp)
  const session  = await auth()
  const tenantId = session?.user?.tenantId

  const [data, agents, availableChannels, availableInstances, hasKanban, hasAi] = await Promise.all([
    getOrigemMetrics(filters),
    listAgentsForFilter(),
    tenantId ? getTenantChannels(tenantId) : Promise.resolve([]),
    tenantId ? getTenantInstances(tenantId) : Promise.resolve([]),
    tenantId ? hasModule(tenantId, "kanban")       : Promise.resolve(false),
    tenantId ? hasModule(tenantId, "ai_atendente") : Promise.resolve(false),
  ])

  const totalContacts = data.byChannel.reduce((a, b) => a + b.contacts, 0)
  const topSource = data.byChannel[0] // já vem ordenado desc

  return (
    <div className="min-h-screen bg-canvas">
      <div className="px-6 py-6">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Relatórios</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Origem dos contatos, distribuição por canal e atribuição de campanhas
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
            label="Total de contatos"
            value={formatNumber(totalContacts)}
            current={totalContacts}
            previous={totalContacts}
            icon={<Users className="size-4" />}
          />
          <KpiCard
            label="Canal principal"
            value={topSource?.label ?? "—"}
            current={topSource?.contacts ?? 0}
            previous={topSource?.contacts ?? 0}
            icon={<Globe className="size-4" />}
          />
          <KpiCard
            label="Vindos de anúncio"
            value={formatNumber(data.ctwaCount.current)}
            current={data.ctwaCount.current}
            previous={data.ctwaCount.previous}
            icon={<Megaphone className="size-4" />}
          />
          <KpiCard
            label="Valor médio estimado"
            value={formatMoneyBRL(
              data.byChannel.length === 0 ? 0 :
              Math.round(data.byChannel.reduce((a, c) => a + c.avgEstimateCents, 0) / data.byChannel.length)
            )}
            current={data.byChannel.reduce((a, c) => a + c.avgEstimateCents, 0)}
            previous={data.byChannel.reduce((a, c) => a + c.avgEstimateCents, 0)}
            icon={<Globe className="size-4" />}
          />
        </div>

        <OrigemCharts
          byChannel={data.byChannel}
          dailyByChannel={data.dailyByChannel}
          topCampaigns={data.topCampaigns}
          totalContacts={totalContacts}
        />

        {availableInstances.length > 1 && (
          <InstanceBreakdown rows={data.byInstance} instances={availableInstances} subtitle="Contatos e conversas por número de WhatsApp" />
        )}
      </div>
    </div>
  )
}
