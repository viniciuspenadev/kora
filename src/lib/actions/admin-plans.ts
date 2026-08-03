"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import { applyPlan } from "@/lib/plans"
import { LIMIT_META, type LimitResource } from "@/lib/limits-shared"

const LIMIT_KEYS = Object.keys(LIMIT_META) as LimitResource[]

/** Sanitiza o jsonb de limites: só number≥0 ou null, por recurso conhecido. */
function cleanLimits(raw: unknown): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>
    for (const k of LIMIT_KEYS) {
      if (!(k in o)) continue
      const v = o[k]
      if (v === null) out[k] = null
      else if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = Math.round(v)
    }
  }
  return out
}

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
  limits:                 Record<string, number | null>
  trial_days:             number   // 0 = sem validade (permanente); >0 = expira em N dias
  trial_activation_mode:  string   // "auto" | "manual"
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
  limits:                 Record<string, number | null>
  trial_days:             number   // 0 = sem validade (permanente); >0 = expira em N dias
  trial_activation_mode:  string   // "auto" | "manual"
  active:                 boolean
}

function validate(input: PlanInput): string | null {
  if (!input.name.trim())                  return "Dê um nome ao plano"
  if (input.price_cents < 0)               return "Preço inválido"
  if (input.user_quota < 1)                return "A cota de usuários precisa ser ao menos 1"
  if (input.extra_user_price_cents < 0)    return "Preço por usuário adicional inválido"
  if (input.trial_days < 0)                return "Dias de validade inválidos"
  if (!["auto", "manual"].includes(input.trial_activation_mode)) return "Modo de ativação inválido"
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
    limits:                 cleanLimits(input.limits),
    trial_days:             Math.max(0, Math.round(input.trial_days ?? 0)),
    trial_activation_mode:  input.trial_activation_mode === "auto" ? "auto" : "manual",
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

  if (!planId) {
    const { error } = await supabaseAdmin.from("tenants").update({ plan_id: null }).eq("id", tenantId)
    if (error) return { error: error.message }
  } else {
    // Fonte única: aplica plan_id + plan string + módulos do plano (mantém manuais).
    const r = await applyPlan(tenantId, planId)
    if (!r.ok) return { error: r.error }
  }

  revalidatePath(`/admin/tenants/${tenantId}`)
  revalidatePath(`/admin/tenants/${tenantId}/modulos`)
  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  revalidatePath("/admin/planos")
  return {}
}
