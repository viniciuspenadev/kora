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

// ── Resolver max (override do tenant → limite do PLANO → fallback) ──

const ALL_RESOURCES: LimitResource[] = [
  "users", "whatsapp_official", "whatsapp_qr", "messages_per_month",
  "conversations_per_month", "broadcasts_per_month", "storage_mb", "contacts", "automations",
]

/** Parse SEGURO do jsonb `plans.limits`: só aceita number≥0 ou null; ignora lixo. */
function parsePlanLimits(raw: unknown): Partial<Record<LimitResource, number | null>> {
  const out: Partial<Record<LimitResource, number | null>> = {}
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>
    for (const r of ALL_RESOURCES) {
      if (!Object.prototype.hasOwnProperty.call(o, r)) continue
      const v = o[r]
      if (v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0)) out[r] = v as number | null
    }
  }
  return out
}

interface PlanCtx { plan: string; planLimits: Partial<Record<LimitResource, number | null>> }

/** Plano do tenant + limites do plano (lidos AO VIVO de `plans.limits` via plan_id). */
async function getPlanContext(tenantId: string): Promise<PlanCtx> {
  const { data } = await supabaseAdmin
    .from("tenants")
    .select("plan, plan_id, plans:plan_id ( limits )")
    .eq("id", tenantId)
    .maybeSingle()
  const plan = (data?.plan as string | undefined) ?? "trial"
  const rel = (data as { plans?: { limits?: unknown } | { limits?: unknown }[] | null } | null)?.plans
  const limitsRaw = Array.isArray(rel) ? rel[0]?.limits : rel?.limits
  return { plan, planLimits: parsePlanLimits(limitsRaw) }
}

async function resolveMax(
  tenantId: string,
  resource: LimitResource,
  ctx:      PlanCtx,
): Promise<{ max: number | null; source: "override" | "plan" | "default" }> {
  const { data: override } = await supabaseAdmin
    .from("tenant_limits")
    .select("max_value, expires_at")
    .eq("tenant_id", tenantId)
    .eq("resource", resource)
    .maybeSingle()

  if (override) {
    const expired = override.expires_at && new Date(override.expires_at).getTime() < Date.now()
    if (!expired) return { max: override.max_value, source: "override" }
  }

  // Limite do PLANO (ao vivo). Chave presente vale — inclusive `null` = ilimitado.
  if (Object.prototype.hasOwnProperty.call(ctx.planLimits, resource)) {
    return { max: ctx.planLimits[resource] ?? null, source: "plan" }
  }

  // Fallback: defaults hardcoded por string de plano (legado / tenant sem plano).
  const planDefaults = DEFAULT_LIMITS_BY_PLAN[ctx.plan] ?? DEFAULT_LIMITS_BY_PLAN.trial
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

    case "whatsapp_official": {
      const { count } = await supabaseAdmin
        .from("whatsapp_instances")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("provider", "meta_cloud")
      return count ?? 0
    }

    case "whatsapp_qr": {
      // QR = tudo que NÃO é oficial (inclui provider NULL de instâncias antigas).
      const { count } = await supabaseAdmin
        .from("whatsapp_instances")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .or("provider.is.null,provider.neq.meta_cloud")
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

    case "conversations_per_month": {
      const monthStart = new Date()
      monthStart.setDate(1)
      monthStart.setHours(0, 0, 0, 0)
      const { count } = await supabaseAdmin
        .from("chat_conversations")
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

    case "automations": {
      // Fluxos do Kora Studio que existem (rascunho + publicado); arquivados não contam.
      const { count } = await supabaseAdmin
        .from("studio_flows")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .neq("status", "archived")
      return count ?? 0
    }
  }
}

// ── API pública ────────────────────────────────────────────────

export async function checkLimit(tenantId: string, resource: LimitResource): Promise<LimitInfo> {
  const ctx = await getPlanContext(tenantId)
  const [{ max, source }, used] = await Promise.all([
    resolveMax(tenantId, resource, ctx),
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
    "users", "whatsapp_official", "whatsapp_qr", "contacts",
    "conversations_per_month", "messages_per_month",
    "broadcasts_per_month", "storage_mb", "automations",
  ]
  return Promise.all(resources.map((r) => checkLimit(tenantId, r)))
}
