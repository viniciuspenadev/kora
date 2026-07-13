// ═══════════════════════════════════════════════════════════════
// God Mode — Helpers de módulos
// ═══════════════════════════════════════════════════════════════
// Source of truth: `module_catalog` (seed) + `tenant_modules` (overrides).
// Resolve via SQL function `tenant_has_module(uuid, text)`.
//
// Uso típico:
//
//   // Gate em server action
//   await requireModule("broadcasts")  // throws Error("Módulo não habilitado")
//
//   // Gate condicional (boolean)
//   if (await hasModule(tenantId, "ai_atendente")) { ... }
//
//   // Lista pra UI (filtrar sidebar)
//   const slugs = await getEnabledModuleSlugs(tenantId)
//
// IMPORTANTE:
//   - Core modules (is_core=true) sempre retornam true, mesmo sem linha em tenant_modules
//   - `expires_at` é respeitado pela função SQL (override temporário expira)

import "server-only"
import { cache } from "react"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"

// Lista canônica de slugs — atualizar quando seed mudar
export type ModuleSlug =
  // Core
  | "inbox" | "contacts" | "tags" | "team"
  // Commercial
  | "kanban" | "pipelines" | "quick_replies" | "auto_assign" | "agenda" | "agenda_reminders" | "agenda_owner_routing"
  | "crm"
  // Lead gen
  | "widget_site" | "keyword_triggers" | "welcome_message" | "business_hours"
  // AI
  | "ai_atendente" | "ai_suggestions" | "ai_knowledge_base" | "ai_studio"
  // Engagement
  | "broadcasts" | "sequences" | "chatbot_builder"
  // Multi-channel
  | "multi_instance" | "meta_cloud" | "instagram_direct"
  // Operational
  | "audit_log_ui" | "webhook_outbound" | "api_access" | "white_label" | "sso" | "inventory"
  // Billing
  | "billing_panel" | "usage_limits"

export interface ModuleCatalogEntry {
  slug:        string
  category:    string
  name:        string
  description: string | null
  is_core:     boolean
  default_on:  boolean
  position:    number
}

export interface TenantModuleStatus {
  slug:        string
  category:    string
  name:        string
  description: string | null
  is_core:     boolean
  enabled:     boolean
  reason:      string | null
  expires_at:  string | null
  set_at:      string | null
}

// ── API ────────────────────────────────────────────────────────

/**
 * Verifica se o tenant tem o módulo habilitado.
 * Core modules sempre retornam true.
 * Memoizado POR REQUEST (React cache): page + actions + gates repetidos na mesma
 * renderização custam 1 RPC só — corte direto de latência de navegação.
 */
export const hasModule = cache(async (tenantId: string, slug: ModuleSlug): Promise<boolean> => {
  const { data, error } = await supabaseAdmin
    .rpc("tenant_has_module", { p_tenant_id: tenantId, p_slug: slug })

  if (error) {
    console.error("[modules] hasModule failed:", error.message)
    return false
  }
  return !!data
})

/**
 * Throws se o tenant da sessão atual NÃO tem o módulo. Use em server actions.
 *
 * @example
 *   export async function createBroadcast(...) {
 *     await requireModule("broadcasts")  // throws antes de qualquer DB write
 *     ...
 *   }
 */
export async function requireModule(slug: ModuleSlug): Promise<void> {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  const ok = await hasModule(session.user.tenantId, slug)
  if (!ok) {
    throw new Error(`Módulo "${slug}" não habilitado pra este tenant. Fale com o suporte.`)
  }
}

/**
 * Lista todos os slugs habilitados pra um tenant (incluindo core).
 * Usado no layout/sidebar pra filtrar itens visíveis.
 */
export async function getEnabledModuleSlugs(tenantId: string): Promise<Set<string>> {
  const [{ data: core }, { data: tm }] = await Promise.all([
    supabaseAdmin
      .from("module_catalog")
      .select("slug")
      .eq("is_core", true),
    supabaseAdmin
      .from("tenant_modules")
      .select("module_slug, expires_at")
      .eq("tenant_id", tenantId)
      .eq("enabled", true),
  ])

  const now    = Date.now()
  const slugs  = new Set<string>()
  ;(core ?? []).forEach((r) => slugs.add(r.slug))
  ;(tm ?? []).forEach((r) => {
    if (!r.expires_at || new Date(r.expires_at).getTime() > now) {
      slugs.add(r.module_slug)
    }
  })
  return slugs
}

/**
 * Lista TODOS os módulos do catálogo com status pra um tenant — usado
 * na página do god mode pra mostrar tudo (habilitado, desabilitado, core).
 */
export async function listAllModulesForTenant(tenantId: string): Promise<TenantModuleStatus[]> {
  const [{ data: catalog }, { data: tm }] = await Promise.all([
    supabaseAdmin
      .from("module_catalog")
      .select("slug, category, name, description, is_core, default_on, position")
      .order("position", { ascending: true }),
    supabaseAdmin
      .from("tenant_modules")
      .select("module_slug, enabled, reason, expires_at, set_at")
      .eq("tenant_id", tenantId),
  ])

  const tmMap = new Map<string, { enabled: boolean; reason: string | null; expires_at: string | null; set_at: string | null }>()
  ;(tm ?? []).forEach((r) => tmMap.set(r.module_slug, {
    enabled:    r.enabled,
    reason:     r.reason,
    expires_at: r.expires_at,
    set_at:     r.set_at,
  }))

  const now = Date.now()
  return (catalog ?? []).map((c) => {
    const override = tmMap.get(c.slug)
    const enabled =
      c.is_core ? true :
      override
        ? (override.enabled && (!override.expires_at || new Date(override.expires_at).getTime() > now))
        : false

    return {
      slug:        c.slug,
      category:    c.category,
      name:        c.name,
      description: c.description,
      is_core:     c.is_core,
      enabled,
      reason:      override?.reason ?? null,
      expires_at:  override?.expires_at ?? null,
      set_at:      override?.set_at ?? null,
    }
  })
}

/**
 * Seed inicial: ao criar tenant novo, popular tenant_modules com tudo
 * que é default_on. Chamado por createTenant.
 */
export async function applyDefaultModules(tenantId: string): Promise<void> {
  const { data: defaults } = await supabaseAdmin
    .from("module_catalog")
    .select("slug")
    .eq("default_on", true)
    .eq("is_core", false)  // core não precisa de linha

  if (!defaults?.length) return

  const rows = defaults.map((m) => ({
    tenant_id:   tenantId,
    module_slug: m.slug,
    enabled:     true,
    reason:      "Default ao criar tenant",
  }))

  await supabaseAdmin
    .from("tenant_modules")
    .upsert(rows, { onConflict: "tenant_id,module_slug" })
}
