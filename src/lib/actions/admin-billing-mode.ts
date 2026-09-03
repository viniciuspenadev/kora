"use server"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { billingChangeError, completeBillingChange, type BillingChange } from "@/lib/billing/mode-change"
import { revalidatePath } from "next/cache"

export async function changeBillingMode(tenantId: string, input: { requestId: string; mode: "manual" | "gateway"; effectiveOn: string; snapshot: Record<string, unknown> }) {
  const session = await auth()
  if (!session?.user.isPlatformAdmin) throw new Error("Acesso negado")
  if (!input || !/^[0-9a-f-]{36}$/i.test(input.requestId) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.effectiveOn) || !["manual", "gateway"].includes(input.mode)) return { error: "Condições inválidas." }
  const { data, error } = await supabaseAdmin.rpc("preparar_modalidade_cobranca", {
    p_id: input.requestId, p_tenant: tenantId, p_actor: session.user.id, p_mode: input.mode, p_effective: input.effectiveOn, p_snapshot: input.snapshot,
  })
  if (error || !data) return { error: billingChangeError(error?.message ?? "") }
  const result = await completeBillingChange(data as BillingChange)
  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  return result
}

export async function resumeBillingModeChange(tenantId: string, operationId: string) {
  const session = await auth()
  if (!session?.user.isPlatformAdmin) throw new Error("Acesso negado")
  const { data, error } = await supabaseAdmin.from("tenant_billing_changes").select("*").eq("tenant_id", tenantId).eq("id", operationId).maybeSingle()
  if (error || !data) return { error: "Mudança não encontrada." }
  const result = await completeBillingChange(data as BillingChange)
  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  return result
}

export async function cancelBillingModeSchedule(tenantId: string, operationId: string) {
  const session = await auth()
  if (!session?.user.isPlatformAdmin) throw new Error("Acesso negado")
  const { error } = await supabaseAdmin.rpc("cancelar_agendamento_modalidade", { p_id: operationId, p_tenant: tenantId, p_actor: session.user.id })
  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  return error ? { error: "Não foi possível cancelar este agendamento." } : {}
}
