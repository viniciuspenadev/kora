"use server"

// ═══════════════════════════════════════════════════════════════
// God Mode — toggle de módulos por tenant
// ═══════════════════════════════════════════════════════════════
// Apenas platform admin pode invocar. Toda mudança vai pro audit_log.

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { logAudit } from "@/lib/audit"
import { revalidatePath } from "next/cache"
import { seedAIDefaults } from "@/lib/actions/ai/seed"

async function requirePlatformAdmin() {
  const session = await auth()
  if (!session?.user.isPlatformAdmin) throw new Error("Acesso negado — apenas platform admin")
  return session
}

export interface SetModuleInput {
  tenantId:   string
  slug:       string
  enabled:    boolean
  reason?:    string | null
  expiresAt?: string | null    // ISO date string, opcional
}

export async function setTenantModule(
  input: SetModuleInput,
): Promise<{ ok: true } | { error: string }> {
  const session = await requirePlatformAdmin()

  // Validações
  if (!input.tenantId || !input.slug) return { error: "tenantId e slug obrigatórios" }

  // Confere se o módulo existe e não é core (core não pode ser toggled)
  const { data: catalog } = await supabaseAdmin
    .from("module_catalog")
    .select("slug, name, is_core")
    .eq("slug", input.slug)
    .maybeSingle()
  if (!catalog) return { error: "Módulo não encontrado no catálogo" }
  if (catalog.is_core) return { error: "Módulos core não podem ser desabilitados" }

  // Confere tenant
  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("id, name")
    .eq("id", input.tenantId)
    .maybeSingle()
  if (!tenant) return { error: "Tenant não encontrado" }

  // Estado anterior (pra audit)
  const { data: before } = await supabaseAdmin
    .from("tenant_modules")
    .select("enabled, reason, expires_at")
    .eq("tenant_id", input.tenantId)
    .eq("module_slug", input.slug)
    .maybeSingle()

  // Upsert
  const { error } = await supabaseAdmin
    .from("tenant_modules")
    .upsert({
      tenant_id:   input.tenantId,
      module_slug: input.slug,
      enabled:     input.enabled,
      reason:      input.reason?.trim() || null,
      expires_at:  input.expiresAt || null,
      set_by:      session.user.id,
      set_at:      new Date().toISOString(),
    }, { onConflict: "tenant_id,module_slug" })

  if (error) return { error: error.message }

  // Seed default por módulo (idempotente). Roda só em transição off→on.
  // Falha aqui não rola back o módulo — log no audit metadata.
  let seedError: string | null = null
  if (input.enabled && !before?.enabled) {
    if (input.slug === "ai_atendente") {
      try {
        await seedAIDefaults(input.tenantId)
      } catch (e) {
        seedError = e instanceof Error ? e.message : String(e)
      }
    }
  }

  // Audit log — prova histórica de quem habilitou o quê
  await logAudit({
    tenantId:   input.tenantId,
    actorId:    session.user.id,
    actorEmail: session.user.email ?? null,
    action:     input.enabled ? "module.enable" : "module.disable",
    targetType: "module",
    targetId:   input.slug,
    before:     before ?? { enabled: false, reason: null, expires_at: null },
    after:      { enabled: input.enabled, reason: input.reason ?? null, expires_at: input.expiresAt ?? null },
    metadata:   {
      module_name: catalog.name,
      tenant_name: tenant.name,
      ...(seedError ? { seed_error: seedError } : {}),
    },
  })

  revalidatePath(`/admin/tenants/${input.tenantId}/modulos`)
  return { ok: true }
}

/**
 * Remove o registro de tenant_modules pra um módulo (deixa cair pro default = false).
 * Use quando quiser "limpar" o override sem desabilitar permanente.
 */
export async function clearTenantModule(
  tenantId: string,
  slug: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await requirePlatformAdmin()

  const { error } = await supabaseAdmin
    .from("tenant_modules")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("module_slug", slug)

  if (error) return { error: error.message }

  await logAudit({
    tenantId,
    actorId:    session.user.id,
    actorEmail: session.user.email ?? null,
    action:     "module.clear_override",
    targetType: "module",
    targetId:   slug,
  })

  revalidatePath(`/admin/tenants/${tenantId}/modulos`)
  return { ok: true }
}
