// Contrato estático da aplicação atômica de plano.
//
// Não executa SQL nem abre conexão. O objetivo é impedir que uma edição local reduza a
// fotografia CAS do webhook, reabra a RPC para o browser ou recrie writers TypeScript
// parciais de plano/módulos.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20260821000200_billing_apply_plan_atomic.sql",
), "utf8")
const sourceFoundation = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20260821000100_tenant_modules_source_foundation.sql",
), "utf8")
const plansSource = readFileSync(resolve(process.cwd(), "src/lib/plans.ts"), "utf8")
const webhookSource = readFileSync(resolve(process.cwd(), "src/lib/asaas/webhook-handler.ts"), "utf8")
const adminPlansSource = readFileSync(resolve(process.cwd(), "src/lib/actions/admin-plans.ts"), "utf8")
const modulesAdminSource = readFileSync(resolve(process.cwd(), "src/lib/actions/modules-admin.ts"), "utf8")

function semComentarios(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "")
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function functionIdentity(functionName: string): string {
  const match = migration.match(new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${functionName}\\(([\\s\\S]*?)\\)\\s*RETURNS`,
    "i",
  ))
  if (!match) throw new Error(`Função ${functionName} não encontrada`)

  return match[1]
    .split(",")
    .map((parameter) => parameter.trim().split(/\s+/)[1])
    .join(",")
}

const sql = compact(semComentarios(migration))
const sourceSql = compact(semComentarios(sourceFoundation))
const inicioFuncao = sql.indexOf("AS $fn$")
const fimFuncao = sql.indexOf("END $fn$;", inicioFuncao)
const corpo = sql.slice(inicioFuncao, fimFuncao)
const inicioRemocao = sql.indexOf("AS $remove_fn$")
const fimRemocao = sql.indexOf("END $remove_fn$;", inicioRemocao)
const corpoRemocao = sql.slice(inicioRemocao, fimRemocao)

const inicioApplyPlan = plansSource.indexOf("export async function applyPlan(")
const corpoApplyPlan = plansSource.slice(inicioApplyPlan)

function statementContaining(fragmento: string): string {
  const ponto = corpo.indexOf(fragmento)
  const inicio = corpo.lastIndexOf("INSERT INTO public.tenant_modules", ponto)
  const fim = corpo.indexOf(";", ponto)
  return inicio >= 0 && fim > inicio ? corpo.slice(inicio, fim + 1) : ""
}

describe("F7a migration · parede de privilégios", () => {
  it("usa a identidade completa declarada da RPC em owner, ACL e postcheck", () => {
    const identity = functionIdentity("aplicar_plano_atomico")
    const regprocedureIdentity = identity.replaceAll("timestamptz", "timestamp with time zone")
    const identityPattern = identity.split(",").join("\\s*,\\s*")

    expect(sql).toMatch(new RegExp(
      `ALTER FUNCTION public\\.aplicar_plano_atomico\\(\\s*${identityPattern}\\s*\\) OWNER TO postgres;`,
      "i",
    ))
    expect(sql).toMatch(new RegExp(
      `REVOKE ALL ON FUNCTION public\\.aplicar_plano_atomico\\(\\s*${identityPattern}\\s*\\) FROM PUBLIC, anon, authenticated;`,
      "i",
    ))
    expect(sql).toMatch(new RegExp(
      `GRANT EXECUTE ON FUNCTION public\\.aplicar_plano_atomico\\(\\s*${identityPattern}\\s*\\) TO service_role;`,
      "i",
    ))
    expect(sql).toContain(
      `'public.aplicar_plano_atomico(${regprocedureIdentity})'::regprocedure`,
    )
  })

  it("é transacional, SECURITY DEFINER com search_path vazio e owner explícito", () => {
    expect(sql).toMatch(/^BEGIN;/i)
    expect(sql).toMatch(/LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''/i)
    expect(sql).toMatch(
      /ALTER FUNCTION public\.aplicar_plano_atomico\([\s\S]*?\) OWNER TO postgres;/i,
    )
    expect(sql).toMatch(/COMMIT;$/i)
    expect(sql).toMatch(/ALTER FUNCTION public\.remover_plano_atomico\(uuid,uuid\) OWNER TO postgres;/i)
    expect(sql).toMatch(/ALTER FUNCTION public\.atualizar_plano_atomico\([\s\S]*?\) OWNER TO postgres;/i)
  })

  it("mantém a identidade exata das três RPCs em CREATE, OWNER, REVOKE e GRANT", () => {
    const identities = {
      aplicar_plano_atomico:
        "uuid,uuid,text,boolean,text,boolean,text,boolean,text,boolean,timestamptz,boolean,text,boolean,timestamptz,boolean,timestamptz,boolean,text,boolean,boolean,boolean,uuid,boolean",
      remover_plano_atomico: "uuid,uuid",
      atualizar_plano_atomico:
        "uuid,text,text,integer,integer,integer,text[],text[],jsonb,integer,text,boolean,timestamptz",
    } as const

    for (const [name, expectedIdentity] of Object.entries(identities)) {
      expect(functionIdentity(name), `CREATE de ${name}`).toBe(expectedIdentity)
      const identityPattern = expectedIdentity.split(",").map(escapeRegExp).join("\\s*,\\s*")
      expect(sql).toMatch(new RegExp(
        `ALTER FUNCTION public\\.${name}\\(\\s*${identityPattern}\\s*\\) OWNER TO postgres;`,
        "i",
      ))
      expect(sql).toMatch(new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}\\(\\s*${identityPattern}\\s*\\) FROM PUBLIC, anon, authenticated;`,
        "i",
      ))
      expect(sql).toMatch(new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${name}\\(\\s*${identityPattern}\\s*\\) TO service_role;`,
        "i",
      ))
    }
  })

  it("revoga browser e concede execução somente ao service_role", () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.aplicar_plano_atomico\([\s\S]*?\) FROM PUBLIC, anon, authenticated;/i,
    )
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.aplicar_plano_atomico\([\s\S]*?\) TO service_role;/i,
    )
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.aplicar_plano_atomico\([\s\S]*?\) TO (?:PUBLIC|anon|authenticated)/i,
    )
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.remover_plano_atomico\(uuid,uuid\) FROM PUBLIC, anon, authenticated;/i,
    )
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.remover_plano_atomico\(uuid,uuid\) TO service_role;/i,
    )
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.atualizar_plano_atomico\([\s\S]*?\) FROM PUBLIC, anon, authenticated;/i,
    )
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.atualizar_plano_atomico\([\s\S]*?\) TO service_role;/i,
    )
  })
})

describe("F7a remoção · plan_id e revogação na mesma transação", () => {
  it("trava tenant, valida fotografia e só depois remove", () => {
    const lock = corpoRemocao.indexOf("SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant FOR UPDATE;")
    const cas = corpoRemocao.indexOf("v_tenant.plan_id IS DISTINCT FROM p_expected_plan")
    const update = corpoRemocao.indexOf("UPDATE public.tenants SET plan_id = NULL WHERE id = p_tenant;")
    expect(lock).toBeGreaterThan(-1)
    expect(cas).toBeGreaterThan(lock)
    expect(update).toBeGreaterThan(cas)
  })

  it("desabilita exclusivamente plan-owned; manual e acesso core permanecem", () => {
    expect(corpoRemocao).toMatch(/UPDATE public\.tenant_modules SET enabled = false,[\s\S]*?WHERE tenant_id = p_tenant[\s\S]*?source = 'plan';/i)
    expect(corpoRemocao).not.toMatch(/source\s*=\s*'manual'/i)
    expect(corpoRemocao).not.toMatch(/DELETE FROM public\.tenant_modules/i)
    expect(corpoRemocao).not.toMatch(/UPDATE public\.module_catalog/i)
  })
})

describe("F7a migration · uma transação por tenant", () => {
  it("trava o plano antes do tenant e ambos antes de qualquer mutação", () => {
    const planLock = corpo.indexOf("SELECT * INTO v_plan FROM public.plans WHERE id = p_plan FOR SHARE;")
    const tenantLock = corpo.indexOf("SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant FOR UPDATE;")
    const mutacoes = ["UPDATE public.", "INSERT INTO public.", "DELETE FROM public."]
      .map((token) => corpo.indexOf(token))
      .filter((index) => index >= 0)
    const primeiraMutacao = Math.min(...mutacoes)

    expect(planLock).toBeGreaterThan(-1)
    expect(tenantLock).toBeGreaterThan(planLock)
    expect(primeiraMutacao).toBeGreaterThan(tenantLock)
  })

  it("recusa catálogo inválido sem normalizar arrays ou limites em silêncio", () => {
    expect(corpo).toContain("v_included := v_plan.included_modules;")
    expect(corpo).toContain("v_pro := v_plan.pro_modules;")
    expect(corpo).not.toMatch(/array_agg/i)
    expect(corpo).toMatch(/cardinality\(v_plan\.included_modules\)[\s\S]*?count\(DISTINCT u\.slug\)/i)
    expect(corpo).toMatch(/NOT \(v_plan\.pro_modules <@ v_plan\.included_modules\)/i)
    expect(corpo).toMatch(/LEFT JOIN public\.module_catalog mc ON mc\.slug = u\.slug/i)
    expect(corpo).toMatch(/jsonb_each\(v_plan\.limits\)/i)
    expect(corpo).toMatch(/reconciliacao recusada/i)
  })

  it("valida toda a fotografia CAS do webhook antes do primeiro UPDATE", () => {
    const primeiroUpdate = corpo.indexOf("UPDATE public.")
    expect(primeiroUpdate).toBeGreaterThan(-1)
    const antesDoUpdate = corpo.slice(0, primeiroUpdate)

    // Mesma fotografia usada pelo UPDATE final de `liberar`: se qualquer um destes eixos
    // mudar entre a baixa/CAS e a RPC, o plano antigo não pode pousar sobre o estado novo.
    const camposDaFotografia = [
      "billing_mode",
      "asaas_customer_id",
      "asaas_subscription_id",
      "subscription_ends_at",
      "plan_id",
      "subscription_status",
      "lifecycle_state",
      "trial_ends_at",
      "past_due_since",
      "past_due_reason",
      "active",
    ]

    const ausentes = camposDaFotografia.filter((campo) =>
      !new RegExp(`v_tenant\\.${campo}\\s+IS DISTINCT FROM`, "i").test(antesDoUpdate))
    expect(ausentes, "guardas ausentes ou tardias na RPC").toEqual([])
  })

  it("grava plano e módulos dentro da mesma função", () => {
    expect(corpo).toMatch(/UPDATE public\.tenants SET plan_id = p_plan WHERE id = p_tenant;/i)
    expect(corpo).toMatch(/INSERT INTO public\.tenant_modules/i)
    expect(corpo).toMatch(/UPDATE public\.tenant_modules/i)
  })

  it("usa plan_id como identidade única e nunca deriva acesso do nome comercial", () => {
    expect(corpo).not.toMatch(/v_plan\.name/i)
    expect(corpo).not.toMatch(/\bSET\s+plan\s*=/i)
    expect(corpo).not.toMatch(/\bv_tier\b/i)
    expect(corpo).not.toMatch(/ELSE\s+'pro'/i)
  })
})

describe("F7a consumer · RPC é o único writer de applyPlan", () => {
  it("applyPlan chama somente a RPC e não escreve tenants/tenant_modules em TypeScript", () => {
    expect(inicioApplyPlan).toBeGreaterThan(-1)
    expect(corpoApplyPlan).toContain('supabaseAdmin.rpc("aplicar_plano_atomico"')
    expect(corpoApplyPlan).not.toMatch(/\.from\(["']tenants["']\)/)
    expect(corpoApplyPlan).not.toMatch(/\.from\(["']tenant_modules["']\)/)
    expect(corpoApplyPlan).not.toMatch(/\.(?:update|upsert|insert|delete)\s*\(/)
  })

  it("removePlan usa a RPC e assignPlanToTenant não fragmenta tenants/módulos", () => {
    const inicioWrapper = plansSource.indexOf("export async function removePlan(")
    const wrapper = plansSource.slice(inicioWrapper)
    const inicioAction = adminPlansSource.indexOf("export async function assignPlanToTenant(")
    const action = adminPlansSource.slice(inicioAction)

    expect(inicioWrapper).toBeGreaterThan(-1)
    expect(wrapper).toContain('supabaseAdmin.rpc("remover_plano_atomico"')
    expect(wrapper).not.toMatch(/\.from\(["'](?:tenants|tenant_modules)["']\)/)
    expect(action).toContain("if (planId === null)")
    expect(action).toContain("await removePlan(tenantId, planoAnterior)")
    expect(action).not.toMatch(/\.from\(["']tenant_modules["']\)/)
    expect(action).not.toMatch(/\.from\(["']tenants["']\)\.update/)
  })

  it("wrapper e webhook transportam todos os eixos da fotografia", () => {
    const propriedades = [
      "expectedBillingMode",
      "expectedCustomerId",
      "expectedSubscriptionId",
      "expectedSubscriptionEndsAt",
      "requireCurrentPlan",
      "expectedSubscriptionStatus",
      "expectedLifecycleState",
      "expectedTrialEndsAt",
      "expectedPastDueSince",
      "expectedPastDueReason",
      "expectedActive",
    ]

    const ausentesNoWrapper = propriedades.filter((propriedade) => !plansSource.includes(propriedade))
    const ausentesNoWebhook = propriedades.filter((propriedade) => !webhookSource.includes(propriedade))
    expect({ wrapper: ausentesNoWrapper, webhook: ausentesNoWebhook }, "eixos CAS não transportados").toEqual({
      wrapper: [],
      webhook: [],
    })
  })
})

describe("F7a entitlements · proveniência é autoridade", () => {
  const upsertComum = statementContaining("'Incluído no plano'")
  const upsertPro = statementContaining("'Incluído no plano (PRO)'")
  const inicioRevogacao = corpo.lastIndexOf("UPDATE public.tenant_modules")
  const fimRevogacao = corpo.indexOf(";", inicioRevogacao)
  const revogacao = inicioRevogacao >= 0 && fimRevogacao > inicioRevogacao
    ? corpo.slice(inicioRevogacao, fimRevogacao + 1)
    : ""

  it("marca concessões novas como source=plan", () => {
    expect(upsertComum).toMatch(
      /INSERT INTO public\.tenant_modules(?: AS [a-z_][a-z0-9_]*)? \([^)]*source[^)]*\)[\s\S]*?SELECT [\s\S]*?'plan'/i,
    )
    expect(upsertPro).toMatch(
      /INSERT INTO public\.tenant_modules(?: AS [a-z_][a-z0-9_]*)? \([^)]*source[^)]*\)[\s\S]*?SELECT [\s\S]*?'plan'/i,
    )
  })

  it("conflito plan-owned normaliza PRO, expiração e autoria", () => {
    expect(upsertComum).toMatch(/ON CONFLICT \(tenant_id, module_slug\) DO UPDATE/i)
    expect(upsertComum).toMatch(/\bpro\s*=\s*false/i)
    expect(upsertComum).toMatch(/\bexpires_at\s*=\s*NULL/i)
    expect(upsertComum).toMatch(/\bset_by\s*=\s*NULL/i)

    expect(upsertPro).toMatch(/ON CONFLICT \(tenant_id, module_slug\) DO UPDATE/i)
    expect(upsertPro).toMatch(/\bpro\s*=\s*true/i)
    expect(upsertPro).toMatch(/\bexpires_at\s*=\s*NULL/i)
    expect(upsertPro).toMatch(/\bset_by\s*=\s*NULL/i)
  })

  it("upserts do plano nunca sobrescrevem uma linha source=manual", () => {
    const somentePlanOwned = /DO UPDATE[\s\S]*?WHERE (?:(?:public\.)?tenant_modules|tm)\.source\s*=\s*'plan'/i
    expect(upsertComum).toMatch(somentePlanOwned)
    expect(upsertPro).toMatch(somentePlanOwned)
    expect(upsertComum).not.toMatch(/source\s*=\s*'manual'/i)
    expect(upsertPro).not.toMatch(/source\s*=\s*'manual'/i)
  })

  it("revoga exclusivamente source=plan e não infere proveniência por reason", () => {
    expect(revogacao).toMatch(/\bsource\s*=\s*'plan'/i)
    expect(revogacao).not.toMatch(/\breason\b[\s\S]*?\bLIKE\b/i)
  })

  it("plano sem módulos é core-only: revoga plan-owned e nunca concede default_on", () => {
    expect(corpo).not.toMatch(/\bdefault_on\b/i)
    expect(corpo).not.toMatch(/mc\.default_on/i)
    expect(revogacao).toMatch(/source\s*=\s*'plan'/i)
    expect(revogacao).toMatch(/NOT \(module_slug = ANY\(v_included\)\)/i)
    expect(revogacao).not.toMatch(/source\s*=\s*'manual'/i)
  })
})

describe("F7a consumer · override administrativo permanece manual", () => {
  const inicio = modulesAdminSource.indexOf("export async function setTenantModule(")
  const proximaAction = modulesAdminSource.indexOf("export async function ", inicio + 1)
  const fim = proximaAction > inicio ? proximaAction : modulesAdminSource.length
  const corpoSetTenantModule = modulesAdminSource.slice(inicio, fim)

  it("falha fechado se não conseguir fotografar o estado anterior", () => {
    const leitura = corpoSetTenantModule.indexOf("error: beforeError")
    const guarda = corpoSetTenantModule.indexOf("if (beforeError)")
    const upsert = corpoSetTenantModule.indexOf(".upsert({")

    expect(leitura).toBeGreaterThan(-1)
    expect(guarda).toBeGreaterThan(leitura)
    expect(upsert).toBeGreaterThan(guarda)
    expect(corpoSetTenantModule.slice(guarda, upsert)).toMatch(/return \{ error:/i)
  })

  it("setTenantModule grava source=manual no mesmo upsert", () => {
    expect(inicio).toBeGreaterThan(-1)
    expect(fim).toBeGreaterThan(inicio)
    expect(corpoSetTenantModule).toMatch(
      /\.from\(["']tenant_modules["']\)[\s\S]*?\.upsert\(\{[\s\S]*?\bsource:\s*["']manual["']/,
    )
  })

  it("auditoria carrega a procedência anterior e registra a nova como manual", () => {
    expect(corpoSetTenantModule).toMatch(
      /\.select\(["'][^"']*\bsource\b[^"']*["']\)[\s\S]*?\.maybeSingle\(\)/,
    )
    const inicioAudit = corpoSetTenantModule.indexOf("await logAudit({")
    const audit = corpoSetTenantModule.slice(inicioAudit)
    expect(inicioAudit).toBeGreaterThan(-1)
    expect(audit).toMatch(/\bbefore:/)
    expect(audit).toMatch(/\bafter:\s*\{[\s\S]*?\bsource:\s*["']manual["']/)
  })
})

describe("F7a catálogo · edição e materialização são uma transação", () => {
  const inicioUpdate = sql.indexOf("CREATE OR REPLACE FUNCTION public.atualizar_plano_atomico")
  const fimUpdate = sql.indexOf("END $update_plan_fn$;", inicioUpdate)
  const updateRpc = sql.slice(inicioUpdate, fimUpdate)
  const inicioAction = adminPlansSource.indexOf("export async function updatePlan(")
  const fimAction = adminPlansSource.indexOf("export async function deletePlan(", inicioAction)
  const updateAction = adminPlansSource.slice(inicioAction, fimAction)

  it("trava o catálogo e reaplica tenants em ordem estável quando módulos mudam", () => {
    const lockPlan = updateRpc.indexOf("FROM public.plans WHERE id = p_plan FOR UPDATE;")
    const updatePlan = updateRpc.indexOf("UPDATE public.plans")
    const tenantLoop = updateRpc.indexOf("FROM public.tenants t WHERE t.plan_id = p_plan ORDER BY t.id FOR UPDATE")
    expect(inicioUpdate).toBeGreaterThan(-1)
    expect(lockPlan).toBeGreaterThan(-1)
    expect(updatePlan).toBeGreaterThan(lockPlan)
    expect(tenantLoop).toBeGreaterThan(updatePlan)
    // Ordem global de lock: catálogo primeiro, tenants depois. A atribuição usa o mesmo
    // começo (FOR SHARE no plano), impedindo arrays antigos e ciclos de deadlock.
    expect(tenantLoop).toBeGreaterThan(lockPlan)
    expect(updateRpc.slice(0, lockPlan)).not.toMatch(/FROM public\.tenants[^;]*FOR UPDATE/i)
    expect(updateRpc).toContain("FROM public.aplicar_plano_atomico(")
    expect(updateRpc).toContain("p_check_current_plan => true")
    expect(updateRpc).toContain("p_expected_current_plan => p_plan")
    expect(updateRpc).toMatch(/v_plan\.updated_at IS DISTINCT FROM p_expected_updated_at/i)
  })

  it("recusa payload de catálogo inválido sem sanitização silenciosa", () => {
    expect(updateRpc).toContain("v_included := p_included_modules;")
    expect(updateRpc).toContain("v_pro := p_pro_modules;")
    expect(updateRpc).not.toMatch(/array_agg/i)
    expect(updateRpc).toMatch(/cardinality\(p_included_modules\)[\s\S]*?count\(DISTINCT u\.slug\)/i)
    expect(updateRpc).toMatch(/NOT \(v_pro <@ v_included\)/i)
    expect(updateRpc).toMatch(/jsonb_each\(p_limits\)/i)
    expect(updateRpc).toMatch(/limites contem chave\/valor fora do contrato oficial/i)
  })

  it("updatePlan usa somente a RPC atômica para o catálogo", () => {
    expect(inicioAction).toBeGreaterThan(-1)
    expect(updateAction).toContain('supabaseAdmin.rpc("atualizar_plano_atomico"')
    expect(updateAction).toContain("p_expected_updated_at: antesRow.updated_at")
    expect(updateAction).not.toMatch(/\.from\(["']plans["']\)[\s\S]*?\.update\(/)
  })

  it("atribuição administrativa envia fotografia separada do plano anterior", () => {
    expect(plansSource).toContain("expectedCurrentPlanId?: string | null")
    expect(plansSource).toContain("p_check_current_plan: checkCurrentPlan")
    expect(plansSource).toContain("p_expected_current_plan: guard.expectedCurrentPlanId ?? null")
    expect(adminPlansSource).toContain("{ expectedCurrentPlanId: planoAnterior }")
  })
})

describe("F7 foundation · source aditivo e conservador", () => {
  it("é transacional, nasce manual e fecha o vocabulário", () => {
    expect(sourceSql).toMatch(/^BEGIN;/i)
    expect(sourceSql).toMatch(/ADD COLUMN IF NOT EXISTS source text;/i)
    expect(sourceSql).toMatch(/ALTER COLUMN source SET DEFAULT 'manual'/i)
    expect(sourceSql).toMatch(/ALTER COLUMN source SET NOT NULL/i)
    expect(sourceSql).toMatch(/CHECK \(source IN \('plan', 'manual'\)\)/i)
    expect(sourceSql).toMatch(/COMMIT;$/i)
  })

  it("só reconhece plan com as três provas legadas", () => {
    expect(sourceSql).toMatch(/tm\.reason = 'Incluído no plano'/i)
    expect(sourceSql).toMatch(/tm\.set_by IS NULL/i)
    expect(sourceSql).toMatch(/p\.included_modules @> ARRAY\[tm\.module_slug\]/i)
    expect(sourceSql).toMatch(/tm\.source = 'manual'/i)
  })

  it("reapply nunca reclassifica uma linha manual preexistente", () => {
    const snapshot = sourceSql.indexOf("AS source_preexisting")
    const addColumn = sourceSql.indexOf("ADD COLUMN IF NOT EXISTS source text")
    const normalizaNulos = sourceSql.match(
      /UPDATE public\.tenant_modules SET source = 'manual' WHERE source IS NULL[\s\S]*?;/i,
    )?.[0] ?? ""
    const backfill = sourceSql.match(
      /UPDATE public\.tenant_modules tm SET source = 'plan'[\s\S]*?;/i,
    )?.[0] ?? ""

    expect(snapshot).toBeGreaterThan(-1)
    expect(addColumn).toBeGreaterThan(snapshot)
    expect(normalizaNulos).toMatch(/NOT \( SELECT b\.source_preexisting FROM pg_temp\.tenant_modules_security_before b \)/i)
    expect(backfill).toMatch(/NOT \( SELECT b\.source_preexisting FROM pg_temp\.tenant_modules_security_before b \)/i)
  })

  it("preserva ACL/RLS e contém postcheck e rollback explícitos", () => {
    expect(sourceSql).toContain("tenant_modules_security_before")
    expect(sourceSql).toMatch(/c\.relacl IS DISTINCT FROM b\.relacl/i)
    expect(sourceSql).toMatch(/c\.relrowsecurity IS DISTINCT FROM b\.relrowsecurity/i)
    expect(sourceFoundation).toContain("DO $postcheck$")
    expect(sourceFoundation).toContain("-- Rollback")
    expect(sourceSql).not.toMatch(/(?:^|;)\s*(?:GRANT|REVOKE)\s+/i)
  })
})
