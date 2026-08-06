import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { applyDefaultModules } from "@/lib/modules"

/**
 * O plano que o cadastro self-serve entrega — **fonte única da escolha**.
 *
 * 🔑 QUEM MANDA É O GOD MODE. Não há plano "de cadastro" hardcoded: a regra é *o plano
 *    ativo, com teste, de menor posição*. Mudou o plano lá, muda aqui — inclusive a
 *    duração que a tela de cadastro promete.
 *
 * 🔴 POR QUE VIROU FUNÇÃO (2026-08-04). O mesmo `select` estava escrito em DOIS lugares:
 *    em `startSignup` (que ATRIBUI o plano) e na página de cadastro (que ANUNCIA o prazo).
 *    Enquanto os critérios batem, ninguém percebe; no dia em que um dos dois for ajustado,
 *    a tela passa a prometer o teste de um plano e a conta a receber o de outro — e a
 *    divergência só aparece pro cliente, no 6º dia, quando o acesso cai antes do prometido.
 *    Foi exatamente assim que a tela chegou a dizer "3 dias" com o plano dando 5.
 */
export async function getSignupTrialPlan(): Promise<{ id: string; trial_days: number } | null> {
  // 🔴 DESEMPATE OBRIGATÓRIO. Medido em prod (2026-08-04): **Starter e Trial estão os dois
  //    em `position = 0`**. Hoje o empate não morde porque o Starter tem `trial_days = 0` e
  //    o filtro o descarta — mas no dia em que alguém der teste ao Starter pelo god mode,
  //    `ORDER BY position LIMIT 1` passa a devolver **qualquer um dos dois**, e nada garante
  //    que a tela (que anuncia) e a action (que atribui) recebam o mesmo. O cliente leria
  //    "5 dias grátis" e a conta nasceria no plano de R$ 449,90 — ou o contrário.
  //    `price_cents` como 2º critério não é só desempate: entre dois planos com teste, o
  //    cadastro self-serve deve entregar o mais barato. `id` fecha como último recurso,
  //    porque dois planos podem ter o mesmo preço.
  const { data } = await supabaseAdmin
    .from("plans")
    .select("id, trial_days")
    .gt("trial_days", 0)
    .eq("active", true)
    .order("position",    { ascending: true })
    .order("price_cents", { ascending: true })
    .order("id",          { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as { id: string; trial_days: number } | null) ?? null
}

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
  const doNovo = new Set(mods)
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

  // ══════════════════════════════════════════════════════════════════════════
  // 🔴 REVOGAÇÃO — o que veio DE PLANO e o plano atual não dá (05/08/2026)
  // ══════════════════════════════════════════════════════════════════════════
  // Até hoje esta função era uma CATRACA DE UM SENTIDO SÓ: só ligava módulo, nunca
  // desligava. Com os números reais do catálogo isso virava vazamento garantido:
  //
  //     Trial     R$   0,00 → 16 módulos
  //     PLANO I   R$  99,90 →  4 módulos
  //     PLANO II  R$ 149,90 →  7 módulos
  //
  // Quem testava e assinava o plano mais barato ficava com os 16 pra sempre.
  //
  // 🔴 A 1ª VERSÃO DESTA CORREÇÃO NASCEU MORTA (achado dos dois revisores, 06/08).
  //    Ela comparava `tenants.plan_id` ANTES × plano novo — mas `createSubscriptionForTenant`
  //    **já grava o `plan_id` novo** ao criar a assinatura, e o webhook relê essa mesma
  //    coluna pra chamar esta função. Então "anterior" e "novo" chegavam IGUAIS e o bloco
  //    era pulado **sempre**, justamente no único caminho que o cliente percorre. Só
  //    funcionava pelo god mode. Duas correções minhas do mesmo dia se anulando.
  //
  // 🔑 A REGRA AGORA É DE PROCEDÊNCIA, não de comparação: revoga o que ESTA função
  //    concedeu (`reason` = "Incluído no plano%") e o plano atual não inclui. Não depende
  //    de ordem de escrita, não depende de saber qual era o plano antigo, e sobrevive à
  //    corrida entre o webhook e o update da assinatura.
  // ⚠️ O que foi ligado À MÃO fica intocado — reason próprio ("Piloto CRM Negócios",
  //    "Backfill inicial", null). Conferido em produção: os rótulos são distintos.
  //    É a regra que o dono definiu: *"é desativação, não precisa deletar nada"*.
  // ⚠️ Plano SEM lista de módulos não revoga nada: ali `applyDefaultModules` acabou de
  //    ligar o core, e revogar contra uma lista vazia apagaria o que a linha de cima ligou.
  if (mods.length > 0) {
    const { data: ligados } = await supabaseAdmin
      .from("tenant_modules")
      .select("module_slug, reason")
      .eq("tenant_id", tenantId)
      .eq("enabled", true)

    const revogar = ((ligados ?? []) as { module_slug: string; reason: string | null }[])
      .filter((m) => (m.reason ?? "").startsWith("Incluído no plano"))
      .map((m) => m.module_slug)
      .filter((slug) => !doNovo.has(slug))

    if (revogar.length > 0) {
      const { error } = await supabaseAdmin
        .from("tenant_modules")
        .update({ enabled: false, pro: false, reason: "Não incluído no plano atual" })
        .eq("tenant_id", tenantId)
        .in("module_slug", revogar)

      // ⚠️ Best-effort com log ALTO: falhar deixa módulo a mais (seguro pro cliente), mas
      //    é receita saindo — tem que aparecer.
      if (error) {
        console.error(JSON.stringify({
          src: "plans", kind: "revogacao-falhou", tenant: tenantId, plano: planId,
          modulos: revogar, msg: error.message,
        }))
      } else {
        console.log(JSON.stringify({
          src: "plans", kind: "modulos-revogados", tenant: tenantId, plano: planId, modulos: revogar,
        }))
      }
    }
  }

  return { ok: true }
}
