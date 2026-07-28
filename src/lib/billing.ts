import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Núcleo financeiro (sem auth) — reusado por:
 *   - admin-billing.ts (server actions, com requirePlatformAdmin)
 *   - /api/cron/billing (geração mensal automática)
 *   - dashboard + /admin/financeiro (resumo de MRR)
 */

interface PlanRow { id: string; name: string; price_cents: number; user_quota: number; extra_user_price_cents: number }

export interface BillingSummary {
  mrr_cents: number
  billed:    number
  noPlan:    number
  byPlan:    Array<{ id: string; name: string; cents: number; count: number }>
}

/** MRR consolidado: tenants ativos, com plano, assinatura não-cancelada. */
export async function computeBillingSummary(): Promise<BillingSummary> {
  const [{ data: tenants }, { data: plans }, { data: activeUsers }, { data: recurring }] = await Promise.all([
    supabaseAdmin.from("tenants").select("id, plan_id, subscription_status").eq("active", true),
    supabaseAdmin.from("plans").select("id, name, price_cents, user_quota, extra_user_price_cents"),
    supabaseAdmin.from("tenant_users").select("tenant_id").eq("active", true),
    supabaseAdmin.from("tenant_charges").select("tenant_id, amount_cents").eq("kind", "recurring_addon").eq("active", true),
  ])

  const planById = new Map<string, PlanRow>()
  for (const p of (plans ?? []) as PlanRow[]) planById.set(p.id, p)

  const usersByTenant = new Map<string, number>()
  for (const r of activeUsers ?? []) {
    const t = (r as { tenant_id: string }).tenant_id
    usersByTenant.set(t, (usersByTenant.get(t) ?? 0) + 1)
  }
  const addonsByTenant = new Map<string, number>()
  for (const r of recurring ?? []) {
    const c = r as { tenant_id: string; amount_cents: number }
    addonsByTenant.set(c.tenant_id, (addonsByTenant.get(c.tenant_id) ?? 0) + c.amount_cents)
  }

  let mrr = 0, billed = 0, noPlan = 0
  const byPlan = new Map<string, { id: string; name: string; cents: number; count: number }>()

  for (const t of (tenants ?? []) as Array<{ id: string; plan_id: string | null; subscription_status: string | null }>) {
    if (!t.plan_id) { noPlan++; continue }
    if (t.subscription_status === "canceled") continue
    const plan = planById.get(t.plan_id)
    if (!plan) continue
    billed++
    const users   = usersByTenant.get(t.id) ?? 0
    const overage = Math.max(0, users - plan.user_quota) * plan.extra_user_price_cents
    const addons  = addonsByTenant.get(t.id) ?? 0
    const total   = plan.price_cents + overage + addons
    mrr += total
    const agg = byPlan.get(plan.id) ?? { id: plan.id, name: plan.name, cents: 0, count: 0 }
    agg.cents += total; agg.count++
    byPlan.set(plan.id, agg)
  }

  return {
    mrr_cents: mrr,
    billed,
    noPlan,
    byPlan: Array.from(byPlan.values()).sort((a, b) => b.cents - a.cents),
  }
}

// ── Geração de fatura ───────────────────────────────────────────
export function currentPeriod(billingDay: number | null): { start: string; end: string; due: string } {
  const day = Math.min(Math.max(billingDay ?? 1, 1), 28)
  const now = new Date()
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate()
  let startY = y, startM = m
  if (d < day) { startM = m - 1; if (startM < 0) { startM = 11; startY = y - 1 } }
  const start   = new Date(Date.UTC(startY, startM, day))
  const endExcl = new Date(Date.UTC(startY, startM + 1, day))
  const end     = new Date(endExcl.getTime() - 86_400_000)
  const due     = new Date(start.getTime() + 7 * 86_400_000)
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10)
  return { start: fmt(start), end: fmt(end), due: fmt(due) }
}

/**
 * Gera a fatura do período atual de UM tenant (sem auth — caller decide).
 * Itens: plano base + overage de usuários + add-ons recorrentes + avulsas
 * pendentes. Idempotente por período (recusa se já houver fatura não-void).
 */
export async function generateInvoiceForTenant(tenantId: string): Promise<{ error?: string; id?: string; skipped?: boolean }> {
  const { data: tenant } = await supabaseAdmin
    .from("tenants").select("id, plan_id, billing_day").eq("id", tenantId).maybeSingle()
  if (!tenant)         return { error: "Tenant não encontrado" }
  if (!tenant.plan_id) return { error: "Tenant sem plano atribuído" }

  const { data: plan } = await supabaseAdmin.from("plans").select("*").eq("id", tenant.plan_id).maybeSingle()
  if (!plan) return { error: "Plano do tenant não encontrado" }

  const period = currentPeriod(tenant.billing_day)

  const { count: dup } = await supabaseAdmin
    .from("invoices").select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("period_start", period.start).neq("status", "void")
  if ((dup ?? 0) > 0) return { error: "Já existe uma fatura para este período", skipped: true }

  const { count: activeUsers } = await supabaseAdmin
    .from("tenant_users").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("active", true)
  const users = activeUsers ?? 0

  const { data: charges } = await supabaseAdmin
    .from("tenant_charges").select("*").eq("tenant_id", tenantId).eq("active", true)

  const items: Array<{ kind: string; description: string; quantity: number; unit_price_cents: number; amount_cents: number }> = []
  items.push({ kind: "plan", description: `Plano ${plan.name}`, quantity: 1, unit_price_cents: plan.price_cents, amount_cents: plan.price_cents })

  const extra = Math.max(0, users - plan.user_quota)
  if (extra > 0 && plan.extra_user_price_cents > 0) {
    items.push({
      kind: "overage",
      description: `${extra} usuário(s) adicional(is) — cota ${plan.user_quota}, ativos ${users}`,
      quantity: extra, unit_price_cents: plan.extra_user_price_cents, amount_cents: extra * plan.extra_user_price_cents,
    })
  }

  const oneoffIds: string[] = []
  for (const c of (charges ?? []) as Array<{ id: string; kind: string; description: string; amount_cents: number }>) {
    items.push({
      kind: c.kind === "recurring_addon" ? "addon" : "oneoff",
      description: c.description, quantity: 1, unit_price_cents: c.amount_cents, amount_cents: c.amount_cents,
    })
    if (c.kind === "oneoff") oneoffIds.push(c.id)
  }

  const subtotal = items.reduce((s, i) => s + i.amount_cents, 0)

  const { data: inv, error } = await supabaseAdmin
    .from("invoices")
    .insert({
      tenant_id: tenantId, status: "open",
      period_start: period.start, period_end: period.end, due_date: period.due,
      subtotal_cents: subtotal, total_cents: subtotal, issued_at: new Date().toISOString(),
    })
    .select("id").single()
  if (error) return { error: error.message }

  const { error: itemsErr } = await supabaseAdmin
    .from("invoice_items").insert(items.map((i) => ({ ...i, invoice_id: inv.id })))
  if (itemsErr) return { error: itemsErr.message }

  if (oneoffIds.length > 0) {
    await supabaseAdmin.from("tenant_charges").update({ active: false, updated_at: new Date().toISOString() }).in("id", oneoffIds)
  }

  return { id: inv.id }
}

/**
 * Geração mensal automática: para cada tenant ativo cujo billing_day == hoje
 * (UTC), com plano e assinatura não-cancelada, gera a fatura do período.
 * Idempotente (a guarda por período evita duplicar se rodar 2x).
 */
export async function runMonthlyBilling(): Promise<{ generated: number; skipped: number; failed: number; details: Array<{ tenantId: string; status: string; reason?: string }> }> {
  const todayDay = new Date().getUTCDate()

  const { data: tenants } = await supabaseAdmin
    .from("tenants")
    .select("id, billing_day, subscription_status, plan_id")
    .eq("active", true)
    .eq("billing_day", todayDay)
    .not("plan_id", "is", null)
    .neq("subscription_status", "canceled")

  const details: Array<{ tenantId: string; status: string; reason?: string }> = []
  let generated = 0, skipped = 0, failed = 0

  for (const t of (tenants ?? []) as Array<{ id: string }>) {
    const r = await generateInvoiceForTenant(t.id)
    if (r.id)            { generated++; details.push({ tenantId: t.id, status: "generated" }) }
    else if (r.skipped)  { skipped++;   details.push({ tenantId: t.id, status: "skipped", reason: r.error }) }
    else                 { failed++;    details.push({ tenantId: t.id, status: "failed", reason: r.error }) }
  }

  return { generated, skipped, failed, details }
}
