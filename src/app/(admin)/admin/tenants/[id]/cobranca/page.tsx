import { notFound } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { CobrancaClient } from "./client"
import type { Plan } from "@/lib/actions/admin-plans"
import type { TenantCharge, Invoice, InvoiceItem } from "@/lib/actions/admin-billing"

export type InvoiceWithItems = Invoice & { invoice_items: InvoiceItem[] }

export default async function TenantBillingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("id, name, plan_id, billing_day, subscription_status")
    .eq("id", id)
    .maybeSingle()

  if (!tenant) notFound()

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
    <CobrancaClient
      tenantId={id}
      plans={(plans ?? []) as Plan[]}
      currentPlan={currentPlan}
      billingDay={tenant.billing_day}
      subscriptionStatus={tenant.subscription_status ?? "active"}
      activeUsers={activeUsers ?? 0}
      charges={(charges ?? []) as TenantCharge[]}
      invoices={(invoices ?? []) as InvoiceWithItems[]}
    />
  )
}
