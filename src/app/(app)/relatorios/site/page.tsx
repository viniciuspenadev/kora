import { auth } from "@/auth"
import Link from "next/link"
import { Globe, Users, Eye, UserPlus, MessageSquare, Percent, ExternalLink } from "lucide-react"
import { getSiteMetrics } from "@/lib/actions/reports"
import { PeriodPicker } from "@/components/relatorios/period-picker"
import { KpiCard } from "@/components/relatorios/kpi-card"
import { SectionCard } from "@/components/ui/section-card"
import { EmptyState } from "@/components/ui/empty-state"
import { hasModule } from "@/lib/modules"
import { ReportsTabs } from "../tabs"
import { parseFilters, formatNumber } from "../_helpers"
import { SiteCharts } from "./charts"

function shortPage(url: string | null): string {
  if (!url) return "—"
  try {
    const u = new URL(url)
    return (u.pathname + u.search) || "/"
  } catch {
    return url
  }
}

function whenLabel(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
}

export default async function RelatorioSitePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const sp       = await searchParams
  const filters  = parseFilters(sp)
  const session  = await auth()
  const tenantId = session?.user?.tenantId

  const [data, hasKanban, hasAi] = await Promise.all([
    getSiteMetrics(filters),
    tenantId ? hasModule(tenantId, "kanban")       : Promise.resolve(false),
    tenantId ? hasModule(tenantId, "ai_atendente") : Promise.resolve(false),
  ])

  const hasData = data.pageviews.current > 0 || data.leads.current > 0

  return (
    <div className="min-h-screen bg-canvas">
      <div className="px-6 py-6">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Relatórios</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Desempenho do widget do site: visitas, leads e conversão
            </p>
          </div>
          <PeriodPicker />
        </div>

        <ReportsTabs hasKanban={hasKanban} hasAi={hasAi} />

        {!hasData ? (
          <EmptyState
            icon={Globe}
            title="Sem dados no período"
            description="Quando o widget começar a receber visitas e leads, as métricas aparecem aqui. Confira se o widget está ligado e instalado no seu site."
          />
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
              <KpiCard
                label="Visitantes únicos"
                value={formatNumber(data.uniqueVisitors.current)}
                current={data.uniqueVisitors.current}
                previous={data.uniqueVisitors.previous}
                icon={<Users className="size-4" />}
              />
              <KpiCard
                label="Pageviews"
                value={formatNumber(data.pageviews.current)}
                current={data.pageviews.current}
                previous={data.pageviews.previous}
                icon={<Eye className="size-4" />}
              />
              <KpiCard
                label="Leads pelo site"
                value={formatNumber(data.leads.current)}
                current={data.leads.current}
                previous={data.leads.previous}
                icon={<UserPlus className="size-4" />}
              />
              <KpiCard
                label="Conversas de chat"
                value={formatNumber(data.chats.current)}
                current={data.chats.current}
                previous={data.chats.previous}
                icon={<MessageSquare className="size-4" />}
              />
              <KpiCard
                label="Taxa de conversão"
                value={`${data.conversionPct.current}%`}
                current={data.conversionPct.current}
                previous={data.conversionPct.previous}
                icon={<Percent className="size-4" />}
              />
            </div>

            {/* Série temporal */}
            <SiteCharts daily={data.daily} />

            {/* Aquisição */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              <SectionCard title="Top origens" description="Por onde os visitantes chegam (por visitas)">
                {data.topSources.length === 0 ? (
                  <p className="text-xs text-slate-400 py-3">Sem dados de origem no período.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {data.topSources.map((s) => (
                      <li key={s.source} className="flex items-center justify-between py-2.5">
                        <span className="text-sm text-slate-700 truncate">{s.source}</span>
                        <span className="text-sm font-semibold text-slate-900 tabular-nums">{formatNumber(s.visits)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              <SectionCard title="Páginas que mais convertem" description="Onde os leads são capturados (por leads)">
                {data.topPages.length === 0 ? (
                  <p className="text-xs text-slate-400 py-3">Nenhum lead capturado no período.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {data.topPages.map((p) => (
                      <li key={p.page} className="flex items-center justify-between py-2.5 gap-3">
                        <span className="text-sm text-slate-700 truncate font-mono text-xs" title={p.page}>{shortPage(p.page)}</span>
                        <span className="text-sm font-semibold text-slate-900 tabular-nums shrink-0">{formatNumber(p.leads)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </div>

            {/* Leads recentes */}
            <SectionCard title="Leads recentes" description="Últimos visitantes que viraram lead pelo site">
              {data.recentLeads.length === 0 ? (
                <p className="text-xs text-slate-400 py-3">Nenhum lead recente no período.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.recentLeads.map((l) => (
                    <li key={l.conversationId} className="flex items-center justify-between py-3 gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{l.name}</p>
                        <p className="text-xs text-slate-400 truncate">
                          {shortPage(l.page)} · {whenLabel(l.at)}
                        </p>
                      </div>
                      <Link
                        href={`/inbox?conversation=${l.conversationId}`}
                        className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 rounded-lg transition-colors shrink-0"
                      >
                        <ExternalLink className="size-3.5 text-primary-500" />
                        Abrir
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </>
        )}
      </div>
    </div>
  )
}
