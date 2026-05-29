import { auth } from "@/auth"
import { hasModule } from "@/lib/modules"
import { getAdsReportData, listAdPlatforms } from "@/lib/actions/ads"
import { listAgentsForFilter } from "@/lib/actions/reports"
import { parseFilters, formatNumber } from "../_helpers"
import { PeriodPicker } from "@/components/relatorios/period-picker"
import { Filters } from "@/components/relatorios/filters"
import { KpiCard } from "@/components/relatorios/kpi-card"
import { SectionCard } from "@/components/ui/section-card"
import { ReportsTabs } from "../tabs"
import { PlatformFilter } from "./platform-filter"
import { TopAdsChart } from "./top-ads-chart"
import { AdsTables } from "./ads-tables"
import { Megaphone, Trophy, Target, Layers } from "lucide-react"

export default async function AnunciosReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; agent?: string; channel?: string; platform?: string }>
}) {
  const sp = await searchParams
  const baseFilters = parseFilters(sp)
  const session  = await auth()
  const tenantId = session?.user?.tenantId

  const [data, agents, platforms, hasKanban, hasAi] = await Promise.all([
    getAdsReportData({
      from:     baseFilters.from,
      to:       baseFilters.to,
      platform: sp.platform || undefined,
      agentId:  baseFilters.agentId,
    }),
    listAgentsForFilter(),
    listAdPlatforms(),
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
              Atribuição de leads vindos de anúncios Meta (Click-to-WhatsApp)
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <PlatformFilter available={platforms} />
            <Filters agents={agents} availableChannels={[]} />
            <PeriodPicker />
          </div>
        </div>

        <ReportsTabs hasKanban={hasKanban} hasAi={hasAi} />

        {/* KPIs com comparativo vs período anterior */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard
            label="Total de leads"
            value={formatNumber(data.kpis.totalLeads.current)}
            current={data.kpis.totalLeads.current}
            previous={data.kpis.totalLeads.previous}
            icon={<Megaphone className="size-4" />}
          />
          <KpiCard
            label="Taxa de conversão"
            value={`${data.kpis.conversionRate.current}%`}
            current={data.kpis.conversionRate.current}
            previous={data.kpis.conversionRate.previous}
            icon={<Target className="size-4" />}
          />
          <KpiCard
            label="Anúncios únicos"
            value={formatNumber(data.kpis.uniqueAds.current)}
            current={data.kpis.uniqueAds.current}
            previous={data.kpis.uniqueAds.previous}
            icon={<Layers className="size-4" />}
          />
          <KpiCard
            label={`Top: ${data.kpis.topPlatform.label}`}
            value={formatNumber(data.kpis.topPlatform.current)}
            current={data.kpis.topPlatform.current}
            previous={data.kpis.topPlatform.previous}
            icon={<Trophy className="size-4" />}
          />
        </div>

        {/* Chart: Top 10 anúncios por leads */}
        {data.top10.length > 0 && (
          <SectionCard className="mb-6">
            <div className="px-1 pb-3">
              <h2 className="text-sm font-semibold text-slate-900 mb-0.5">Top 10 anúncios — leads no período</h2>
              <p className="text-xs text-slate-500">
                Barras coloridas por plataforma · hover pra detalhes de conversão
              </p>
            </div>
            <TopAdsChart data={data.top10} />
          </SectionCard>
        )}

        {/* Tabelas: toggle entre Por anúncio (default) e Por contato */}
        <AdsTables byAd={data.byAd} byContact={data.byContact} />

        <p className="mt-4 text-[11px] text-slate-400">
          Atribuição vinda do bloco <code className="font-mono">externalAdReply</code> da 1ª mensagem do cliente. Apenas anúncios Click-to-WhatsApp aparecem aqui — clientes que vêm via site/catálogo não são detectáveis.
        </p>
      </div>
    </div>
  )
}
