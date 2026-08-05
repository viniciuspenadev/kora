import { auth } from "@/auth"
import Link from "next/link"
import { Globe, Users, Eye, UserPlus, MessageSquare, Percent, ExternalLink } from "lucide-react"
import { getSiteMetrics } from "@/lib/actions/reports"
import { PeriodPicker } from "@/components/relatorios/period-picker"
import { KpiCard } from "@/components/relatorios/kpi-card"
import { SectionCard } from "@/components/ui/section-card"
import { EmptyState } from "@/components/ui/empty-state"
import { supabaseAdmin } from "@/lib/supabase"
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

  const [data, hasKanban, hasAi, { data: widget }] = await Promise.all([
    getSiteMetrics(filters),
    tenantId ? hasModule(tenantId, "kanban")       : Promise.resolve(false),
    tenantId ? hasModule(tenantId, "ai_atendente") : Promise.resolve(false),
    tenantId
      ? supabaseAdmin.from("site_widget_config").select("enabled").eq("tenant_id", tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const hasData = data.pageviews.current > 0 || data.leads.current > 0
  // 🔴 SEM WIDGET LIGADO, "sem dados" é uma resposta que não ajuda ninguém. A tela dizia
  //    "Sem dados no período" e sugeria, de passagem, "confira se o widget está ligado" —
  //    sem botão e **sem saber se estava**. As duas situações são diferentes e pedem
  //    coisas diferentes: uma é esperar, a outra é agir. Tratá-las igual faz a pessoa
  //    achar que o produto não funciona quando ela simplesmente não ligou o widget.
  const widgetLigado = (widget as { enabled?: boolean } | null)?.enabled === true

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

        {!widgetLigado ? (
          <EmptyState
            icon={Globe}
            title="Ative o widget do site para ver este relatório"
            description="Este relatório mede o chat do seu site: visitas, leads capturados e conversão. Enquanto o widget estiver desligado não há o que medir — ligue, cole o código no seu site e os números começam a aparecer aqui."
            action={
              <Link href="/configuracoes/site" className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors">
                Configurar o widget
              </Link>
            }
          />
        ) : !hasData ? (
          <EmptyState
            icon={Globe}
            title="Sem dados no período"
            // ⚠️ Aqui o widget JÁ ESTÁ ligado — então some o "confira se está ligado", que
            //    mandaria a pessoa conferir algo que a gente acabou de confirmar.
            description="O widget está ativo. Assim que ele receber visitas e leads no período escolhido, as métricas aparecem aqui — confirme que o código está instalado no site."
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
