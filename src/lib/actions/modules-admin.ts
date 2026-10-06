"use server"

// ═══════════════════════════════════════════════════════════════
// God Mode — toggle de módulos por tenant
// ═══════════════════════════════════════════════════════════════
// Apenas platform admin pode invocar. Toda mudança vai pro audit_log.

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { logAudit } from "@/lib/audit"
import { revalidatePath } from "next/cache"

async function requirePlatformAdmin() {
  const session = await auth()
  if (!session?.user.isPlatformAdmin) throw new Error("Acesso negado — apenas platform admin")
  return session
}

export interface SetModuleInput {
  tenantId:   string
  slug:       string
  enabled:    boolean
  /** Nível PRO deste módulo (recursos avançados). Ausente = preserva o que está lá.
   *  ⚠️ Mora NO módulo, não num slug `x_pro` separado (decisão do dono, 2026-08-01):
   *  assim qualquer módulo ganha PRO sem linha nova no catálogo. */
  pro?:       boolean
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
  const { data: before, error: beforeError } = await supabaseAdmin
    .from("tenant_modules")
    .select("enabled, pro, reason, expires_at, source")
    .eq("tenant_id", input.tenantId)
    .eq("module_slug", input.slug)
    .maybeSingle()
  if (beforeError) {
    return { error: `Não foi possível conferir o estado atual do módulo: ${beforeError.message}` }
  }

  // Upsert
  const { error } = await supabaseAdmin
    .from("tenant_modules")
    .upsert({
      tenant_id:   input.tenantId,
      module_slug: input.slug,
      enabled:     input.enabled,
      // 🔴 Desligar o módulo derruba o PRO junto. Deixar `pro=true` numa linha desligada
      //    guarda uma bomba: religar o módulo devolveria os recursos avançados sem
      //    ninguém ter decidido isso.
      pro:         input.enabled ? (input.pro ?? before?.pro ?? false) : false,
      reason:      input.reason?.trim() || null,
      expires_at:  input.expiresAt || null,
      set_by:      session.user.id,
      set_at:      new Date().toISOString(),
      // Qualquer decisão feita nesta action é override humano. Se a linha nasceu do
      // plano, preservar `source=plan` permitiria que um downgrade apagasse a escolha.
      source:      "manual",
    }, { onConflict: "tenant_id,module_slug" })

  if (error) return { error: error.message }

  // (O seed on-enable existia SÓ pro módulo v1 `ai_atendente` — removido junto
  //  com o motor v1, docs/ai-v1-removal-plan.md §F3. Nenhum módulo atual semeia.)

  // Audit log — prova histórica de quem habilitou o quê
  await logAudit({
    tenantId:   input.tenantId,
    actorId:    session.user.id,
    actorEmail: session.user.email ?? null,
    action:     input.enabled ? "module.enable" : "module.disable",
    targetType: "module",
    targetId:   input.slug,
    before:     before ?? { enabled: false, pro: false, reason: null, expires_at: null },
    after:      { enabled: input.enabled, pro: input.enabled ? (input.pro ?? before?.pro ?? false) : false,
                  reason: input.reason ?? null, expires_at: input.expiresAt ?? null, source: "manual" },
    metadata:   {
      module_name: catalog.name,
      tenant_name: tenant.name,
    },
  })

  revalidatePath(`/admin/tenants/${input.tenantId}/modulos`)
  return { ok: true }
}
