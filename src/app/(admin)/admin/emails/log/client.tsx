"use client"

import Link from "next/link"
import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  CheckCircle2, Clock, AlertTriangle, Eye, MousePointerClick, XCircle, Mail,
  Send, Inbox, Search, X, ArrowLeft,
} from "lucide-react"
import type { EmailOutboxRow, OutboxStats } from "@/lib/actions/emails"

const STATUS_META: Record<EmailOutboxRow["status"], { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  pending:    { label: "Pendente",    icon: Clock,             cls: "bg-slate-100 text-slate-600" },
  sent:       { label: "Enviado",     icon: Send,              cls: "bg-primary-50 text-primary-700" },
  delivered:  { label: "Entregue",    icon: CheckCircle2,      cls: "bg-green-50 text-green-700" },
  opened:     { label: "Aberto",      icon: Eye,               cls: "bg-emerald-50 text-emerald-700" },
  clicked:    { label: "Clicado",     icon: MousePointerClick, cls: "bg-emerald-50 text-emerald-700" },
  bounced:    { label: "Bounce",      icon: AlertTriangle,     cls: "bg-red-50 text-red-700" },
  complained: { label: "Spam",        icon: AlertTriangle,     cls: "bg-amber-50 text-amber-700" },
  failed:     { label: "Falha",       icon: XCircle,           cls: "bg-red-50 text-red-700" },
}

interface Props {
  rows:           EmailOutboxRow[]
  stats:          OutboxStats
  initialFilters: { status?: string; template?: string; search?: string }
}

export function EmailLogClient({ rows, stats, initialFilters }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState(initialFilters.search ?? "")
  const [statusFilter, setStatusFilter] = useState(initialFilters.status ?? "all")
  const [templateFilter, setTemplateFilter] = useState(initialFilters.template ?? "all")
  const [active, setActive] = useState<EmailOutboxRow | null>(null)

  const templates = useMemo(() => {
    const set = new Set(rows.map((r) => r.templateSlug))
    return Array.from(set)
  }, [rows])

  function applyFilters() {
    const params = new URLSearchParams()
    if (search)                            params.set("search",   search)
    if (statusFilter   && statusFilter   !== "all") params.set("status",   statusFilter)
    if (templateFilter && templateFilter !== "all") params.set("template", templateFilter)
    router.push(`/admin/emails/log${params.toString() ? `?${params.toString()}` : ""}`)
  }

  function clearFilters() {
    setSearch("")
    setStatusFilter("all")
    setTemplateFilter("all")
    router.push("/admin/emails/log")
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="px-6 py-6">
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div>
            <Link href="/admin/emails" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-primary-700 mb-1">
              <ArrowLeft className="size-3" /> Templates
            </Link>
            <h1 className="text-2xl font-bold text-slate-900">Log de emails</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Todos os emails disparados pelo sistema. Status atualizado pelo webhook do Resend.
            </p>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total (30d)"     value={stats.total}     icon={Mail}              tone="slate" />
          <StatCard label="Entrega"         value={`${stats.deliveryPct}%`} sub={`${stats.delivered} entregues`} icon={CheckCircle2} tone="green" />
          <StatCard label="Aberturas"       value={`${stats.openPct}%`}     sub={`${stats.opened} abertos`}      icon={Eye}          tone="emerald" />
          <StatCard label="Bounces"         value={`${stats.bouncePct}%`}   sub={`${stats.bounced} bounces`}     icon={AlertTriangle} tone={stats.bouncePct > 5 ? "red" : "slate"} />
        </div>

        {/* Filtros */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 mb-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") applyFilters() }}
              placeholder="Buscar por email…"
              className="w-full h-9 pl-9 pr-3 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white"
          >
            <option value="all">Todos os status</option>
            {Object.entries(STATUS_META).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <select
            value={templateFilter}
            onChange={(e) => setTemplateFilter(e.target.value)}
            className="h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white"
          >
            <option value="all">Todos os templates</option>
            {templates.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={applyFilters}
            className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-700"
          >
            Aplicar
          </button>
          {(search || statusFilter !== "all" || templateFilter !== "all") && (
            <button
              type="button"
              onClick={clearFilters}
              className="h-9 px-3 text-xs font-semibold rounded-lg text-slate-600 hover:bg-slate-100 inline-flex items-center gap-1"
            >
              <X className="size-3" /> Limpar
            </button>
          )}
        </div>

        {/* Tabela */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {rows.length === 0 ? (
            <div className="py-16 text-center">
              <Inbox className="size-10 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-600 mb-1">Nenhum email no log</p>
              <p className="text-xs text-slate-400">Conforme o sistema disparar emails, eles aparecem aqui.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5">Quando</th>
                  <th className="px-4 py-2.5">Destinatário</th>
                  <th className="px-4 py-2.5">Template</th>
                  <th className="px-4 py-2.5">Tenant</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const meta = STATUS_META[r.status]
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setActive(r)}
                      className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="px-4 py-2.5 text-xs text-slate-500 tabular-nums whitespace-nowrap">
                        {formatDate(r.createdAt)}
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="text-slate-900 font-medium truncate max-w-[260px]">{r.toEmail}</p>
                        <p className="text-[11px] text-slate-400 truncate max-w-[260px]">{r.subject}</p>
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        <code className="font-mono text-primary-700 bg-primary-50 px-1.5 py-0.5 rounded">{r.templateSlug}</code>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{r.tenantName ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${meta.cls}`}>
                          <meta.icon className="size-3" />
                          {meta.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Drawer de detalhe */}
        {active && (
          <div className="fixed inset-0 z-50 bg-black/30" onClick={() => setActive(null)}>
            <div
              onClick={(e) => e.stopPropagation()}
              className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl overflow-y-auto"
            >
              <div className="p-5 border-b border-slate-200 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-slate-400 mb-1">{formatDate(active.createdAt)}</p>
                  <h2 className="text-base font-bold text-slate-900 truncate">{active.subject}</h2>
                  <p className="text-sm text-slate-600 truncate">{active.toEmail}</p>
                </div>
                <button onClick={() => setActive(null)} className="size-8 rounded-lg hover:bg-slate-100 flex items-center justify-center shrink-0">
                  <X className="size-4 text-slate-500" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <Field label="Status atual">
                  {(() => {
                    const m = STATUS_META[active.status]
                    return (
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${m.cls}`}>
                        <m.icon className="size-3.5" />
                        {m.label}
                      </span>
                    )
                  })()}
                </Field>
                <Field label="Template">
                  <code className="font-mono text-xs text-primary-700 bg-primary-50 px-1.5 py-0.5 rounded">{active.templateSlug}</code>
                </Field>
                <Field label="Tenant">
                  <span className="text-sm text-slate-700">{active.tenantName ?? "(sem tenant)"}</span>
                </Field>
                <Field label="Resend ID">
                  {active.resendId ? (
                    <code className="font-mono text-[11px] text-slate-600">{active.resendId}</code>
                  ) : <span className="text-xs text-slate-400">—</span>}
                </Field>
                {active.error && (
                  <Field label="Erro">
                    <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg p-2 font-mono">{active.error}</p>
                  </Field>
                )}
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-2">Timeline</p>
                  <Timeline row={active} />
                </div>
                {Object.keys(active.metadata).length > 0 && (
                  <Field label="Metadata">
                    <pre className="text-[10px] font-mono bg-slate-50 border border-slate-200 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-all">
                      {JSON.stringify(active.metadata, null, 2)}
                    </pre>
                  </Field>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({
  label, value, sub, icon: Icon, tone,
}: {
  label: string
  value: string | number
  sub?: string
  icon: React.ComponentType<{ className?: string }>
  tone: "slate" | "green" | "emerald" | "red"
}) {
  const TONES = {
    slate:   "bg-slate-50 text-slate-600",
    green:   "bg-green-50 text-green-700",
    emerald: "bg-emerald-50 text-emerald-700",
    red:     "bg-red-50 text-red-700",
  }
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3">
      <div className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${TONES[tone]}`}>
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">{label}</p>
        <p className="text-2xl font-bold text-slate-900 tabular-nums leading-tight">{value}</p>
        {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1">{label}</p>
      {children}
    </div>
  )
}

function Timeline({ row }: { row: EmailOutboxRow }) {
  const events: Array<{ at: string | null; label: string; tone: string }> = [
    { at: row.createdAt,   label: "Criado",   tone: "bg-slate-300" },
    { at: row.sentAt,      label: "Enviado",  tone: "bg-primary" },
    { at: row.deliveredAt, label: "Entregue", tone: "bg-green-500" },
    { at: row.openedAt,    label: "Aberto",   tone: "bg-emerald-500" },
    { at: row.clickedAt,   label: "Clicado",  tone: "bg-emerald-600" },
    { at: row.bouncedAt,   label: "Bounce",   tone: "bg-red-500" },
    { at: row.complainedAt, label: "Spam complaint", tone: "bg-amber-500" },
  ].filter((e) => e.at)

  return (
    <div className="space-y-2">
      {events.map((e, i) => (
        <div key={i} className="flex items-center gap-2.5">
          <span className={`size-2 rounded-full ${e.tone} shrink-0`} />
          <span className="text-xs text-slate-700 flex-1">{e.label}</span>
          <span className="text-[11px] text-slate-400 tabular-nums">{formatDate(e.at!)}</span>
        </div>
      ))}
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })
}
