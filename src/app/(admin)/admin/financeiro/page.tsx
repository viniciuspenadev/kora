import Link from "next/link"
import { supabaseAdmin } from "@/lib/supabase"
import { Wallet, TrendingUp, FileText, AlertTriangle, Receipt, ChevronRight, Building2 } from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { computeBillingSummary } from "@/lib/billing"

const BRL = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const fmtDate = (s: string | null) => s ? new Date(s + (s.length === 10 ? "T12:00:00" : "")).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "—"

const STATUS_BADGE: Record<string, string> = {
  open:    "text-amber-700 bg-amber-50 border-amber-200",
  paid:    "text-emerald-700 bg-emerald-50 border-emerald-200",
  overdue: "text-red-700 bg-red-50 border-red-200",
  void:    "text-slate-500 bg-slate-100 border-slate-200",
  draft:   "text-slate-600 bg-slate-50 border-slate-200",
}
const STATUS_LABEL: Record<string, string> = { open: "Aberta", paid: "Paga", overdue: "Vencida", void: "Anulada", draft: "Rascunho" }

export default async function FinanceiroPage() {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const today = now.toISOString().slice(0, 10)

  const [summary, { data: openOrPaid }, { data: recentInvoices }] = await Promise.all([
    computeBillingSummary(),
    supabaseAdmin.from("invoices").select("status, total_cents, due_date, paid_at").neq("status", "void"),
    supabaseAdmin.from("invoices").select("id, tenant_id, status, total_cents, period_start, period_end, due_date, tenants ( name, slug )").order("created_at", { ascending: false }).limit(30),
  ])

  const { mrr_cents: mrr, billed, noPlan, byPlan: mrrPlanList } = summary

  // KPIs de fatura
  let receivedMonth = 0, openSum = 0, openCount = 0, overdueSum = 0, overdueCount = 0
  for (const inv of (openOrPaid ?? []) as Array<{ status: string; total_cents: number; due_date: string | null; paid_at: string | null }>) {
    if (inv.status === "paid") {
      if (inv.paid_at && inv.paid_at >= monthStart) receivedMonth += inv.total_cents
    } else {
      openSum += inv.total_cents; openCount++
      if (inv.due_date && inv.due_date < today) { overdueSum += inv.total_cents; overdueCount++ }
    }
  }

  return (
    <div className="min-h-full">
      <div className="bg-white border-b border-slate-200 px-6 py-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary-50 flex items-center justify-center">
            <Wallet className="size-5 text-primary-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Financeiro</h1>
            <p className="text-xs text-slate-400 mt-0.5">{billed} {billed === 1 ? "tenant cobrado" : "tenants cobrados"} · receita recorrente e faturas</p>
          </div>
        </div>
        <Link href="/admin/financeiro/emissor" className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors">
          <Building2 className="size-3.5" /> Dados do emissor
        </Link>
      </div>

      <div className="p-6 space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="MRR (recorrente/mês)" value={BRL(mrr)} icon={TrendingUp} tone="primary" />
          <Kpi label="Recebido no mês" value={BRL(receivedMonth)} icon={Receipt} tone="success" />
          <Kpi label="Em aberto" value={BRL(openSum)} sub={`${openCount} fatura${openCount === 1 ? "" : "s"}`} icon={FileText} tone={openCount > 0 ? "warning" : "neutral"} />
          <Kpi label="Vencidas" value={BRL(overdueSum)} sub={`${overdueCount} fatura${overdueCount === 1 ? "" : "s"}`} icon={AlertTriangle} tone={overdueCount > 0 ? "danger" : "neutral"} />
        </div>

        {noPlan > 0 && (
          <Link href="/admin/tenants" className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 hover:bg-amber-100 text-sm text-amber-900">
            <AlertTriangle className="size-4 shrink-0" />
            <span className="flex-1"><strong>{noPlan}</strong> tenant{noPlan === 1 ? "" : "s"} ativo{noPlan === 1 ? "" : "s"} sem plano atribuído — não {noPlan === 1 ? "está" : "estão"} sendo cobrado{noPlan === 1 ? "" : "s"}.</span>
            <ChevronRight className="size-4 shrink-0" />
          </Link>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          {/* Faturas recentes */}
          <div className="xl:col-span-2">
            <SectionCard title={<span className="flex items-center gap-2"><FileText className="size-3.5 text-primary-600" /> Faturas recentes</span>} flush>
              {(recentInvoices?.length ?? 0) === 0 ? (
                <p className="px-5 py-8 text-sm text-slate-400 text-center">Nenhuma fatura emitida ainda.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {(recentInvoices ?? []).map((inv) => {
                    const t = inv.tenants as unknown as { name: string; slug: string } | null
                    return (
                      <Link key={inv.id} href={`/admin/tenants/${inv.tenant_id}/cobranca`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/60">
                        <div className="size-8 rounded-lg bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0">
                          <span className="text-xs font-bold text-primary-600">{t?.name?.[0]?.toUpperCase() ?? "?"}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900 truncate">{t?.name ?? "—"}</p>
                          <p className="text-[11px] text-slate-400">{fmtDate(inv.period_start)}–{fmtDate(inv.period_end)} · venc. {fmtDate(inv.due_date)}</p>
                        </div>
                        <span className="text-sm font-bold tabular-nums text-slate-900">{BRL(inv.total_cents)}</span>
                        <span className={`text-[10px] font-semibold px-2 h-5 inline-flex items-center rounded-md border ${STATUS_BADGE[inv.status] ?? STATUS_BADGE.draft}`}>{STATUS_LABEL[inv.status] ?? inv.status}</span>
                      </Link>
                    )
                  })}
                </div>
              )}
            </SectionCard>
          </div>

          {/* MRR por plano */}
          <SectionCard title={<span className="flex items-center gap-2"><Building2 className="size-3.5 text-primary-600" /> MRR por plano</span>}>
            {mrrPlanList.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-2">Nenhum tenant com plano ativo.</p>
            ) : (
              <div className="space-y-2">
                {mrrPlanList.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-slate-800 flex-1 min-w-0 truncate">{m.name}</span>
                    <span className="text-slate-400">{m.count}×</span>
                    <span className="font-bold tabular-nums text-slate-900">{BRL(m.cents)}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 text-xs pt-2 border-t border-slate-100">
                  <span className="font-semibold text-slate-500 flex-1">Total</span>
                  <span className="font-bold tabular-nums text-primary-700">{BRL(mrr)}</span>
                </div>
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, icon: Icon, tone }: {
  label: string; value: string; sub?: string; icon: typeof Wallet; tone: "primary" | "success" | "warning" | "danger" | "neutral"
}) {
  const t = {
    primary: "bg-primary-50 text-primary-600", success: "bg-emerald-50 text-emerald-600",
    warning: "bg-amber-50 text-amber-600", danger: "bg-red-50 text-red-600", neutral: "bg-slate-100 text-slate-500",
  }[tone]
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card px-5 py-4 flex items-start gap-3">
      <div className={`size-9 rounded-lg ${t} flex items-center justify-center shrink-0`}><Icon className="size-4" strokeWidth={1.75} /></div>
      <div className="min-w-0">
        <p className="text-[11px] text-slate-500 mb-0.5">{label}</p>
        <p className="text-xl font-bold text-slate-900 tabular-nums leading-tight">{value}</p>
        {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}
