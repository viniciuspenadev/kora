"use client"

import { useState, useTransition } from "react"
import {
  CreditCard, Calendar, Users, Boxes, Plus, Trash2, Power, FileText,
  CheckCircle2, AlertCircle, Loader2, Receipt, Ban,
} from "lucide-react"
import { assignPlanToTenant, type Plan } from "@/lib/actions/admin-plans"
import {
  updateTenantBilling, addCharge, setChargeActive, deleteCharge,
  generateInvoice, markInvoicePaid, voidInvoice, type TenantCharge,
} from "@/lib/actions/admin-billing"
import type { InvoiceWithItems } from "./page"

const BRL = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const toCents = (s: string) => Math.round((parseFloat(s.replace(",", ".")) || 0) * 100)
const INP = "w-full h-9 px-3 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 placeholder:text-slate-400"
const fmtDate = (s: string | null) => s ? new Date(s + (s.length === 10 ? "T12:00:00" : "")).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "—"

const STATUS_BADGE: Record<string, string> = {
  open:    "text-amber-700 bg-amber-50 border-amber-200",
  paid:    "text-emerald-700 bg-emerald-50 border-emerald-200",
  overdue: "text-red-700 bg-red-50 border-red-200",
  void:    "text-slate-500 bg-slate-100 border-slate-200",
  draft:   "text-slate-600 bg-slate-50 border-slate-200",
}
const STATUS_LABEL: Record<string, string> = { open: "Aberta", paid: "Paga", overdue: "Vencida", void: "Anulada", draft: "Rascunho" }
const SUB_LABEL: Record<string, string> = { active: "Ativa", past_due: "Inadimplente", canceled: "Cancelada" }

interface Props {
  tenantId:           string
  plans:              Plan[]
  currentPlan:        Plan | null
  billingDay:         number | null
  subscriptionStatus: string
  activeUsers:        number
  charges:            TenantCharge[]
  invoices:           InvoiceWithItems[]
}

export function CobrancaClient(p: Props) {
  const [planId, setPlanId]   = useState(p.currentPlan?.id ?? "")
  const [day, setDay]         = useState(p.billingDay != null ? String(p.billingDay) : "")
  const [status, setStatus]   = useState(p.subscriptionStatus)
  const [err, setErr]         = useState<string | null>(null)
  const [ok, setOk]           = useState<string | null>(null)
  const [pending, startT]     = useTransition()

  const overageUsers = p.currentPlan ? Math.max(0, p.activeUsers - p.currentPlan.user_quota) : 0
  const overageCents = p.currentPlan ? overageUsers * p.currentPlan.extra_user_price_cents : 0
  const addonsCents  = p.charges.filter((c) => c.kind === "recurring_addon" && c.active).reduce((s, c) => s + c.amount_cents, 0)
  const mrr          = (p.currentPlan?.price_cents ?? 0) + overageCents + addonsCents

  function flash(res: { error?: string }, okMsg: string) {
    if (res.error) { setErr(res.error); setOk(null) } else { setOk(okMsg); setErr(null) }
  }

  function saveSubscription() {
    setErr(null); setOk(null)
    startT(async () => {
      if (planId !== (p.currentPlan?.id ?? "")) {
        const r = await assignPlanToTenant(p.tenantId, planId || null)
        if (r.error) { setErr(r.error); return }
      }
      const r2 = await updateTenantBilling(p.tenantId, {
        billing_day: day.trim() === "" ? null : parseInt(day, 10),
        subscription_status: status,
      })
      flash(r2, "Assinatura salva.")
    })
  }

  return (
    <div className="space-y-5">
      {(err || ok) && (
        <div className={`flex items-start gap-2 p-3 rounded-lg text-xs ${err ? "bg-red-50 border border-red-200 text-red-800" : "bg-green-50 border border-green-200 text-green-800"}`}>
          {err ? <AlertCircle className="size-4 shrink-0 mt-0.5" /> : <CheckCircle2 className="size-4 shrink-0 mt-0.5" />}
          <span>{err ?? ok}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Assinatura */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="size-4 text-primary-600" />
            <h2 className="text-sm font-bold text-slate-900">Assinatura</h2>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Plano</label>
              <select value={planId} onChange={(e) => setPlanId(e.target.value)} className={INP}>
                <option value="">Sem plano</option>
                {p.plans.map((pl) => <option key={pl.id} value={pl.id}>{pl.name} — {BRL(pl.price_cents)}/mês</option>)}
                {p.currentPlan && !p.currentPlan.active && <option value={p.currentPlan.id}>{p.currentPlan.name} (arquivado)</option>}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Dia de fechamento</label>
                <input value={day} onChange={(e) => setDay(e.target.value)} inputMode="numeric" placeholder="1–28" className={INP} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Status</label>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className={INP}>
                  {Object.entries(SUB_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <button type="button" onClick={saveSubscription} disabled={pending} className="h-9 px-4 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-700 inline-flex items-center gap-1.5 disabled:opacity-50">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />} Salvar
            </button>
          </div>
        </div>

        {/* Resumo mensal (MRR) */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Receipt className="size-4 text-primary-600" />
            <h2 className="text-sm font-bold text-slate-900">Resumo mensal</h2>
          </div>
          {p.currentPlan ? (
            <>
              <p className="text-3xl font-bold text-slate-900 tabular-nums leading-none">{BRL(mrr)}<span className="text-xs font-medium text-slate-400">/mês</span></p>
              <div className="mt-4 space-y-1.5 text-xs">
                <Line icon={CreditCard} label={`Plano ${p.currentPlan.name}`} value={BRL(p.currentPlan.price_cents)} />
                <Line icon={Users} label={`Usuários: ${p.activeUsers} ativos / cota ${p.currentPlan.user_quota}`} value={overageCents > 0 ? `+${BRL(overageCents)}` : "incluído"} muted={overageCents === 0} />
                <Line icon={Boxes} label="Add-ons recorrentes" value={addonsCents > 0 ? `+${BRL(addonsCents)}` : "—"} muted={addonsCents === 0} />
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400">Atribua um plano para ver o resumo de cobrança.</p>
          )}
        </div>
      </div>

      {/* Cobranças adicionais */}
      <ChargesCard tenantId={p.tenantId} charges={p.charges} onErr={setErr} onOk={setOk} />

      {/* Faturas */}
      <InvoicesCard tenantId={p.tenantId} invoices={p.invoices} hasPlan={!!p.currentPlan} onErr={setErr} onOk={setOk} />
    </div>
  )
}

function Line({ icon: Icon, label, value, muted }: { icon: typeof Users; label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-3.5 text-slate-400 shrink-0" />
      <span className="text-slate-600 flex-1 min-w-0 truncate">{label}</span>
      <span className={`font-semibold tabular-nums ${muted ? "text-slate-400" : "text-slate-800"}`}>{value}</span>
    </div>
  )
}

function ChargesCard({ tenantId, charges, onErr, onOk }: {
  tenantId: string; charges: TenantCharge[]; onErr: (s: string) => void; onOk: (s: string) => void
}) {
  const [kind, setKind] = useState<"recurring_addon" | "oneoff">("recurring_addon")
  const [desc, setDesc] = useState("")
  const [val, setVal]   = useState("")
  const [pending, startT] = useTransition()

  function add() {
    startT(async () => {
      const r = await addCharge(tenantId, { kind, description: desc, amount_cents: toCents(val) })
      if (r.error) onErr(r.error)
      else { onOk("Cobrança adicionada."); setDesc(""); setVal("") }
    })
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <Boxes className="size-4 text-primary-600" />
        <h2 className="text-sm font-bold text-slate-900">Cobranças adicionais</h2>
      </div>

      <div className="divide-y divide-slate-100">
        {charges.length === 0 && <p className="px-5 py-5 text-sm text-slate-400">Nenhuma cobrança adicional.</p>}
        {charges.map((c) => (
          <div key={c.id} className={`flex items-center gap-3 px-5 py-3 ${c.active ? "" : "opacity-50"}`}>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${c.kind === "recurring_addon" ? "text-violet-700 bg-violet-50 border-violet-200" : "text-slate-600 bg-slate-50 border-slate-200"}`}>
              {c.kind === "recurring_addon" ? "Recorrente" : "Avulsa"}
            </span>
            <span className="text-sm text-slate-800 flex-1 min-w-0 truncate">{c.description}</span>
            <span className="text-sm font-semibold tabular-nums text-slate-900">{BRL(c.amount_cents)}{c.kind === "recurring_addon" && <span className="text-[10px] text-slate-400">/mês</span>}</span>
            <ChargeActions id={c.id} tenantId={tenantId} active={c.active} onErr={onErr} onOk={onOk} />
          </div>
        ))}
      </div>

      <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-end gap-2 flex-wrap">
        <select value={kind} onChange={(e) => setKind(e.target.value as "recurring_addon" | "oneoff")} className={`${INP} w-36`}>
          <option value="recurring_addon">Recorrente</option>
          <option value="oneoff">Avulsa</option>
        </select>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Descrição" className={`${INP} flex-1 min-w-[160px]`} />
        <input value={val} onChange={(e) => setVal(e.target.value)} inputMode="decimal" placeholder="R$ 0,00" className={`${INP} w-28`} />
        <button type="button" onClick={add} disabled={pending} className="h-9 px-3 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-700 inline-flex items-center gap-1.5 disabled:opacity-50">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Adicionar
        </button>
      </div>
    </div>
  )
}

function ChargeActions({ id, tenantId, active, onErr, onOk }: {
  id: string; tenantId: string; active: boolean; onErr: (s: string) => void; onOk: (s: string) => void
}) {
  const [pending, startT] = useTransition()
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button type="button" disabled={pending} title={active ? "Desativar" : "Reativar"}
        onClick={() => startT(async () => { const r = await setChargeActive(id, tenantId, !active); if (r.error) onErr(r.error); else onOk(active ? "Cobrança desativada." : "Cobrança reativada.") })}
        className="size-7 rounded-lg hover:bg-slate-100 flex items-center justify-center">
        <Power className={`size-3.5 ${active ? "text-slate-500" : "text-emerald-600"}`} />
      </button>
      <button type="button" disabled={pending} title="Excluir"
        onClick={() => startT(async () => { const r = await deleteCharge(id, tenantId); if (r.error) onErr(r.error); else onOk("Cobrança excluída.") })}
        className="size-7 rounded-lg hover:bg-red-50 flex items-center justify-center">
        <Trash2 className="size-3.5 text-red-500" />
      </button>
    </div>
  )
}

function InvoicesCard({ tenantId, invoices, hasPlan, onErr, onOk }: {
  tenantId: string; invoices: InvoiceWithItems[]; hasPlan: boolean; onErr: (s: string) => void; onOk: (s: string) => void
}) {
  const [pending, startT] = useTransition()

  function gen() {
    startT(async () => { const r = await generateInvoice(tenantId); if (r.error) onErr(r.error); else onOk("Fatura gerada.") })
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-primary-600" />
          <h2 className="text-sm font-bold text-slate-900">Faturas</h2>
        </div>
        <button type="button" onClick={gen} disabled={pending || !hasPlan} title={hasPlan ? "Gerar fatura do período atual" : "Atribua um plano primeiro"}
          className="h-8 px-3 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-700 inline-flex items-center gap-1.5 disabled:opacity-50">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Gerar fatura
        </button>
      </div>

      {invoices.length === 0 ? (
        <p className="px-5 py-8 text-sm text-slate-400 text-center">Nenhuma fatura ainda.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {invoices.map((inv) => <InvoiceRow key={inv.id} inv={inv} tenantId={tenantId} onErr={onErr} onOk={onOk} />)}
        </div>
      )}
    </div>
  )
}

function InvoiceRow({ inv, tenantId, onErr, onOk }: {
  inv: InvoiceWithItems; tenantId: string; onErr: (s: string) => void; onOk: (s: string) => void
}) {
  const [open, setOpen]     = useState(false)
  const [method, setMethod] = useState("pix")
  const [pending, startT]   = useTransition()

  return (
    <div>
      <div className="flex items-center gap-3 px-5 py-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          <Receipt className="size-4 text-slate-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">{fmtDate(inv.period_start)} – {fmtDate(inv.period_end)}</p>
            <p className="text-[11px] text-slate-400">venc. {fmtDate(inv.due_date)}{inv.paid_at && ` · pago ${fmtDate(inv.paid_at)}`}</p>
          </div>
        </button>
        <span className="text-sm font-bold tabular-nums text-slate-900">{BRL(inv.total_cents)}</span>
        <span className={`text-[10px] font-semibold px-2 h-5 inline-flex items-center rounded-md border ${STATUS_BADGE[inv.status] ?? STATUS_BADGE.draft}`}>{STATUS_LABEL[inv.status] ?? inv.status}</span>
      </div>

      {open && (
        <div className="px-5 pb-4 -mt-1">
          <div className="rounded-lg border border-slate-100 divide-y divide-slate-50 bg-slate-50/40">
            {inv.invoice_items.map((it) => (
              <div key={it.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                <span className="text-slate-600 flex-1 min-w-0 truncate">{it.description}</span>
                {it.quantity > 1 && <span className="text-slate-400">{it.quantity}×{BRL(it.unit_price_cents)}</span>}
                <span className="font-semibold tabular-nums text-slate-800">{BRL(it.amount_cents)}</span>
              </div>
            ))}
          </div>
          {(inv.status === "open" || inv.status === "overdue") && (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={`${INP} w-32 h-8`}>
                <option value="pix">Pix</option><option value="boleto">Boleto</option><option value="cartao">Cartão</option><option value="manual">Manual</option>
              </select>
              <button type="button" disabled={pending}
                onClick={() => startT(async () => { const r = await markInvoicePaid(inv.id, tenantId, method); if (r.error) onErr(r.error); else onOk("Fatura marcada como paga.") })}
                className="h-8 px-3 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-1.5 disabled:opacity-50">
                <CheckCircle2 className="size-3.5" /> Marcar pago
              </button>
              <button type="button" disabled={pending}
                onClick={() => startT(async () => { const r = await voidInvoice(inv.id, tenantId); if (r.error) onErr(r.error); else onOk("Fatura anulada.") })}
                className="h-8 px-3 text-xs font-semibold rounded-lg text-slate-600 hover:bg-slate-100 inline-flex items-center gap-1.5 disabled:opacity-50">
                <Ban className="size-3.5" /> Anular
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
