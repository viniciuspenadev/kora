"use server"

// ═══════════════════════════════════════════════════════════════
// God Mode — set/clear limites por tenant
// ═══════════════════════════════════════════════════════════════
// Apenas platform admin. Toda mudança vai pro audit_log.

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { logAudit } from "@/lib/audit"
import { revalidatePath } from "next/cache"
import type { LimitResource } from "@/lib/limits"

async function requirePlatformAdmin() {
  const session = await auth()
  if (!session?.user.isPlatformAdmin) throw new Error("Acesso negado — apenas platform admin")
  return session
}

export interface SetLimitInput {
  tenantId:   string
  resource:   LimitResource
  maxValue:   number | null   // null = ilimitado (override explícito)
  reason?:    string | null
  expiresAt?: string | null   // ISO date
}

export async function setTenantLimit(input: SetLimitInput): Promise<{ ok: true } | { error: string }> {
  const session = await requirePlatformAdmin()

  if (!input.tenantId || !input.resource) return { error: "tenantId e resource obrigatórios" }
  if (input.maxValue !== null && (input.maxValue < 0 || !Number.isInteger(input.maxValue))) {
    return { error: "maxValue precisa ser inteiro >= 0 ou null (ilimitado)" }
  }

  // Confere tenant existe
  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("id, name")
    .eq("id", input.tenantId)
    .maybeSingle()
  if (!tenant) return { error: "Tenant não encontrado" }

  // Estado anterior pra audit
  const { data: before } = await supabaseAdmin
    .from("tenant_limits")
    .select("max_value, reason, expires_at")
    .eq("tenant_id", input.tenantId)
    .eq("resource", input.resource)
    .maybeSingle()

  const { error } = await supabaseAdmin
    .from("tenant_limits")
    .upsert({
      tenant_id:  input.tenantId,
      resource:   input.resource,
      max_value:  input.maxValue,
      reason:     input.reason?.trim() || null,
      expires_at: input.expiresAt || null,
      set_by:     session.user.id,
      set_at:     new Date().toISOString(),
    }, { onConflict: "tenant_id,resource" })

  if (error) return { error: error.message }

  await logAudit({
    tenantId:   input.tenantId,
    actorId:    session.user.id,
    actorEmail: session.user.email ?? null,
    action:     "limit.set",
    targetType: "limit",
    targetId:   input.resource,
    before:     before ?? null,
    after:      {
      max_value:  input.maxValue,
      reason:     input.reason ?? null,
      expires_at: input.expiresAt ?? null,
    },
    metadata:   { tenant_name: tenant.name },
  })

  revalidatePath(`/admin/tenants/${input.tenantId}/limites`)
  revalidatePath(`/admin/tenants/${input.tenantId}/modulos`)
  return { ok: true }
}

/**
 * Remove o override — volta a usar default do plano.
 */
export async function clearTenantLimit(
  tenantId: string,
  resource: LimitResource,
): Promise<{ ok: true } | { error: string }> {
  const session = await requirePlatformAdmin()

  const { error } = await supabaseAdmin
    .from("tenant_limits")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("resource", resource)

  if (error) return { error: error.message }

  await logAudit({
    tenantId,
    actorId:    session.user.id,
    actorEmail: session.user.email ?? null,
    action:     "limit.clear_override",
    targetType: "limit",
    targetId:   resource,
  })

  revalidatePath(`/admin/tenants/${tenantId}/limites`)
  return { ok: true }
}
