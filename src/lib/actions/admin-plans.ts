"use server"

import { auth } from "@/auth"
import { abaixoDoMinimoDoCartao } from "@/lib/billing/gateway-limits"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import { applyPlan, removePlan } from "@/lib/plans"
import { LIMIT_META, type LimitResource } from "@/lib/limits-shared"
import { logAudit } from "@/lib/audit"

const LIMIT_KEYS = Object.keys(LIMIT_META) as LimitResource[]

/** Sanitiza o jsonb de limites: só number≥0 ou null, por recurso conhecido. */
function cleanLimits(raw: unknown): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>
    for (const k of LIMIT_KEYS) {
      if (!(k in o)) continue
      const v = o[k]
      if (v === null) out[k] = null
      else if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = Math.round(v)
    }
  }
  return out
}

/**
 * CRUD de planos (god mode). Plano = nome + preço + cota de usuários +
 * preço por usuário adicional + módulos inclusos. Sem free/trial.
 */

async function requirePlatformAdmin() {
  const session = await auth()
  if (!session?.user?.isPlatformAdmin) throw new Error("Acesso restrito a platform admin")
  return session
}

// ═══════════════════════════════════════════════════════════════
// 🔴 O CATÁLOGO NÃO TINHA TRILHA (achado do mapeamento, 12/08)
// ═══════════════════════════════════════════════════════════════
// Este arquivo governa a ação de MAIOR alcance financeiro do produto e era o único módulo de
// cobrança sem uma linha de auditoria. `generateInvoiceForTenant` lê `plans` **ao vivo**
// (billing.ts) — então mudar `price_cents` aqui muda a próxima fatura de **todos os tenants
// daquele plano**, de uma vez. Um operador alterava o preço de N clientes e não sobrava
// registro de quem, quando, nem de qual valor para qual.
//
// 🔑 Contraria frontalmente a diretriz de 08/08 ("auditar TUDO é papel do sistema"), e a
//    justificativa "o operador confere no painel" já foi recusada lá: trilha ≠ conferência.
//
// ⚠️ `tenantId: null` de propósito nas ações de catálogo: o alvo é o PLANO, que é da
//    plataforma. Carimbar um tenant qualquer faria a trilha dele mentir sobre uma mudança
//    que não foi dele — mesma regra de `platform.settings_alterado`.
// ⚠️ Auditar é best-effort e vem DEPOIS da escrita: `logAudit` não lança (audit.ts), e
//    segurar a operação por causa do registro seria trocar um problema por outro maior.
async function auditarCatalogo(
  session: Awaited<ReturnType<typeof requirePlatformAdmin>>,
  acao: string,
  alvoId: string | null,
  antes: unknown,
  depois: unknown,
  tenantId: string | null = null,
): Promise<void> {
  await logAudit({
    tenantId,
    actorId:    session.user.id ?? null,
    actorEmail: session.user.email ?? null,
    action:     acao,
    targetType: tenantId ? "tenant" : "plan",
    targetId:   alvoId,
    before:     (antes as Record<string, unknown> | null) ?? null,
    after:      (depois as Record<string, unknown> | null) ?? null,
  })
}

export interface Plan {
  id:                     string
  name:                   string
  description:            string | null
  price_cents:            number
  user_quota:             number
  extra_user_price_cents: number
  included_modules:       string[]
  /** Quais dos `included_modules` vêm em nível PRO. INVARIANTE: subconjunto de
   *  `included_modules` — garantida por CHECK no banco, não só pela tela. */
  pro_modules:            string[]
  limits:                 Record<string, number | null>
  trial_days:             number   // 0 = sem validade (permanente); >0 = expira em N dias
  trial_activation_mode:  string   // "auto" | "manual"
  active:                 boolean
  position:               number
  created_at:             string
  updated_at:             string
}

export interface PlanInput {
  name:                   string
  description:            string | null
  price_cents:            number
  user_quota:             number
  extra_user_price_cents: number
  included_modules:       string[]
  pro_modules:            string[]
  limits:                 Record<string, number | null>
  trial_days:             number   // 0 = sem validade (permanente); >0 = expira em N dias
  trial_activation_mode:  string   // "auto" | "manual"
  active:                 boolean
}


function validatePlanName(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return "Dê um nome ao plano"
  const name = raw.trim()
  if (name.length > 120) return "O nome do plano pode ter no máximo 120 caracteres"
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(name)) {
    return "O nome do plano não pode conter controles ou quebras de linha"
  }
  return null
}

function validate(input: PlanInput): string | null {
  const nameError = validatePlanName(input?.name)
  if (nameError)                            return nameError
  if (input.price_cents < 0)               return "Preço inválido"
  // 🔑 Piso do GATEWAY, não nosso — fonte única em `billing/gateway-limits.ts`.
  //    Sem esta linha o god mode publica um plano que o cartão nunca consegue cobrar,
  //    e quem descobre é o cliente no fim do checkout (medido 05/08, plano a R$ 1,00).
  // ⚠️ O piso só vale pra plano ATIVO (correção 05/08). Sem esta condição, um plano legado
  //    salvo abaixo do mínimo ficava PRESO: o único caminho de arquivá-lo é este mesmo
  //    formulário, e a validação recusava salvar — ou seja, a guarda impedia de consertar
  //    exatamente o que ela existe pra evitar. Desativar tem que ser sempre possível.
  if (input.active && abaixoDoMinimoDoCartao(input.price_cents)) {
    return "O gateway não cobra menos de R$ 5,00 no cartão. Use R$ 0 para plano gratuito, ou R$ 5,00 ou mais."
  }
  if (input.user_quota < 1)                return "A cota de usuários precisa ser ao menos 1"
  if (input.extra_user_price_cents < 0)    return "Preço por usuário adicional inválido"
  if (input.trial_days < 0)                return "Dias de validade inválidos"
  if (!["auto", "manual"].includes(input.trial_activation_mode)) return "Modo de ativação inválido"
  return null
}

/**
 * Slugs que existem MESMO no catálogo.
 *
 * 🔴 POR QUE ISTO EXISTE (2026-08-05). O formulário do god mode reescreve
 *    `included_modules` inteiro a partir do estado do NAVEGADOR. Se um módulo for
 *    removido do catálogo enquanto a aba está aberta, o próximo "Salvar" **ressuscita o
 *    slug** — e ele volta como referência pendurada, sem nome, sem categoria e sem gate.
 *    Aconteceu ao vivo: `usage_limits` foi removido do catálogo e voltou 20 minutos depois,
 *    ao renomear o plano numa aba que estava aberta desde antes.
 * ⚠️ Poda em SILÊNCIO em vez de recusar o salvamento: o admin não errou nada — a aba
 *    dele é que envelheceu. Recusar faria ele perder a edição inteira por causa de um item
 *    que ele nem sabe que existia.
 */
async function slugsValidos(): Promise<Set<string>> {
  const { data } = await supabaseAdmin.from("module_catalog").select("slug")
  return new Set(((data ?? []) as { slug: string }[]).map((m) => m.slug))
}

async function clean(input: PlanInput) {
  const catalogo = await slugsValidos()
  const incluidos = Array.from(new Set(
    (input.included_modules ?? []).map((s) => s.trim()).filter((s) => s && catalogo.has(s)),
  ))
  return {
    name:                   input.name.trim(),
    description:            input.description?.trim() || null,
    price_cents:            Math.round(input.price_cents),
    user_quota:             Math.round(input.user_quota),
    extra_user_price_cents: Math.round(input.extra_user_price_cents),
    included_modules:       incluidos,
    // 🔴 PODA O PRO PELO INCLUÍDO, não confia na tela. "PRO sem o módulo" é estado sem
    //    sentido: religar o módulo devolveria o nível avançado sem ninguém decidir. O
    //    banco tem CHECK (`plans_pro_subset_included`), mas a action é quem transforma
    //    um payload torto em salvamento válido — em vez de erro 23514 na cara do admin.
    pro_modules:            Array.from(new Set((input.pro_modules ?? []).map((s) => s.trim()).filter((s) => s && incluidos.includes(s)))),
    limits:                 cleanLimits(input.limits),
    trial_days:             Math.max(0, Math.round(input.trial_days ?? 0)),
    trial_activation_mode:  input.trial_activation_mode === "auto" ? "auto" : "manual",
    active:                 input.active,
  }
}

export async function listPlans(): Promise<Plan[]> {
  await requirePlatformAdmin()
  const { data } = await supabaseAdmin
    .from("plans")
    .select("*")
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
  return (data ?? []) as Plan[]
}

export async function createPlan(input: PlanInput): Promise<{ error?: string; id?: string }> {
  const session = await requirePlatformAdmin()
  const err = validate(input)
  if (err) return { error: err }

  const { data, error } = await supabaseAdmin
    .from("plans")
    .insert({ ...(await clean(input)), updated_at: new Date().toISOString() })
    .select("id")
    .single()

  if (error) return { error: error.message }

  await auditarCatalogo(session, "platform.plano_criado", data.id, null, {
    name: input.name, price_cents: input.price_cents, user_quota: input.user_quota,
    extra_user_price_cents: input.extra_user_price_cents, active: input.active,
  })

  revalidatePath("/admin/planos")
  return { id: data.id }
}

/**
 * Duplica um plano existente.
 *
 * 🔑 Copia do BANCO, não da tela. A cópia sai do estado gravado — se ela viesse do
 *    formulário aberto, herdaria edições não salvas e o admin teria dois planos diferentes
 *    achando que tem dois iguais.
 *
 * 🔴 A cópia nasce **INATIVA**, sempre. Plano ativo aparece na vitrine do cliente no
 *    mesmo instante (`listPlansForClient` filtra por `active`) — duplicar pra ajustar o
 *    preço depois publicaria, por alguns minutos, uma oferta pela metade. Fail-closed:
 *    quem duplica revisa e liga.
 *
 * ⚠️ Entra logo DEPOIS do original (`position + 1`), não no fim: quem duplica quer
 *    comparar lado a lado. Empate de `position` é tolerado — a ordenação da vitrine tem
 *    desempate por preço e id (ver `getSignupTrialPlan`), então não vira ordem instável.
 */
export async function duplicatePlan(id: string): Promise<{ error?: string; id?: string }> {
  const session = await requirePlatformAdmin()

  const { data: origem, error: readErr } = await supabaseAdmin
    .from("plans")
    .select("name, description, price_cents, user_quota, extra_user_price_cents, included_modules, pro_modules, limits, trial_days, trial_activation_mode, position")
    .eq("id", id)
    .maybeSingle()

  if (readErr) return { error: "Não foi possível ler o plano de origem." }
  if (!origem)  return { error: "Plano não encontrado." }

  const o = origem as Record<string, unknown>
  const copyName = `${String(o.name ?? "Plano")} (cópia)`.slice(0, 120)
  const nameError = validatePlanName(copyName)
  if (nameError) return { error: nameError }

  const { data, error } = await supabaseAdmin
    .from("plans")
    .insert({
      ...o,
      // ⚠️ Nome com sufixo pra não existirem dois "PLANO I" na lista — e o teto de 120
      //    evita estourar a coluna quando alguém duplica a cópia da cópia.
      name:      copyName,
      active:    false,
      position:  (Number(o.position) || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  if (error) return { error: error.message }

  // ⚠️ A cópia nasce `active:false`, então ela ainda não cobra ninguém — mas o registro
  //    existe pra a linha do tempo do catálogo não ter buracos: plano que aparece do nada
  //    é o tipo de coisa que ninguém consegue explicar seis meses depois.
  await auditarCatalogo(session, "platform.plano_duplicado", data.id, { origem: id }, {
    name: copyName, price_cents: o.price_cents, active: false,
  })

  revalidatePath("/admin/planos")
  return { id: data.id }
}

export async function updatePlan(id: string, input: PlanInput): Promise<{ error?: string }> {
  const session = await requirePlatformAdmin()
  const err = validate(input)
  if (err) return { error: err }
  const cleaned = await clean(input)

  // O estado anterior é testemunha E fotografia CAS. Duas abas administrativas não podem
  // sobrescrever catálogo, preço e módulos em silêncio nem produzir auditoria com before falso.
  const { data: antesRow, error: antesError } = await supabaseAdmin
    .from("plans")
    .select("name, price_cents, user_quota, extra_user_price_cents, active, trial_days, updated_at")
    .eq("id", id)
    .maybeSingle()
  if (antesError) return { error: "Não foi possível conferir a versão atual do plano." }
  if (!antesRow) return { error: "Plano não encontrado." }

  // Catálogo e materialização de módulos mudam na MESMA transação. Limites são lidos ao
  // vivo; módulos não — sem esta RPC editar included_modules deixaria tenants antigos no
  // contrato anterior, apesar de continuarem apontando para o plano editado.
  const { data, error } = await supabaseAdmin.rpc("atualizar_plano_atomico", {
    p_plan: id,
    p_name: cleaned.name,
    p_description: cleaned.description,
    p_price_cents: cleaned.price_cents,
    p_user_quota: cleaned.user_quota,
    p_extra_user_price_cents: cleaned.extra_user_price_cents,
    p_included_modules: cleaned.included_modules,
    p_pro_modules: cleaned.pro_modules,
    p_limits: cleaned.limits,
    p_trial_days: cleaned.trial_days,
    p_trial_activation_mode: cleaned.trial_activation_mode,
    p_active: cleaned.active,
    p_expected_updated_at: antesRow.updated_at,
  })

  if (error) {
    console.error(JSON.stringify({
      src: "admin-plans", kind: "update-plan-atomico-falhou", plano: id,
      code: error.code ?? null, msg: String(error.message ?? "").slice(0, 240),
    }))
    return { error: "Não foi possível atualizar o plano e seus módulos." }
  }
  const raw = Array.isArray(data) ? data[0] : data
  const result = raw as { atualizado?: boolean; motivo?: string | null; tenants_reaplicados?: number } | null
  if (!result?.atualizado) {
    return { error: result?.motivo ?? "O plano mudou durante a atualização." }
  }

  // ⚠️ `price_cents` no `after` é o que a próxima fatura de TODO tenant deste plano vai usar.
  await auditarCatalogo(session, "platform.plano_alterado", id, antesRow, {
    name: cleaned.name, price_cents: cleaned.price_cents, user_quota: cleaned.user_quota,
    extra_user_price_cents: cleaned.extra_user_price_cents, active: cleaned.active,
    trial_days: cleaned.trial_days, tenants_reaplicados: result.tenants_reaplicados ?? 0,
  })

  revalidatePath("/admin/planos")
  return {}
}

/**
 * Exclui um plano. Bloqueia se houver tenant usando (preserva integridade) —
 * nesse caso, sugere arquivar (active=false).
 */
export async function deletePlan(id: string): Promise<{ error?: string }> {
  const session = await requirePlatformAdmin()

  const { count } = await supabaseAdmin
    .from("tenants")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", id)

  if ((count ?? 0) > 0) {
    return { error: `${count} tenant(s) usam este plano. Reatribua-os ou arquive o plano em vez de excluir.` }
  }

  // 🔑 Lê ANTES de apagar — depois do delete não há o que registrar, e "plano X foi
  //    excluído" sem dizer o que ele era não responde nada. É a última chance.
  const { data: antesRow } = await supabaseAdmin
    .from("plans").select("name, price_cents, user_quota, active").eq("id", id).maybeSingle()

  const { error } = await supabaseAdmin.from("plans").delete().eq("id", id)
  if (error) return { error: error.message }

  await auditarCatalogo(session, "platform.plano_excluido", id, antesRow ?? null, null)

  revalidatePath("/admin/planos")
  return {}
}

/**
 * Grava a ordem da VITRINE — a sequência em que o cliente vê os planos ao escolher.
 *
 * 🔑 `plans.position` já existia e já ordenava os dois lados (esta lista e
 *    `plans-view.ts`), mas **ninguém nunca escrevia nela** a não ser o duplicar
 *    (`position + 1`). O efeito estava visível em produção: Trial, PLANO I e Enterprise
 *    todos em `0`, o desempate caindo no preço, e o plano mais caro aparecendo no começo
 *    junto com o teste. Não era bug de código — era a coluna sem dono.
 *
 * ⚠️ ORDEM É VITRINE, E SÓ (decisão do dono, 07/08). Ela **não** define quem pode evoluir
 *    pra quem: isso é capacidade, e vive nas cotas do plano. Se um dia a posição virar
 *    também hierarquia de upgrade, uma coluna passa a ter dois significados e arrastar um
 *    card na tela mudaria silenciosamente quem pode contratar o quê — que é exatamente a
 *    classe do bug do `plan_id` (intenção × fato) que já custou caro aqui.
 *
 * ⚠️ Recebe a lista INTEIRA e reescreve todas as posições pelo índice. Mandar só o que
 *    mudou parece econômico e reabre o empate: quem não veio fica com a posição antiga e
 *    pode colidir com a nova de outro.
 */
export async function reorderPlans(ids: string[]): Promise<{ error?: string }> {
  await requirePlatformAdmin()

  if (!Array.isArray(ids) || ids.length === 0) return { error: "Nada para ordenar." }
  // 🔒 A tela manda o que está renderizado; o servidor não confia nisso. Ids repetidos
  //    fariam duas posições iguais (o empate de volta), e id de fora da tabela viraria
  //    update silencioso em nada.
  const unicos = [...new Set(ids)]
  if (unicos.length !== ids.length) return { error: "Lista com itens repetidos." }

  const { data: existentes, error: eErr } = await supabaseAdmin
    .from("plans").select("id").in("id", unicos)
  if (eErr) return { error: eErr.message }
  if ((existentes ?? []).length !== unicos.length) {
    return { error: "A lista mudou enquanto você reordenava. Recarregue a página." }
  }

  // ⚠️ Sequencial, não `Promise.all`: são no máximo alguns planos, e um lote paralelo que
  //    falha no meio deixaria a ordem pela metade — pior que demorar 200ms.
  for (const [i, id] of unicos.entries()) {
    const { error } = await supabaseAdmin
      .from("plans")
      .update({ position: i, updated_at: new Date().toISOString() })
      .eq("id", id)
    if (error) return { error: error.message }
  }

  revalidatePath("/admin/planos")
  // A vitrine do cliente lê a mesma coluna — sem isto, a ordem nova só apareceria pra ele
  // no próximo deploy ou expiração de cache.
  revalidatePath("/configuracoes/assinatura")
  revalidatePath("/configuracoes/assinatura/planos")
  return {}
}

/**
 * Atribui (ou remove, com null) um plano a um tenant.
 * Ao atribuir, **habilita os módulos inclusos no plano** (upsert em tenant_modules).
 * Aditivo: não desabilita módulos que o tenant já tinha fora do plano — ajuste
 * fino fica na aba Módulos.
 */
export async function assignPlanToTenant(tenantId: string, planId: string | null): Promise<{ error?: string }> {
  const session = await requirePlatformAdmin()

  // 🔑 O plano ANTERIOR deste tenant, lido antes de qualquer escrita — os dois ramos abaixo
  //    o alteram, e sem ele a trilha não sabe dizer de onde o cliente veio.
  const { data: planoAntes, error: planoAntesError } = await supabaseAdmin
    .from("tenants").select("plan_id").eq("id", tenantId).maybeSingle()
  if (planoAntesError) return { error: "Não foi possível conferir o plano atual do cliente." }
  if (!planoAntes) return { error: "Cliente não encontrado." }
  const planoAnterior = (planoAntes as { plan_id?: string | null } | null)?.plan_id ?? null

  if (planId === null) {
    // A remoção e a revogação plan-owned acontecem na mesma transação. A fotografia do
    // plano anterior faz uma atribuição concorrente vencer, em vez de ser apagada depois.
    const r = await removePlan(tenantId, planoAnterior)
    if (!r.ok) return { error: r.error }
  } else {
    // Fonte única: aplica plan_id + módulos do plano (mantém manuais). A fotografia
    // separada impede duas atribuições administrativas concorrentes de virarem last-write-wins.
    const r = await applyPlan(tenantId, planId, { expectedCurrentPlanId: planoAnterior })
    if (!r.ok) return { error: r.error }
  }

  // ⚠️ Aqui o alvo É um tenant (diferente das ações de catálogo), então a trilha vai pra ELE:
  //    trocar o plano de um cliente muda o que ele paga e o que ele recebe, e é na linha do
  //    tempo dele que essa pergunta é feita depois.
  // 🔑 `planId: null` é o caso mais consequente — a auditoria de 05/08 mostrou que "remover
  //    plano" já foi um upgrade grátis com isenção permanente. Registrar isso não é opcional.
  await auditarCatalogo(
    session,
    planId === null ? "platform.plano_removido" : "platform.plano_atribuido",
    tenantId,
    { plan_id: planoAnterior },
    { plan_id: planId },
    tenantId,
  )

  revalidatePath(`/admin/tenants/${tenantId}`)
  revalidatePath(`/admin/tenants/${tenantId}/modulos`)
  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  revalidatePath("/admin/planos")
  return {}
}
