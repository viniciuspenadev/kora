import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { asaas, AsaasError } from "@/lib/asaas/client"

export type BillingChange = { id: string; tenant_id: string; from_mode: "manual" | "gateway"; to_mode: "manual" | "gateway"; state: string; effective_on: string; previous_subscription_id: string | null }
export function billingSnapshot(t: Record<string, unknown>) {
  return { billing_mode: t.billing_mode, subscription: t.asaas_subscription_id ?? null, customer: t.asaas_customer_id ?? null,
    status: t.subscription_status, ends: t.subscription_ends_at ?? null, lifecycle: t.lifecycle_state ?? null,
    active: t.active, plan: t.plan_id ?? null, trial: t.trial_ends_at ?? null, past_due: t.past_due_since ?? null, reason: t.past_due_reason ?? null }
}
export function billingChangeError(message: string): string {
  if (/paid_period_overlap/.test(message)) return "A vigência deve começar depois do último dia já pago."
  if (/open_invoices|invoices_changed/.test(message)) return "Revise as faturas pendentes e o período pago antes de mudar para gateway."
  if (/state_changed/.test(message)) return "O cliente mudou desde a revisão. Recarregue e confira as condições."
  if (/access_review|subscription_in_progress|old_subscription/.test(message)) return "Revise o acesso e a contratação em andamento antes de alterar a modalidade."
  return "Não foi possível concluir a mudança. Confira o estado e tente novamente."
}

/** Retrying the same receipt never cancels a replacement subscription. */
export async function completeBillingChange(change: BillingChange): Promise<{ completed?: boolean; error?: string }> {
  if (change.state === "completed") return { completed: true }
  if (change.state !== "pending") return { error: "Esta mudança foi cancelada." }
  let canceled = false
  if (change.from_mode === "gateway" && change.previous_subscription_id) {
    try {
      await asaas.del(`/subscriptions/${encodeURIComponent(change.previous_subscription_id)}`)
      canceled = true
    } catch (e) {
      if (e instanceof AsaasError && e.status === 404) canceled = true
      else return { error: "O gateway não confirmou o cancelamento. A mudança permanece pendente; use Retomar para conferir novamente." }
    }
  }
  const { data, error } = await supabaseAdmin.rpc("concluir_modalidade_cobranca", {
    p_id: change.id, p_external_canceled: canceled,
  })
  if (error) return { error: billingChangeError(error.message) }
  return { completed: data === true }
}

export async function runScheduledBillingChanges(): Promise<void> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date())
  const { data, error } = await supabaseAdmin.from("tenant_billing_changes").select("*")
    .eq("state", "pending").eq("from_mode", "manual").lte("effective_on", today).limit(100)
  if (error) throw new Error("Falha ao consultar mudanças agendadas de cobrança")
  let failed = false
  for (const row of data ?? []) {
    const result = await completeBillingChange(row as BillingChange)
    if (result.error) { failed = true; console.error(JSON.stringify({ src: "billing-mode-change", operation: row.id, result: "review_required" })) }
  }
  if (failed) throw new Error("Mudança de cobrança agendada precisa de revisão no Godmode")
}
