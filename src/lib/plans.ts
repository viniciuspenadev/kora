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
 *  • CONCEDE o nível PRO nos módulos que o plano marca como PRO (`plans.pro_modules`).
 *  • Os LIMITES NÃO são copiados: resolvem AO VIVO de `plans.limits` (ver limits.ts).
 *
 * Usado no signup (plano Trial), no god mode (trocar plano) e, no futuro, no
 * checkout (upgrade self-service).
 *
 * 🔴 NUNCA ESCREVER `pro: false` AQUI — e é por isso que são DOIS upserts.
 *    O upsert do PostgREST só toca as colunas presentes no payload. Se um único upsert
 *    levasse `pro: proSet.has(slug)` pra TODO módulo incluído, cada slug fora do
 *    `pro_modules` gravaria `false` explícito e **apagaria um PRO ligado à mão no god
 *    mode**. Hoje existem 2 linhas assim em produção (`ai` e `instagram_automation`, no
 *    Blue) e elas escapam só porque o Starter não cita esses slugs — bastaria alguém
 *    incluir um deles no plano pra a próxima atribuição derrubar o PRO manual.
 *    Separando, o ramo "sem PRO" **omite a coluna** e a decisão manual sobrevive — a mesma
 *    filosofia aditiva que o `enabled` já tinha, agora estendida ao `pro`.
 *
 * ⚠️ Enquanto `tenant_modules.source` não existir (vem na reestruturação do catálogo),
 *    "veio do plano" e "foi ligado à mão" são indistinguíveis. Este aditivo é o
 *    comportamento seguro no meio-tempo: concede, nunca revoga.
 */
export async function applyPlan(tenantId: string, planId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: plan } = await supabaseAdmin
    .from("plans")
    .select("name, included_modules, pro_modules")
    .eq("id", planId)
    .maybeSingle()
  if (!plan) return { ok: false, error: "Plano não encontrado." }

  await supabaseAdmin
    .from("tenants")
    .update({ plan_id: planId, plan: tierFromName(plan.name as string) })
    .eq("id", tenantId)

  const mods = ((plan.included_modules as string[] | null) ?? []).filter(Boolean)
  if (mods.length > 0) {
    // Poda pelo incluído: PRO de um módulo que o plano não inclui não faz sentido.
    // ⚠️ CORRIGIDO 2026-08-03 — este comentário dizia "(CHECK no banco)" e era FALSO.
    //    O CHECK `plans_pro_subset_included` existe no PLANO (migration
    //    20260803_plans_pro_modules.sql), **não** em `tenant_modules`: lá não há
    //    constraint nenhuma impedindo `pro=true, enabled=false`. Quem sustenta a
    //    invariante do vínculo é `hasModulePro` na LEITURA (modules.ts) — ele exige
    //    `hasModule` antes e filtra `enabled=true`, fail-closed. Na prática está coberto
    //    (o read é chokepoint único), mas é garantia de CÓDIGO, não de banco. Quem
    //    escrever em `tenant_modules` por fora precisa manter a invariante na mão.
    const proSet = new Set(((plan.pro_modules as string[] | null) ?? []).filter((s) => s && mods.includes(s)))
    const comuns = mods.filter((s) => !proSet.has(s))

    if (comuns.length > 0) {
      await supabaseAdmin.from("tenant_modules").upsert(
        // ⚠️ SEM a chave `pro` — omitir é o que preserva o que já está lá.
        comuns.map((slug) => ({ tenant_id: tenantId, module_slug: slug, enabled: true, reason: "Incluído no plano" })),
        { onConflict: "tenant_id,module_slug" },
      )
    }
    if (proSet.size > 0) {
      await supabaseAdmin.from("tenant_modules").upsert(
        Array.from(proSet).map((slug) => ({ tenant_id: tenantId, module_slug: slug, enabled: true, pro: true, reason: "Incluído no plano (PRO)" })),
        { onConflict: "tenant_id,module_slug" },
      )
    }
  } else {
    // Plano sem módulos definidos → core + default-on (não deixa o tenant pelado).
    await applyDefaultModules(tenantId)
  }
  return { ok: true }
}
