"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  AlertCircle, AlertTriangle, BarChart3, ExternalLink, History, Phone,
  Reply, Send, CheckCheck, Eye, MousePointerClick, Trash2,
} from "lucide-react"
import {
  getOfficialTemplateAnalytics, deleteOfficialTemplateById,
} from "@/lib/actions/whatsapp-official"
import type {
  MetaTemplate, TemplateAnalytics, TemplateAnalyticsPoint,
} from "@/lib/providers/meta-cloud-provider"
import { StatusDot } from "@/components/ui/status-dot"
import { SectionCard } from "@/components/ui/section-card"
import { EmptyState } from "@/components/ui/empty-state"
import { DangerConfirm } from "@/components/ui/danger-confirm"
import { TemplatePreview, comp, bodyText, renderVars, countVars } from "./template-preview"

type Tone = "success" | "warning" | "danger" | "neutral"

const STATUS: Record<string, { tone: Tone; label: string }> = {
  APPROVED: { tone: "success", label: "Aprovado" },
  PENDING:  { tone: "warning", label: "Em análise" },
  REJECTED: { tone: "danger",  label: "Reprovado" },
  PAUSED:   { tone: "neutral", label: "Pausado" },
  DISABLED: { tone: "neutral", label: "Desabilitado" },
}
const QUALITY: Record<string, { tone: Tone; label: string }> = {
  GREEN:   { tone: "success", label: "Alta" },
  YELLOW:  { tone: "warning", label: "Média" },
  RED:     { tone: "danger",  label: "Baixa" },
  UNKNOWN: { tone: "neutral", label: "—" },
}
const CATEGORY: Record<string, string> = {
  MARKETING: "Marketing", UTILITY: "Utilidade", AUTHENTICATION: "Autenticação",
}
const BTN_LABEL: Record<string, string> = {
  URL: "Acessar link", PHONE_NUMBER: "Ligar", QUICK_REPLY: "Resposta rápida",
}

/** Soma agregada de uma métrica numérica sobre todos os data_points. */
function sum(points: TemplateAnalyticsPoint[], key: "sent" | "delivered" | "read") {
  return points.reduce((acc, p) => acc + (p[key] ?? 0), 0)
}
/** Total de cliques somando o `count` de cada botão em cada ponto. */
function sumClicks(points: TemplateAnalyticsPoint[]) {
  return points.reduce((acc, p) => acc + (p.clicked ?? []).reduce((a, c) => a + (c.count ?? 0), 0), 0)
}
function pct(n: number, d: number) {
  return d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—"
}
function fmtDay(unix: number) {
  if (!unix) return "—"
  return new Date(unix * 1000).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

function btnIcon(type?: string) {
  if (type === "URL") return <ExternalLink className="size-3.5 text-slate-400" />
  if (type === "PHONE_NUMBER") return <Phone className="size-3.5 text-slate-400" />
  return <Reply className="size-3.5 text-slate-400" />
}

type HistoryItem = { event: string; old_value: string | null; new_value: string | null; reason: string | null; created_at: string }
const EVENT_LABEL: Record<string, string> = {
  status_update: "Status alterado", quality_update: "Qualidade alterada", category_update: "Categoria alterada",
}

export function TemplateDetailClient({
  template, analytics, history, templateId,
}: {
  template:   MetaTemplate
  analytics:  TemplateAnalytics | null
  history:    HistoryItem[]
  templateId: string
}) {
  const router = useRouter()
  const [days, setDays] = useState(30)
  const [data, setData] = useState<TemplateAnalytics | null>(analytics)
  const [aErr, setAErr] = useState<string | null>(null)
  const [pending, startT] = useTransition()
  const [confirmDel, setConfirmDel] = useState(false)

  const st = STATUS[template.status] ?? { tone: "neutral" as Tone, label: template.status }
  const ql = QUALITY[template.quality_score?.score ?? "UNKNOWN"] ?? QUALITY.UNKNOWN

  const header  = comp(template, "HEADER")
  const footer  = comp(template, "FOOTER")
  const buttons = comp(template, "BUTTONS")?.buttons ?? []
  const body    = bodyText(template)
  const nVars   = countVars(body)

  const points = useMemo(() => data?.data_points ?? [], [data])
  const totals = useMemo(() => {
    const sent = sum(points, "sent"), delivered = sum(points, "delivered")
    const read = sum(points, "read"), clicks = sumClicks(points)
    return { sent, delivered, read, clicks, clickRate: pct(clicks, delivered) }
  }, [points])

  // Cliques agregados por botão (button_content) — barras leves por botão.
  const clicksByButton = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of points)
      for (const c of p.clicked ?? [])
        map.set(c.button_content ?? "Botão", (map.get(c.button_content ?? "Botão") ?? 0) + (c.count ?? 0))
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [points])

  const maxSent = useMemo(() => Math.max(1, ...points.map((p) => p.sent ?? 0)), [points])

  function changePeriod(d: number) {
    setDays(d)
    setAErr(null)
    startT(async () => {
      const r = await getOfficialTemplateAnalytics(templateId, d)
      if (r.ok && r.analytics) setData(r.analytics)
      else { setData(null); setAErr(r.error ?? "Métricas indisponíveis.") }
    })
  }

  function handleDelete() {
    return new Promise<void>((resolve) => {
      startT(async () => {
        const r = await deleteOfficialTemplateById(templateId, template.name)
        if (r.ok) router.push("/templates")
        resolve()
      })
    })
  }

  return (
    <div className="space-y-6">
      {/* Faixa de status */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 bg-white rounded-xl border border-slate-200 shadow-card px-5 py-4">
        <Facet label="Status"><StatusDot tone={st.tone} label={st.label} /></Facet>
        <Facet label="Qualidade"><StatusDot tone={ql.tone} label={ql.label} /></Facet>
        <Facet label="Categoria"><span className="text-sm font-medium text-slate-800">{CATEGORY[template.category] ?? template.category}</span></Facet>
        <Facet label="Idioma"><span className="text-sm font-medium text-slate-800">{template.language}</span></Facet>
        <Facet label="Variáveis"><span className="text-sm font-medium text-slate-800">{nVars}</span></Facet>
      </div>

      {template.status === "REJECTED" && (
        <div className="flex items-start gap-2.5 rounded-xl bg-danger-bg border border-red-100 px-4 py-3">
          <AlertCircle className="size-4 text-danger shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">
            <strong>Reprovado pela Meta.</strong> {template.rejected_reason || "Sem motivo informado."}
          </p>
        </div>
      )}

      {template.correct_category && template.correct_category !== template.category && (
        <div className="flex items-start gap-2.5 rounded-xl bg-warning-bg border border-amber-100 px-4 py-3">
          <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            A Meta sugeriu recategorizar para <strong>{CATEGORY[template.correct_category] ?? template.correct_category}</strong>.
          </p>
        </div>
      )}

      {/* Cards de métricas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard icon={Send} label="Enviados" value={data ? totals.sent.toLocaleString("pt-BR") : "—"} />
        <MetricCard icon={CheckCheck} label="Entregues" value={data ? totals.delivered.toLocaleString("pt-BR") : "—"} hint={data ? pct(totals.delivered, totals.sent) : undefined} />
        <MetricCard icon={Eye} label="Lidos" value={data ? totals.read.toLocaleString("pt-BR") : "—"} hint={data ? pct(totals.read, totals.delivered) : undefined} />
        <MetricCard icon={MousePointerClick} label="Taxa de clique" value={data ? totals.clickRate : "—"} hint={data ? `${totals.clicks.toLocaleString("pt-BR")} cliques` : undefined} />
      </div>
      {!data && (
        <p className="text-xs text-slate-400 -mt-3">{aErr ?? "Métricas indisponíveis."}</p>
      )}

      {/* Conteúdo: preview + detalhamento estruturado (full-width grid) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <SectionCard title="Prévia" description="Como aparece no WhatsApp" className="lg:col-span-1">
          <TemplatePreview t={template} />
        </SectionCard>

        <SectionCard title="Conteúdo" description="Detalhamento estruturado" className="lg:col-span-2">
          <div className="space-y-4">
            <Field label={`Cabeçalho${header?.format ? ` · ${header.format}` : ""}`}>
              {header
                ? (header.format === "TEXT"
                    ? <p className="text-sm text-slate-800">{renderVars(header.text)}</p>
                    : <p className="text-sm text-slate-500">Mídia ({header.format})</p>)
                : <span className="text-sm text-slate-300">Sem cabeçalho</span>}
            </Field>

            <Field label="Corpo">
              {body
                ? <p className="text-sm text-slate-800 whitespace-pre-wrap break-words leading-relaxed">{renderVars(body)}</p>
                : <span className="text-sm text-slate-300">Sem corpo</span>}
            </Field>

            <Field label="Rodapé">
              {footer?.text
                ? <p className="text-sm text-slate-600">{footer.text}</p>
                : <span className="text-sm text-slate-300">Sem rodapé</span>}
            </Field>

            <Field label={`Botões${buttons.length ? ` · ${buttons.length}` : ""}`}>
              {buttons.length > 0 ? (
                <div className="space-y-1.5">
                  {buttons.map((b, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      {btnIcon(b.type)}
                      <span className="text-sm font-medium text-slate-800">{b.text}</span>
                      <span className="ml-auto text-[11px] text-slate-400">{BTN_LABEL[b.type] ?? b.type}</span>
                    </div>
                  ))}
                </div>
              ) : <span className="text-sm text-slate-300">Sem botões</span>}
            </Field>
          </div>
        </SectionCard>
      </div>

      {/* Analytics no tempo */}
      <SectionCard
        title="Desempenho ao longo do tempo"
        description="Enviados, entregues e lidos por dia"
        icon={BarChart3}
        actions={
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => changePeriod(d)}
                disabled={pending}
                className={`h-7 px-2.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 ${
                  days === d ? "bg-primary-50 text-primary-700" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        }
      >
        {!data || points.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">
            {pending ? "Carregando métricas…" : (aErr ?? "Sem dados no período selecionado.")}
          </p>
        ) : (
          <div className="space-y-4">
            {/* Barras leves por data_point (CSS only, sem lib de gráfico) */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[480px]">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-100">
                    <th className="font-medium py-2 pr-3">Dia</th>
                    <th className="font-medium py-2 pr-3 w-1/2">Volume</th>
                    <th className="font-medium py-2 pr-3 text-right">Enviados</th>
                    <th className="font-medium py-2 pr-3 text-right">Entregues</th>
                    <th className="font-medium py-2 text-right">Lidos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {points.map((p, i) => (
                    <tr key={i} className="text-slate-700">
                      <td className="py-2 pr-3 tabular-nums whitespace-nowrap">{fmtDay(p.start)}</td>
                      <td className="py-2 pr-3">
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${((p.sent ?? 0) / maxSent) * 100}%` }} />
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{(p.sent ?? 0).toLocaleString("pt-BR")}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{(p.delivered ?? 0).toLocaleString("pt-BR")}</td>
                      <td className="py-2 text-right tabular-nums text-slate-500">{(p.read ?? 0).toLocaleString("pt-BR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {clicksByButton.length > 0 && (
              <div className="pt-4 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2.5">Cliques por botão</p>
                <div className="space-y-2">
                  {clicksByButton.map(([name, count]) => (
                    <div key={name} className="flex items-center gap-3 text-xs">
                      <span className="w-32 truncate text-slate-600 shrink-0">{name}</span>
                      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-sky-500 rounded-full" style={{ width: `${(count / Math.max(1, clicksByButton[0][1])) * 100}%` }} />
                      </div>
                      <span className="tabular-nums text-slate-700 w-12 text-right shrink-0">{count.toLocaleString("pt-BR")}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* Histórico */}
      <SectionCard title="Histórico" description="Mudanças de status, qualidade e categoria" icon={History}>
        {history.length === 0 ? (
          <EmptyState icon={History} title="Sem histórico ainda" description="Mudanças de status, qualidade ou categoria deste template aparecerão aqui." bordered={false} />
        ) : (
          <ul className="space-y-3">
            {history.map((h, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="size-1.5 rounded-full bg-slate-300 mt-2 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-800">
                    <span className="font-medium">{EVENT_LABEL[h.event] ?? h.event}</span>
                    {(h.old_value || h.new_value) && (
                      <span className="text-slate-500">
                        {": "}
                        {h.old_value && <span className="line-through text-slate-400">{h.old_value}</span>}
                        {h.old_value && h.new_value && " → "}
                        {h.new_value && <span className="text-slate-700">{h.new_value}</span>}
                      </span>
                    )}
                  </p>
                  {h.reason && <p className="text-xs text-slate-500 mt-0.5">{h.reason}</p>}
                  <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">{fmtDateTime(h.created_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Ações destrutivas */}
      <SectionCard title="Zona de perigo" description="Ações irreversíveis sobre este template">
        <button
          onClick={() => setConfirmDel(true)}
          className="h-9 px-3 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg inline-flex items-center gap-1.5 transition-colors"
        >
          <Trash2 className="size-3.5" /> Excluir template
        </button>
      </SectionCard>

      <DangerConfirm
        open={confirmDel}
        title="Excluir template?"
        body={<>O template <strong>{template.name}</strong> ({template.language}) será removido permanentemente. Esta ação não pode ser desfeita.</>}
        confirmLabel="Excluir"
        onConfirm={handleDelete}
        onClose={() => setConfirmDel(false)}
      />
    </div>
  )
}

/** Item da faixa de status (label em cima, valor embaixo). */
function Facet({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{label}</p>
      {children}
    </div>
  )
}

/** Card de métrica agregada. */
function MetricCard({
  icon: Icon, label, value, hint,
}: { icon: typeof Send; label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-4">
      <div className="flex items-center gap-1.5 text-slate-400">
        <Icon className="size-3.5" />
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-2xl font-bold text-slate-900 mt-1.5 tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  )
}

/** Linha rotulada do detalhamento de conteúdo. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{label}</p>
      {children}
    </div>
  )
}
