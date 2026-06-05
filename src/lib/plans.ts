import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { applyDefaultModules } from "@/lib/modules"

// tenants.plan (string) é só label/fallback agora — a verdade é plan_id.
const TIERS = ["trial", "starter", "pro", "enterprise"]
function tierFromName(name: string): string {
  const n = (name ?? "").trim().toLowerCase()
  return TIERS.includes(n) ? n : "pro"
}

/**
 * Encaixa um plano num tenant (fonte: tabela `plans`).
 *
 *  • Aponta `tenant.plan_id` (verdade) + `tenant.plan` (string p/ label/fallback).
 *  • HABILITA os módulos do plano — e MANTÉM os extras manuais (não desabilita
 *    nada, pra um downgrade não apagar algo liberado de propósito no god mode).
 *  • Os LIMITES NÃO são copiados: resolvem AO VIVO de `plans.limits` (ver limits.ts).
 *
 * Usado no signup (plano Trial), no god mode (trocar plano) e, no futuro, no
 * checkout (upgrade self-service).
 */
export async function applyPlan(tenantId: string, planId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: plan } = await supabaseAdmin
    .from("plans")
    .select("name, included_modules")
    .eq("id", planId)
    .maybeSingle()
  if (!plan) return { ok: false, error: "Plano não encontrado." }

  await supabaseAdmin
    .from("tenants")
    .update({ plan_id: planId, plan: tierFromName(plan.name as string) })
    .eq("id", tenantId)

  const mods = ((plan.included_modules as string[] | null) ?? []).filter(Boolean)
  if (mods.length > 0) {
    await supabaseAdmin.from("tenant_modules").upsert(
      mods.map((slug) => ({ tenant_id: tenantId, module_slug: slug, enabled: true, reason: "Incluído no plano" })),
      { onConflict: "tenant_id,module_slug" },
    )
  } else {
    // Plano sem módulos definidos → core + default-on (não deixa o tenant pelado).
    await applyDefaultModules(tenantId)
  }
  return { ok: true }
}
