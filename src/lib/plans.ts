import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

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

/**
 * Encaixa um plano num tenant (fonte: tabela `plans`).
 *
 *  • Aponta somente `tenant.plan_id`, a identidade canônica. O nome comercial do plano
 *    nunca é convertido em tier e a string legada `tenant.plan` não participa.
 *  • Reconcilia os módulos `source=plan` e MANTÉM todos os extras `source=manual`.
 *  • CONCEDE o nível PRO nos módulos que o plano marca como PRO (`plans.pro_modules`).
 *  • Os LIMITES NÃO são copiados: resolvem AO VIVO de `plans.limits` (ver limits.ts).
 *
 * Usado no signup (plano Trial), no god mode (trocar plano) e, no futuro, no
 * checkout (upgrade self-service).
 *
 * Tudo ocorre na RPC sob row lock: troca de plano, módulos comuns/PRO e revogação de
 * concessões antigas formam uma única transação. Plano vazio significa core-only.
 */
export interface ApplyPlanGuard {
  expectedBillingMode?: "gateway" | "manual"
  expectedCustomerId?: string | null
  expectedSubscriptionId?: string | null
  expectedSubscriptionStatus?: string | null
  expectedSubscriptionEndsAt?: string | null
  expectedLifecycleState?: string | null
  expectedTrialEndsAt?: string | null
  expectedPastDueSince?: string | null
  expectedPastDueReason?: string | null
  expectedActive?: boolean | null
  expectedCurrentPlanId?: string | null
  requireCurrentPlan?: boolean
}

export async function applyPlan(
  tenantId: string,
  planId: string,
  guard: ApplyPlanGuard = {},
): Promise<{ ok: boolean; error?: string }> {
  const checkCustomer = Object.prototype.hasOwnProperty.call(guard, "expectedCustomerId")
  const checkSubscription = Object.prototype.hasOwnProperty.call(guard, "expectedSubscriptionId")
  const checkStatus = Object.prototype.hasOwnProperty.call(guard, "expectedSubscriptionStatus")
  const checkSubscriptionEnds = Object.prototype.hasOwnProperty.call(guard, "expectedSubscriptionEndsAt")
  const checkLifecycle = Object.prototype.hasOwnProperty.call(guard, "expectedLifecycleState")
  const checkTrialEnds = Object.prototype.hasOwnProperty.call(guard, "expectedTrialEndsAt")
  const checkPastDueSince = Object.prototype.hasOwnProperty.call(guard, "expectedPastDueSince")
  const checkPastDueReason = Object.prototype.hasOwnProperty.call(guard, "expectedPastDueReason")
  const checkActive = Object.prototype.hasOwnProperty.call(guard, "expectedActive")
  const checkCurrentPlan = Object.prototype.hasOwnProperty.call(guard, "expectedCurrentPlanId")

  const { data, error } = await supabaseAdmin.rpc("aplicar_plano_atomico", {
    p_tenant: tenantId,
    p_plan: planId,
    p_expected_billing_mode: guard.expectedBillingMode ?? null,
    p_check_customer: checkCustomer,
    p_expected_customer: guard.expectedCustomerId ?? null,
    p_check_subscription: checkSubscription,
    p_expected_subscription: guard.expectedSubscriptionId ?? null,
    p_check_status: checkStatus,
    p_expected_status: guard.expectedSubscriptionStatus ?? null,
    p_check_subscription_ends: checkSubscriptionEnds,
    p_expected_subscription_ends: guard.expectedSubscriptionEndsAt ?? null,
    p_check_lifecycle: checkLifecycle,
    p_expected_lifecycle: guard.expectedLifecycleState ?? null,
    p_check_trial_ends: checkTrialEnds,
    p_expected_trial_ends: guard.expectedTrialEndsAt ?? null,
    p_check_past_due_since: checkPastDueSince,
    p_expected_past_due_since: guard.expectedPastDueSince ?? null,
    p_check_past_due_reason: checkPastDueReason,
    p_expected_past_due_reason: guard.expectedPastDueReason ?? null,
    p_check_active: checkActive,
    p_expected_active: guard.expectedActive ?? null,
    p_check_current_plan: checkCurrentPlan,
    p_expected_current_plan: guard.expectedCurrentPlanId ?? null,
    p_require_current_plan: guard.requireCurrentPlan === true,
  })

  if (error) {
    console.error(JSON.stringify({ src: "plans", kind: "apply-plan-atomico-falhou", tenant: tenantId, plano: planId, msg: error.message }))
    return { ok: false, error: "Não foi possível aplicar o plano." }
  }

  const raw = Array.isArray(data) ? data[0] : data
  const result = raw as { aplicado?: boolean; motivo?: string | null } | null
  if (!result?.aplicado) {
    return { ok: false, error: result?.motivo ?? "O estado da conta mudou durante a aplicação do plano." }
  }
  return { ok: true }
}

export async function removePlan(
  tenantId: string,
  expectedPlanId: string | null,
): Promise<{ ok: boolean; previousPlanId?: string | null; error?: string }> {
  if (!tenantId) return { ok: false, error: "Cliente inválido." }

  const { data, error } = await supabaseAdmin.rpc("remover_plano_atomico", {
    p_tenant: tenantId,
    p_expected_plan: expectedPlanId,
  })
  if (error) {
    console.error(JSON.stringify({
      src: "plans", kind: "remove-plan-atomico-falhou",
      tenant: tenantId, planoEsperado: expectedPlanId, msg: error.message,
    }))
    return { ok: false, error: "Não foi possível remover o plano." }
  }

  const raw = Array.isArray(data) ? data[0] : data
  const result = raw as {
    aplicado?: boolean
    motivo?: string | null
    plan_id_anterior?: string | null
  } | null
  if (!result?.aplicado) {
    return { ok: false, error: result?.motivo ?? "O plano mudou durante a remoção." }
  }
  return {
    ok: true,
    previousPlanId: typeof result.plan_id_anterior === "string" ? result.plan_id_anterior : null,
  }
}
