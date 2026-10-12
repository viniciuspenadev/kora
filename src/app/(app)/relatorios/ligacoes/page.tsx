import Link from "next/link"
import { auth } from "@/auth"
import { getViewerScope } from "@/lib/visibility"
import { redirect } from "next/navigation"
import { PhoneOutgoing, Clock, Users, Smartphone, ArrowUpRight } from "lucide-react"
import { hasModule } from "@/lib/modules"
import { getVoiceReport } from "@/lib/actions/voice-reports"
import { listAgentsForFilter } from "@/lib/actions/reports"
import { callResultLabels } from "@/lib/voice/report"
import { formatPhoneDisplay } from "@/lib/phone-utils"
import { PeriodPicker } from "@/components/relatorios/period-picker"
import { ReportsTabs } from "../tabs"
import { getTenantInstances, formatSec } from "../_helpers"
import { CallFilters } from "./filters"

export const dynamic = "force-dynamic"
type Search = { from?: string; to?: string; agent?: string; instance?: string; result?: string; q?: string; page?: string }
function defaultPeriod() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map(p => [p.type, p.value]))
  const day = Date.parse(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`)
  return { from: new Date(day - 6 * 86400_000).toISOString().slice(0, 10), to: new Date(day + 86400_000).toISOString().slice(0, 10) }
}
export default async function CallsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await auth()
  if (!session?.user?.tenantId) redirect("/auth/signin")
  const scope = await getViewerScope()
  if (!scope.isAdmin) redirect("/inbox")
  const sp = await searchParams, tenantId = session.user.tenantId
  const period = sp.from && sp.to ? { from: sp.from, to: sp.to } : defaultPeriod()
  const [agents, instances, hasKanban, hasAi] = await Promise.all([
    listAgentsForFilter(), getTenantInstances(tenantId), hasModule(tenantId, "kanban"), hasModule(tenantId, "ai_atendente"),
  ])
  let report: Awaited<ReturnType<typeof getVoiceReport>> | null = null, failure: string | null = null
  try { report = await getVoiceReport({ ...period, agent: sp.agent, instance: sp.instance, result: sp.result, q: sp.q?.slice(0, 100), page: Number(sp.page || 1) }) }
  catch (error) { failure = error instanceof Error ? error.message : "Não foi possível carregar o relatório" }
  const dateTime = (value: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(value))
  const pageHref = (page: number) => {
    const params = new URLSearchParams(Object.entries(sp).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    params.set("page", String(page)); return `/relatorios/ligacoes?${params}`
  }
  return <div className="min-h-screen bg-canvas px-6 py-6">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-slate-900">Relatórios</h1><p className="mt-0.5 text-sm text-slate-500">Ligações feitas pelo Kora · histórico por atendente e número</p></div>
      <PeriodPicker timeZone="America/Sao_Paulo" />
    </div>
    <ReportsTabs hasKanban={hasKanban} hasAi={hasAi} />
    <CallFilters agents={agents} instances={instances} />
    {failure ? <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">{failure}. Ajuste os filtros ou tente atualizar.</div> : report && <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6">
        {[
          { label: "Tentativas", value: String(report.metrics.total), icon: PhoneOutgoing },
          { label: "Conexão observada", value: String(report.metrics.connected), icon: Users },
          { label: "Em andamento", value: String(report.metrics.active), icon: PhoneOutgoing },
          { label: "Não iniciadas", value: String(report.metrics.failed), icon: PhoneOutgoing },
          { label: "Não confirmadas", value: String(report.metrics.unconfirmed), icon: Smartphone },
          { label: "Tempo conhecido", value: report.metrics.durationCount ? `≈ ${report.metrics.totalSeconds === 0 ? "0s" : formatSec(report.metrics.totalSeconds)}` : "—", icon: Clock },
        ].map(item => <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-soft"><item.icon className="mb-2 size-4 text-indigo-500" /><p className="text-[11px] font-semibold uppercase text-slate-500">{item.label}</p><p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{item.value}</p></div>)}
      </div>
      <div className="mb-5 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-xs leading-relaxed text-indigo-900">
        Horários de Brasília. A duração é aproximada e aparece somente quando a conexão foi observada. Uma ligação encerrada sem conexão confirmada não significa necessariamente que o cliente não atendeu.
        {report.legacyCount > 0 && <span className="mt-1 block">{report.legacyCount} registro(s) anterior(es) usam o número atualmente vinculado à conversa.</span>}
      </div>
      {report.byNumber.length > 0 && <div className="mb-5 flex flex-wrap gap-2">{report.byNumber.map((line, i) => <div key={i} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"><span className="font-semibold text-slate-700">{line.label}</span><span className="ml-2 text-slate-500">{line.total} tentativa(s) · {line.connected} conexão(ões) observada(s)</span></div>)}</div>}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-soft">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><h2 className="text-sm font-semibold text-slate-900">Histórico de ligações</h2><span className="text-xs text-slate-400">Atualizado às {dateTime(report.snapshotAt)}</span></div>
        {report.rows.length === 0 ? <div className="px-5 py-12 text-center"><PhoneOutgoing className="mx-auto mb-3 size-8 text-slate-300" /><p className="text-sm font-medium text-slate-700">Nenhuma ligação neste período</p><p className="mt-1 text-xs text-slate-500">Ajuste os filtros. O histórico começa com a ativação do registro de ligações no Kora.</p></div> : <div className="overflow-x-auto"><table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500"><tr>{["Data e hora", "Contato", "Atendente", "Número de origem", "Resultado", "Duração", "Conversa"].map(label => <th key={label} className="whitespace-nowrap px-4 py-3 font-semibold">{label}</th>)}</tr></thead>
          <tbody>{report.rows.map(row => <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/70">
            <td className="whitespace-nowrap px-4 py-3 text-slate-600">{dateTime(row.startedAt)}</td>
            <td className="px-4 py-3"><p className="font-medium text-slate-800">{row.contact}</p><p className="mt-0.5 whitespace-nowrap text-[11px] text-slate-400">{row.phone ? formatPhoneDisplay(row.phone) : "—"}</p></td>
            <td className="px-4 py-3 text-slate-600">{row.actor}</td><td className="px-4 py-3 text-slate-600">{row.instanceLabel}</td>
            <td className="px-4 py-3"><span className={`inline-block whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold ${row.result === "connected" ? "bg-emerald-50 text-emerald-700" : row.result === "active" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>{callResultLabels[row.result]}</span></td>
            <td className="whitespace-nowrap px-4 py-3 font-mono text-slate-600">{row.durationSeconds !== null ? `≈ ${row.durationSeconds === 0 ? "0s" : formatSec(row.durationSeconds)}` : "—"}</td>
            <td className="px-4 py-3">{row.conversationId && <Link href={`/inbox?conversation=${row.conversationId}`} className="inline-flex items-center gap-1 text-indigo-600 hover:underline">Abrir <ArrowUpRight className="size-3" /></Link>}</td>
          </tr>)}</tbody>
        </table></div>}
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500"><span>Página {report.page} de {report.pageCount} · {report.metrics.total} registro(s)</span><div className="flex gap-3">{report.page > 1 && <Link className="font-medium text-indigo-600" href={pageHref(report.page - 1)}>Anterior</Link>}{report.page < report.pageCount && <Link className="font-medium text-indigo-600" href={pageHref(report.page + 1)}>Próxima</Link>}</div></div>
      </div>
    </>}
  </div>
}
