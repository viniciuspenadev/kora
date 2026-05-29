// ═══════════════════════════════════════════════════════════════
// God Mode — Limites (lado SERVER: queries + checks)
// ═══════════════════════════════════════════════════════════════
// Tipos + metadados + defaults vivem em limits-shared.ts (safe pra client).
// Este arquivo é server-only — toca DB.

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import {
  LIMIT_META,
  DEFAULT_LIMITS_BY_PLAN,
  ALL_PLANS,
  type LimitResource,
  type LimitInfo,
} from "@/lib/limits-shared"

// Re-export pros callers que continuam importando de "@/lib/limits"
export { LIMIT_META, DEFAULT_LIMITS_BY_PLAN, ALL_PLANS } from "@/lib/limits-shared"
export type { LimitResource, LimitInfo } from "@/lib/limits-shared"

// ── Resolver max (override OU default do plano) ────────────────

async function resolveMax(
  tenantId: string,
  resource: LimitResource,
  plan:     string,
): Promise<{ max: number | null; source: "override" | "default" }> {
  const { data: override } = await supabaseAdmin
    .from("tenant_limits")
    .select("max_value, expires_at")
    .eq("tenant_id", tenantId)
    .eq("resource", resource)
    .maybeSingle()

  if (override) {
    const expired = override.expires_at && new Date(override.expires_at).getTime() < Date.now()
    if (!expired) {
      return { max: override.max_value, source: "override" }
    }
  }

  const planDefaults = DEFAULT_LIMITS_BY_PLAN[plan] ?? DEFAULT_LIMITS_BY_PLAN.trial
  return { max: planDefaults[resource], source: "default" }
}

// ── Contagem de uso por recurso ────────────────────────────────

async function getUsage(tenantId: string, resource: LimitResource): Promise<number> {
  switch (resource) {
    case "users": {
      const [{ count: active }, { count: pending }] = await Promise.all([
        supabaseAdmin
          .from("tenant_users")
          .select("user_id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("active", true),
        supabaseAdmin
          .from("invites")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .is("accepted_at", null)
          .gte("expires_at", new Date().toISOString()),
      ])
      return (active ?? 0) + (pending ?? 0)
    }

    case "whatsapp_instances": {
      const { count } = await supabaseAdmin
        .from("whatsapp_instances")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
      return count ?? 0
    }

    case "contacts": {
      const { count } = await supabaseAdmin
        .from("chat_contacts")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
      return count ?? 0
    }

    case "messages_per_month": {
      const monthStart = new Date()
      monthStart.setDate(1)
      monthStart.setHours(0, 0, 0, 0)
      const { count } = await supabaseAdmin
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .gte("created_at", monthStart.toISOString())
      return count ?? 0
    }

    case "storage_mb": {
      const { data } = await supabaseAdmin
        .from("chat_messages")
        .select("media_size_bytes")
        .eq("tenant_id", tenantId)
        .not("media_size_bytes", "is", null)
      const totalBytes = (data ?? []).reduce((sum, r) => sum + (r.media_size_bytes ?? 0), 0)
      return Math.round(totalBytes / (1024 * 1024))
    }

    case "broadcasts_per_month":
      return 0
  }
}

async function getTenantPlan(tenantId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("tenants")
    .select("plan")
    .eq("id", tenantId)
    .maybeSingle()
  return data?.plan ?? "trial"
}

// ── API pública ────────────────────────────────────────────────

export async function checkLimit(tenantId: string, resource: LimitResource): Promise<LimitInfo> {
  const plan = await getTenantPlan(tenantId)
  const [{ max, source }, used] = await Promise.all([
    resolveMax(tenantId, resource, plan),
    getUsage(tenantId, resource),
  ])

  if (max === null) {
    return { resource, max: null, used, remaining: null, ok: true, source }
  }
  return {
    resource,
    max,
    used,
    remaining: Math.max(0, max - used),
    ok:        used < max,
    source,
  }
}

export async function requireLimit(tenantId: string, resource: LimitResource): Promise<void> {
  const info = await checkLimit(tenantId, resource)
  if (!info.ok) {
    const meta = LIMIT_META[resource]
    throw new Error(
      `Limite de ${meta.label.toLowerCase()} atingido (${info.used}/${info.max}). ` +
      `Solicite aumento ao administrador da plataforma.`,
    )
  }
}

export async function listAllLimits(tenantId: string): Promise<LimitInfo[]> {
  const resources: LimitResource[] = [
    "users", "whatsapp_instances", "contacts",
    "messages_per_month",
    "broadcasts_per_month", "storage_mb",
  ]
  return Promise.all(resources.map((r) => checkLimit(tenantId, r)))
}
