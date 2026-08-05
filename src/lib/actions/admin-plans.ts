"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import { applyPlan } from "@/lib/plans"
import { LIMIT_META, type LimitResource } from "@/lib/limits-shared"

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

function validate(input: PlanInput): string | null {
  if (!input.name.trim())                  return "Dê um nome ao plano"
  if (input.price_cents < 0)               return "Preço inválido"
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
  await requirePlatformAdmin()
  const err = validate(input)
  if (err) return { error: err }

  const { data, error } = await supabaseAdmin
    .from("plans")
    .insert({ ...(await clean(input)), updated_at: new Date().toISOString() })
    .select("id")
    .single()

  if (error) return { error: error.message }
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
  await requirePlatformAdmin()

  const { data: origem, error: readErr } = await supabaseAdmin
    .from("plans")
    .select("name, description, price_cents, user_quota, extra_user_price_cents, included_modules, pro_modules, limits, trial_days, trial_activation_mode, position")
    .eq("id", id)
    .maybeSingle()

  if (readErr) return { error: "Não foi possível ler o plano de origem." }
  if (!origem)  return { error: "Plano não encontrado." }

  const o = origem as Record<string, unknown>

  const { data, error } = await supabaseAdmin
    .from("plans")
    .insert({
      ...o,
      // ⚠️ Nome com sufixo pra não existirem dois "PLANO I" na lista — e o teto de 120
      //    evita estourar a coluna quando alguém duplica a cópia da cópia.
      name:      `${String(o.name ?? "Plano")} (cópia)`.slice(0, 120),
      active:    false,
      position:  (Number(o.position) || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  if (error) return { error: error.message }
  revalidatePath("/admin/planos")
  return { id: data.id }
}

export async function updatePlan(id: string, input: PlanInput): Promise<{ error?: string }> {
  await requirePlatformAdmin()
  const err = validate(input)
  if (err) return { error: err }

  const { error } = await supabaseAdmin
    .from("plans")
    .update({ ...(await clean(input)), updated_at: new Date().toISOString() })
    .eq("id", id)

  if (error) return { error: error.message }
  revalidatePath("/admin/planos")
  return {}
}

/**
 * Exclui um plano. Bloqueia se houver tenant usando (preserva integridade) —
 * nesse caso, sugere arquivar (active=false).
 */
export async function deletePlan(id: string): Promise<{ error?: string }> {
  await requirePlatformAdmin()

  const { count } = await supabaseAdmin
    .from("tenants")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", id)

  if ((count ?? 0) > 0) {
    return { error: `${count} tenant(s) usam este plano. Reatribua-os ou arquive o plano em vez de excluir.` }
  }

  const { error } = await supabaseAdmin.from("plans").delete().eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/admin/planos")
  return {}
}

/**
 * Atribui (ou remove, com null) um plano a um tenant.
 * Ao atribuir, **habilita os módulos inclusos no plano** (upsert em tenant_modules).
 * Aditivo: não desabilita módulos que o tenant já tinha fora do plano — ajuste
 * fino fica na aba Módulos.
 */
export async function assignPlanToTenant(tenantId: string, planId: string | null): Promise<{ error?: string }> {
  await requirePlatformAdmin()

  if (!planId) {
    const { error } = await supabaseAdmin.from("tenants").update({ plan_id: null }).eq("id", tenantId)
    if (error) return { error: error.message }
  } else {
    // Fonte única: aplica plan_id + plan string + módulos do plano (mantém manuais).
    const r = await applyPlan(tenantId, planId)
    if (!r.ok) return { error: r.error }
  }

  revalidatePath(`/admin/tenants/${tenantId}`)
  revalidatePath(`/admin/tenants/${tenantId}/modulos`)
  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  revalidatePath("/admin/planos")
  return {}
}
