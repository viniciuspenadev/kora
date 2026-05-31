"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"

/**
 * CRUD de planos (god mode). Plano = nome + preço + cota de usuários +
 * preço por usuário adicional + módulos inclusos. Sem free/trial.
 */

async function requirePlatformAdmin() {
  const session = await auth()
  if (!session?.user?.isPlatformAdmin) throw new Error("Acesso restrito a platform admin")
  return session
}

export interface Plan {
  id:                     string
  name:                   string
  description:            string | null
  price_cents:            number
  user_quota:             number
  extra_user_price_cents: number
  included_modules:       string[]
  active:                 boolean
  position:               number
  created_at:             string
  updated_at:             string
}

export interface PlanInput {
  name:                   string
  description:            string | null
  price_cents:            number
  user_quota:             number
  extra_user_price_cents: number
  included_modules:       string[]
  active:                 boolean
}

function validate(input: PlanInput): string | null {
  if (!input.name.trim())                  return "Dê um nome ao plano"
  if (input.price_cents < 0)               return "Preço inválido"
  if (input.user_quota < 1)                return "A cota de usuários precisa ser ao menos 1"
  if (input.extra_user_price_cents < 0)    return "Preço por usuário adicional inválido"
  return null
}

function clean(input: PlanInput) {
  return {
    name:                   input.name.trim(),
    description:            input.description?.trim() || null,
    price_cents:            Math.round(input.price_cents),
    user_quota:             Math.round(input.user_quota),
    extra_user_price_cents: Math.round(input.extra_user_price_cents),
    included_modules:       Array.from(new Set((input.included_modules ?? []).map((s) => s.trim()).filter(Boolean))),
    active:                 input.active,
  }
}

export async function listPlans(): Promise<Plan[]> {
  await requirePlatformAdmin()
  const { data } = await supabaseAdmin
    .from("plans")
    .select("*")
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
  return (data ?? []) as Plan[]
}

export async function createPlan(input: PlanInput): Promise<{ error?: string; id?: string }> {
  await requirePlatformAdmin()
  const err = validate(input)
  if (err) return { error: err }

  const { data, error } = await supabaseAdmin
    .from("plans")
    .insert({ ...clean(input), updated_at: new Date().toISOString() })
    .select("id")
    .single()

  if (error) return { error: error.message }
  revalidatePath("/admin/planos")
  return { id: data.id }
}

export async function updatePlan(id: string, input: PlanInput): Promise<{ error?: string }> {
  await requirePlatformAdmin()
  const err = validate(input)
  if (err) return { error: err }

  const { error } = await supabaseAdmin
    .from("plans")
    .update({ ...clean(input), updated_at: new Date().toISOString() })
    .eq("id", id)

  if (error) return { error: error.message }
  revalidatePath("/admin/planos")
  return {}
}

/**
 * Exclui um plano. Bloqueia se houver tenant usando (preserva integridade) —
 * nesse caso, sugere arquivar (active=false).
 */
export async function deletePlan(id: string): Promise<{ error?: string }> {
  await requirePlatformAdmin()

  const { count } = await supabaseAdmin
    .from("tenants")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", id)

  if ((count ?? 0) > 0) {
    return { error: `${count} tenant(s) usam este plano. Reatribua-os ou arquive o plano em vez de excluir.` }
  }

  const { error } = await supabaseAdmin.from("plans").delete().eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/admin/planos")
  return {}
}

/**
 * Atribui (ou remove, com null) um plano a um tenant.
 * Ao atribuir, **habilita os módulos inclusos no plano** (upsert em tenant_modules).
 * Aditivo: não desabilita módulos que o tenant já tinha fora do plano — ajuste
 * fino fica na aba Módulos.
 */
export async function assignPlanToTenant(tenantId: string, planId: string | null): Promise<{ error?: string }> {
  await requirePlatformAdmin()

  const { error } = await supabaseAdmin
    .from("tenants")
    .update({ plan_id: planId })
    .eq("id", tenantId)
  if (error) return { error: error.message }

  if (planId) {
    const { data: plan } = await supabaseAdmin
      .from("plans").select("name, included_modules").eq("id", planId).maybeSingle()
    const mods = (plan?.included_modules ?? []) as string[]
    if (mods.length > 0) {
      const rows = mods.map((slug) => ({
        tenant_id:   tenantId,
        module_slug: slug,
        enabled:     true,
        reason:      `Plano ${plan?.name ?? ""}`.trim(),
      }))
      await supabaseAdmin.from("tenant_modules").upsert(rows, { onConflict: "tenant_id,module_slug" })
    }
  }

  revalidatePath(`/admin/tenants/${tenantId}`)
  revalidatePath(`/admin/tenants/${tenantId}/modulos`)
  revalidatePath("/admin/planos")
  return {}
}
