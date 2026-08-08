"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import { generateInvoiceForTenant } from "@/lib/billing"

/**
 * Financeiro (god mode) — controle interno, gateway-ready.
 * Assinatura por tenant + cobranças adicionais + faturas (gera/marca pago).
 */

async function requirePlatformAdmin() {
  const session = await auth()
  if (!session?.user?.isPlatformAdmin) throw new Error("Acesso restrito a platform admin")
  return session
}

export type ChargeKind  = "recurring_addon" | "oneoff"
export type InvoiceStatus = "draft" | "open" | "paid" | "overdue" | "void"

export interface TenantCharge {
  id: string; tenant_id: string; kind: ChargeKind; description: string; amount_cents: number; active: boolean; created_at: string
}
export interface Invoice {
  id: string; tenant_id: string; status: InvoiceStatus
  period_start: string; period_end: string; due_date: string | null
  subtotal_cents: number; total_cents: number
  issued_at: string | null; paid_at: string | null; paid_method: string | null; notes: string | null; created_at: string
}
export interface InvoiceItem {
  id: string; invoice_id: string; kind: string; description: string; quantity: number; unit_price_cents: number; amount_cents: number
}

const SUB_STATUS = new Set(["active", "past_due", "canceled"])

// ── Assinatura ──────────────────────────────────────────────────
export async function updateTenantBilling(
  tenantId: string,
  opts: { billing_day?: number | null; subscription_status?: string },
): Promise<{ error?: string }> {
  await requirePlatformAdmin()

  const updates: Record<string, unknown> = { }
  if ("billing_day" in opts) {
    const d = opts.billing_day
    if (d !== null && (typeof d !== "number" || d < 1 || d > 28)) return { error: "Dia de fechamento deve ser entre 1 e 28" }
    updates.billing_day = d
  }
  if (opts.subscription_status) {
    if (!SUB_STATUS.has(opts.subscription_status)) return { error: "Status inválido" }
    updates.subscription_status = opts.subscription_status

    // ── O relógio da carência também nasce aqui ─────────────────────────────
    //
    // 🔴 ESTA AÇÃO ERA (E AINDA É) O ESCRITOR MAIS USADO DE `past_due` — a mão do operador.
    //    Sem carimbar, marcar "em atraso" no god mode produzia um tenant `past_due` com
    //    `past_due_since` NULO, e `passouDaCarencia` é **fail-closed pela data**: sem
    //    carimbo ele responde "já passou" ⇒ o cliente vai pro paywall NA HORA, sem um dia
    //    de carência, e a equipe dele perde o login no mesmo minuto. Um clique de operador
    //    não pode ter esse alcance por omissão.
    // 🔑 Mesma regra do webhook: carimba na TRANSIÇÃO (não reinicia relógio já em curso) e
    //    limpa ao voltar pra `active`. Duas portas, uma regra — se divergirem, o cliente
    //    ganha ou perde dias dependendo de quem o marcou.
    const { data: atual } = await supabaseAdmin
      .from("tenants").select("subscription_status, past_due_since").eq("id", tenantId).maybeSingle()
    const antes = (atual as { subscription_status?: string | null; past_due_since?: string | null } | null)
    if (opts.subscription_status === "past_due") {
      const jaEstava = (antes?.subscription_status ?? "") === "past_due"
      updates.past_due_since = jaEstava && antes?.past_due_since
        ? antes.past_due_since
        : new Date().toISOString()
    } else {
      // `active` ou `canceled`: o atraso deixou de existir como relógio. Deixar o carimbo
      // pra trás é a "invariante 2" da migration — e ele voltaria a morder no próximo atraso.
      updates.past_due_since = null
    }
  }
  if (Object.keys(updates).length === 0) return {}

  const { error } = await supabaseAdmin.from("tenants").update(updates).eq("id", tenantId)
  if (error) return { error: error.message }
  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  return {}
}

// ── Cobranças (add-ons + avulsas) ───────────────────────────────
export async function addCharge(
  tenantId: string,
  input: { kind: ChargeKind; description: string; amount_cents: number },
): Promise<{ error?: string }> {
  await requirePlatformAdmin()
  if (!input.description.trim()) return { error: "Descreva a cobrança" }
  if (input.amount_cents <= 0)   return { error: "Valor inválido" }

  const { error } = await supabaseAdmin.from("tenant_charges").insert({
    tenant_id:    tenantId,
    kind:         input.kind,
    description:  input.description.trim(),
    amount_cents: Math.round(input.amount_cents),
  })
  if (error) return { error: error.message }
  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  return {}
}

export async function setChargeActive(id: string, tenantId: string, active: boolean): Promise<{ error?: string }> {
  await requirePlatformAdmin()
  const { error } = await supabaseAdmin
    .from("tenant_charges")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", tenantId)
  if (error) return { error: error.message }
  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  return {}
}

export async function deleteCharge(id: string, tenantId: string): Promise<{ error?: string }> {
  await requirePlatformAdmin()
  const { error } = await supabaseAdmin.from("tenant_charges").delete().eq("id", id).eq("tenant_id", tenantId)
  if (error) return { error: error.message }
  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  return {}
}

// ── Faturas ─────────────────────────────────────────────────────
/**
 * Gera a fatura do período atual (delega ao núcleo em lib/billing).
 * Idempotente por período (recusa se já houver fatura não-void).
 */
export async function generateInvoice(tenantId: string): Promise<{ error?: string; id?: string }> {
  await requirePlatformAdmin()
  const r = await generateInvoiceForTenant(tenantId)
  if (r.id) revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  return { error: r.error, id: r.id }
}

export async function markInvoicePaid(invoiceId: string, tenantId: string, method: string): Promise<{ error?: string }> {
  await requirePlatformAdmin()
  const { error } = await supabaseAdmin
    .from("invoices")
    .update({ status: "paid", paid_at: new Date().toISOString(), paid_method: method, updated_at: new Date().toISOString() })
    .eq("id", invoiceId)
  if (error) return { error: error.message }
  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  return {}
}

export async function voidInvoice(invoiceId: string, tenantId: string): Promise<{ error?: string }> {
  await requirePlatformAdmin()
  const { error } = await supabaseAdmin
    .from("invoices")
    .update({ status: "void", updated_at: new Date().toISOString() })
    .eq("id", invoiceId)
  if (error) return { error: error.message }
  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  return {}
}
