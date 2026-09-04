import { notFound } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { CobrancaClient } from "./client"
import type { Plan } from "@/lib/actions/admin-plans"
import type { TenantCharge, Invoice, InvoiceItem } from "@/lib/actions/admin-billing"
import { BillingModePanel } from "@/components/admin/billing-mode-panel"
import { billingSnapshot } from "@/lib/billing/mode-change"

export type InvoiceWithItems = Invoice & { invoice_items: InvoiceItem[] }

export default async function TenantBillingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{cadastro?: string}> }) {
  const { id } = await params
  const query = await searchParams

  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("id, name, plan_id, billing_day, subscription_status, subscription_ends_at, past_due_since, past_due_grace_days, billing_mode, asaas_subscription_id, asaas_customer_id, lifecycle_state, active, trial_ends_at, past_due_reason")
    .eq("id", id)
    .maybeSingle()

  if (!tenant) notFound()

  const [change, receipt, owners, paid, outstanding, reviews] = await Promise.all([
    supabaseAdmin.from("tenant_billing_changes").select("id,from_mode,to_mode,effective_on").eq("tenant_id", id).eq("state", "pending").maybeSingle(),
    supabaseAdmin.from("tenant_provisioning").select("tenant_id").eq("tenant_id",id).eq("origin","godmode").maybeSingle(),
    supabaseAdmin.from("tenant_users").select("id",{count:"exact",head:true}).eq("tenant_id",id).eq("role","owner").eq("active",true),
    supabaseAdmin.from("invoices").select("period_end").eq("tenant_id",id).eq("status","paid").eq("kind","recorrente").order("period_end",{ascending:false}).limit(1).maybeSingle(),
    supabaseAdmin.from("invoices").select("id",{count:"exact",head:true}).eq("tenant_id",id).in("status",["draft","open","overdue","partial"]),
    supabaseAdmin.from("asaas_webhook_events").select("id,event_type,payment_id,received_at").eq("tenant_id",id).eq("billing_review_required",true).order("received_at",{ascending:false}).limit(50),
  ])
  if ([change,receipt,owners,paid,outstanding,reviews].some(r=>r.error)) throw new Error("Não foi possível consultar as condições de cobrança. Tente novamente.")

  const [{ data: plans }, { count: activeUsers }, { data: charges }, { data: invoices }] = await Promise.all([
    supabaseAdmin.from("plans").select("*").eq("active", true).order("position", { ascending: true }).order("price_cents", { ascending: true }),
    supabaseAdmin.from("tenant_users").select("id", { count: "exact", head: true }).eq("tenant_id", id).eq("active", true),
    supabaseAdmin.from("tenant_charges").select("*").eq("tenant_id", id).order("created_at", { ascending: false }),
    supabaseAdmin.from("invoices").select("*, invoice_items(*)").eq("tenant_id", id).order("created_at", { ascending: false }).limit(24),
  ])

  // Plano atual pode estar arquivado (fora da lista de ativos) → busca dedicada.
  let currentPlan: Plan | null = null
  if (tenant.plan_id) {
    const { data } = await supabaseAdmin.from("plans").select("*").eq("id", tenant.plan_id).maybeSingle()
    currentPlan = (data ?? null) as Plan | null
  }

  return (
    <>
    {query.cadastro === 'envio-pendente' && <p role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Empresa criada. O convite ainda não foi confirmado pelo serviço de e-mail. Confira o envio e use Reenviar convite abaixo.</p>}
    {query.cadastro === 'enviado' && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Empresa criada e convite encaminhado ao serviço de e-mail.</p>}
    <BillingModePanel tenantId={id} mode={tenant.billing_mode} snapshot={billingSnapshot(tenant)} pendingChange={change.data}
      paidUntil={paid.data?.period_end ?? null} openInvoices={outstanding.count ?? 0} ownerPending={!!receipt.data && owners.count===0}
      lifecycle={tenant.lifecycle_state ?? 'active'} hasSubscription={!!tenant.asaas_subscription_id && !tenant.asaas_subscription_id.startsWith('pending:')}
      reviewEvents={reviews.data ?? []} />
    <CobrancaClient
      tenantId={id}
      plans={(plans ?? []) as Plan[]}
      currentPlan={currentPlan}
      billingDay={tenant.billing_day}
      subscriptionStatus={tenant.subscription_status ?? "active"}
      graceDays={tenant.past_due_grace_days ?? null}
      pastDueSince={tenant.past_due_since ?? null}
      subscriptionEndsAt={tenant.subscription_ends_at ?? null}
      activeUsers={activeUsers ?? 0}
      charges={(charges ?? []) as TenantCharge[]}
      invoices={(invoices ?? []) as InvoiceWithItems[]}
    />
    </>
  )
}
