// ═══════════════════════════════════════════════════════════════
// God Mode — Limites (lado SERVER: queries + checks)
// ═══════════════════════════════════════════════════════════════
// Tipos + metadados + defaults vivem em limits-shared.ts (safe pra client).
// Este arquivo é server-only — toca DB.

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import {
  LIMIT_META,
  DEFAULT_LIMITS_BY_PLAN,
  ALL_PLANS,
  type LimitResource,
  type LimitInfo,
} from "@/lib/limits-shared"

// Re-export pros callers que continuam importando de "@/lib/limits"
export { LIMIT_META, DEFAULT_LIMITS_BY_PLAN, ALL_PLANS } from "@/lib/limits-shared"
export type { LimitResource, LimitInfo } from "@/lib/limits-shared"

// ── Resolver max (override do tenant → limite do PLANO → fallback) ──

const ALL_RESOURCES: LimitResource[] = [
  "users", "whatsapp_official", "whatsapp_qr", "messages_per_month",
  "conversations_per_month", "broadcasts_per_month", "storage_mb", "contacts", "automations",
  "instagram_automations_per_month",
]

/** Parse SEGURO do jsonb `plans.limits`: só aceita number≥0 ou null; ignora lixo. */
function parsePlanLimits(raw: unknown): Partial<Record<LimitResource, number | null>> {
  const out: Partial<Record<LimitResource, number | null>> = {}
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>
    for (const r of ALL_RESOURCES) {
      if (!Object.prototype.hasOwnProperty.call(o, r)) continue
      const v = o[r]
      if (v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0)) out[r] = v as number | null
    }
  }
  return out
}

interface PlanCtx { plan: string; planLimits: Partial<Record<LimitResource, number | null>> }

/** Plano do tenant + limites do plano (lidos AO VIVO de `plans.limits` via plan_id). */
async function getPlanContext(tenantId: string): Promise<PlanCtx> {
  const { data } = await supabaseAdmin
    .from("tenants")
    .select("plan, plan_id, plans:plan_id ( limits )")
    .eq("id", tenantId)
    .maybeSingle()
  const plan = (data?.plan as string | undefined) ?? "trial"
  const rel = (data as { plans?: { limits?: unknown } | { limits?: unknown }[] | null } | null)?.plans
  const limitsRaw = Array.isArray(rel) ? rel[0]?.limits : rel?.limits
  return { plan, planLimits: parsePlanLimits(limitsRaw) }
}

async function resolveMax(
  tenantId: string,
  resource: LimitResource,
  ctx:      PlanCtx,
): Promise<{ max: number | null; source: "override" | "plan" | "default" }> {
  const { data: override } = await supabaseAdmin
    .from("tenant_limits")
    .select("max_value, expires_at")
    .eq("tenant_id", tenantId)
    .eq("resource", resource)
    .maybeSingle()

  if (override) {
    const expired = override.expires_at && new Date(override.expires_at).getTime() < Date.now()
    if (!expired) return { max: override.max_value, source: "override" }
  }

  // Limite do PLANO (ao vivo). Chave presente vale — inclusive `null` = ilimitado.
  if (Object.prototype.hasOwnProperty.call(ctx.planLimits, resource)) {
    return { max: ctx.planLimits[resource] ?? null, source: "plan" }
  }

  // Fallback: defaults hardcoded por string de plano (legado / tenant sem plano).
  const planDefaults = DEFAULT_LIMITS_BY_PLAN[ctx.plan] ?? DEFAULT_LIMITS_BY_PLAN.trial
  return { max: planDefaults[resource], source: "default" }
}

// ── Contagem de uso por recurso ────────────────────────────────

/** Início do mês corrente — mesma régua já usada por messages/conversations_per_month.
 *  (Nome longo de propósito: os cases antigos declaram um `const monthStart` local.)
 *
 *  ⚠️ UTC EXPLÍCITO. `setDate`/`setHours` usam o fuso do PROCESSO, e `created_at` é
 *  `now()` em UTC: fora de um container UTC a janela desloca até 3h e, na virada do mês,
 *  as mesmas linhas contam nos DOIS ciclos. Em container UTC isto é no-op; fora dele,
 *  conserta. O ciclo de cobrança não pode depender de variável de ambiente. */
function currentMonthStart(): string {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString()
}

/** Quando a cota mensal zera (início do mês seguinte) — vai no aviso de cota. */
export function monthlyQuotaResetsAt(): string {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0)).toISOString()
}

/** Início do ciclo de cota mensal (ISO) — pro produtor de aviso deduplicar por ciclo. */
export function monthlyQuotaPeriodStart(): string {
  return currentMonthStart()
}

async function getUsage(tenantId: string, resource: LimitResource): Promise<number> {
  switch (resource) {
    case "users": {
      const [{ count: active }, { count: pending }] = await Promise.all([
        supabaseAdmin
          .from("tenant_users")
          .select("user_id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("active", true),
        supabaseAdmin
          .from("invites")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .is("accepted_at", null)
          .gte("expires_at", new Date().toISOString()),
      ])
      return (active ?? 0) + (pending ?? 0)
    }

    case "whatsapp_official": {
      const { count } = await supabaseAdmin
        .from("whatsapp_instances")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("provider", "meta_cloud")
      return count ?? 0
    }

    case "whatsapp_qr": {
      // QR = tudo que NÃO é oficial (inclui provider NULL de instâncias antigas).
      const { count } = await supabaseAdmin
        .from("whatsapp_instances")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .or("provider.is.null,provider.neq.meta_cloud")
      return count ?? 0
    }

    case "contacts": {
      const { count } = await supabaseAdmin
        .from("chat_contacts")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
      return count ?? 0
    }

    case "messages_per_month": {
      const monthStart = new Date()
      monthStart.setDate(1)
      monthStart.setHours(0, 0, 0, 0)
      const { count } = await supabaseAdmin
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .gte("created_at", monthStart.toISOString())
      return count ?? 0
    }

    case "conversations_per_month": {
      const monthStart = new Date()
      monthStart.setDate(1)
      monthStart.setHours(0, 0, 0, 0)
      const { count } = await supabaseAdmin
        .from("chat_conversations")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .gte("created_at", monthStart.toISOString())
      return count ?? 0
    }

    case "storage_mb": {
      // ✅ GAP FECHADO 2026-07-31. Antes: sempre 0 MB pra todo mundo — o case selecionava
      // `media_size_bytes`, coluna que NUNCA existiu, o PostgREST devolvia 42703, o erro
      // era descartado junto com o `data`, e a cota mentiu por ~2 meses.
      //
      // 🔴 O número vem do BUCKET, não de ponteiro em `chat_messages`. Contar por ponteiro
      //    já nasceria errado: medido em 2026-07-31, há 59 objetos sem ponteiro (14,57 MB)
      //    e 118 ponteiros sem objeto. Lendo `storage.objects` a deriva é ZERO — e o
      //    número bate com o que a Supabase COBRA, que é a validação que importa.
      //    Conferido ao vivo: 970 MB atribuídos × 972 MB no bucket (a diferença são 8
      //    arquivos de um tenant já removido — item da faxina, passo 6).
      //
      // ⚠️ RPC e não query: agregado do PostgREST está DESLIGADO neste projeto
      //    (`PGRST123`). `SUM()` não existe pro supabaseAdmin — e paginar `select("bytes")`
      //    recriaria o scan que este case existia pra matar.
      //    Desenho completo: docs/tenant-storage-foundation-design.md §1.
      const { data, error } = await supabaseAdmin.rpc("tenant_storage_usage", { p_tenant_id: tenantId })
      // Erro NÃO pode virar "0 MB" silencioso — foi exatamente assim que o bug anterior
      // sobreviveu 2 meses. Exceção única: 42883 = a função ainda não foi aplicada.
      if (error) {
        if (error.code !== "42883") {
          console.error("[limits] storage_mb:", JSON.stringify({ tenantId, code: error.code, message: error.message }))
        }
        return 0
      }
      const rows = (data ?? []) as { bytes: number | string }[]
      const totalBytes = rows.reduce((acc, r) => acc + (Number(r.bytes) || 0), 0)
      return Math.round(totalBytes / (1024 * 1024))
    }

    case "broadcasts_per_month":
      return 0

    case "automations": {
      // Fluxos do Kora Studio que existem (rascunho + publicado); arquivados não contam.
      const { count } = await supabaseAdmin
        .from("studio_flows")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .neq("status", "archived")
      return count ?? 0
    }

    case "instagram_automations_per_month": {
      // 🔴 A cota é ÚNICA e SOMADA (docs/instagram-modulo-e-limites.md §4.1): count(*) por
      // (tenant, período), SEM agrupar por `kind` / `rule_id` / `flow_id`. Esses campos
      // existem pro RELATÓRIO ("qual fluxo mais executou"), nunca pro limite — cliente com
      // 10 fluxos de comentário não tem 10 cotas, tem uma, e os 10 somam nela.
      // 🔴 `failed` NÃO conta. A unidade cobrada é "automação EXECUTADA": o claim-first
      // grava a linha ANTES de chamar a Meta, então token expirado / 429 / janela fechada
      // produziriam centenas de linhas sem UMA direct entregue — e o cliente veria "cota
      // esgotada" tendo recebido zero. `claimed` conta (está em voo, vira `sent`); um
      // claim órfão é reconciliado pra `failed` pelo cron e devolve a cota.
      // ⚠️ Este predicado é o MESMO de `claim_ig_automation_run` (SQL) e do índice parcial
      //    `idx_ig_runs_quota`. Mudou aqui, muda nos três.
      const { count, error } = await supabaseAdmin
        .from("instagram_automation_runs")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .in("status", ["claimed", "sent", "replied"])
        .gte("created_at", currentMonthStart())
      // Erro NÃO pode virar "0 em silêncio" (foi assim que o storage_mb mentiu por 2 meses).
      // Exceção única: 42P01 = a migration do ledger ainda não foi aplicada — aí o uso é
      // 0 de verdade (não houve execução nenhuma), e logar isso a cada render seria ruído.
      if (error) {
        if (error.code !== "42P01") {
          console.error("[limits] instagram_automations_per_month:", JSON.stringify({ tenantId, code: error.code, message: error.message }))
        }
        return 0
      }
      return count ?? 0
    }
  }
}

// ── API pública ────────────────────────────────────────────────

export async function checkLimit(tenantId: string, resource: LimitResource): Promise<LimitInfo> {
  const ctx = await getPlanContext(tenantId)
  const [{ max, source }, used] = await Promise.all([
    resolveMax(tenantId, resource, ctx),
    getUsage(tenantId, resource),
  ])

  if (max === null) {
    return { resource, max: null, used, remaining: null, ok: true, source }
  }
  return {
    resource,
    max,
    used,
    remaining: Math.max(0, max - used),
    ok:        used < max,
    source,
  }
}

/**
 * Só o TETO, sem contar o uso.
 *
 * Existe pro claim atômico (`claim_ig_automation_run`): lá a contagem acontece DENTRO da
 * transação, sob lock — contar aqui antes seria o TOCTOU que a função existe pra fechar.
 */
export async function resolveLimitMax(
  tenantId: string, resource: LimitResource,
): Promise<{ max: number | null; source: "override" | "plan" | "default" }> {
  return resolveMax(tenantId, resource, await getPlanContext(tenantId))
}

/** Rótulo de cada natureza de arquivo na tela de uso. Desconhecido cai em "Outros" —
 *  `kind` novo não pode inventar uma linha com nome cru na cara do cliente. */
const STORAGE_KIND_LABEL: Record<string, string> = {
  conversation: "Conversas", avatar: "Fotos de contato", document: "Documentos",
  catalog: "Catálogo", ig_thumb: "Posts do Instagram", unit_logo: "Logos",
  user_avatar: "Fotos de perfil", widget: "Widget do site", card: "Cartões",
}

export interface StorageBreakdownItem { kind: string; label: string; bytes: number; objects: number }

/**
 * Uso de armazenamento POR ORIGEM (conversas · documentos · catálogo…).
 *
 * "Você usou 1,8 GB" não é acionável — o dono não sabe o que apagar. Com a quebra, sabe.
 * Mesma fonte do `storage_mb` (a RPC sobre o bucket), então os dois NUNCA divergem: um é
 * a soma do outro.
 */
export async function getStorageBreakdown(tenantId: string): Promise<StorageBreakdownItem[]> {
  const { data, error } = await supabaseAdmin.rpc("tenant_storage_usage", { p_tenant_id: tenantId })
  if (error) {
    if (error.code !== "42883") console.error("[limits] breakdown:", error.code, error.message)
    return []
  }
  return ((data ?? []) as { kind: string; bytes: number | string; objects: number | string }[])
    .map((r) => ({
      kind:    r.kind,
      label:   STORAGE_KIND_LABEL[r.kind] ?? "Outros",
      bytes:   Number(r.bytes) || 0,
      objects: Number(r.objects) || 0,
    }))
    .filter((r) => r.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes)
}

export async function requireLimit(tenantId: string, resource: LimitResource): Promise<void> {
  const info = await checkLimit(tenantId, resource)
  if (!info.ok) {
    const meta = LIMIT_META[resource]
    throw new Error(
      `Limite de ${meta.label.toLowerCase()} atingido (${info.used}/${info.max}). ` +
      `Solicite aumento ao administrador da plataforma.`,
    )
  }
}

export async function listAllLimits(tenantId: string): Promise<LimitInfo[]> {
  const resources: LimitResource[] = [
    "users", "whatsapp_official", "whatsapp_qr", "contacts",
    "conversations_per_month", "messages_per_month",
    "broadcasts_per_month", "storage_mb", "automations",
    "instagram_automations_per_month",
  ]
  return Promise.all(resources.map((r) => checkLimit(tenantId, r)))
}
