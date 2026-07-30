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
      // ⚠️ GAP CONHECIDO — este número é uma SUBESTIMATIVA, hoje sempre 0.
      //
      // Até 2026-07-29 este case selecionava `media_size_bytes`, coluna que
      // NUNCA existiu em chat_messages: o PostgREST devolvia 42703, o erro era
      // descartado junto com o `data`, e a cota exibia 0 MB pra sempre.
      //
      // O tamanho do arquivo não é persistido em lugar nenhum: os 3 ingestores
      // (chat.ts, meta-inbound.ts, instagram-inbound.ts) gravam só
      // `metadata.storage_path`, e o schema `storage` não é exposto no
      // PostgREST (só public/graphql_public) — então não dá pra somar
      // storage.objects daqui. Somar via Storage API exigiria um list()
      // recursivo por conversa (N+1 requests) a cada render da página de uso.
      //
      // PRA FECHAR O GAP (ordem obrigatória — schema-before-deploy):
      //   1. os 3 ingestores + documents.ts/send-quote.ts passam a gravar
      //      `metadata.storage_size_bytes` (bytes do buffer que já têm em mãos);
      //   2. backfill dos arquivos antigos (script lendo o bucket);
      //   3. índice parcial pra soma não virar seq scan:
      //      CREATE INDEX ... ON chat_messages (tenant_id)
      //        WHERE metadata ? 'storage_size_bytes';
      //   4. este case já soma sozinho — nada mais a mudar aqui.
      //
      // Enquanto (1) não roda, a query abaixo retorna 0 linhas e o uso fica 0 —
      // que é a VERDADE do que sabemos, não um número inventado.
      const MAX_PAGES = 200 // trava de sanidade: 200k mensagens com mídia
      const PAGE      = 1000 // PostgREST corta a resposta em 1000 linhas
      let totalBytes = 0
      for (let page = 0; page < MAX_PAGES; page++) {
        const from = page * PAGE
        const { data, error } = await supabaseAdmin
          .from("chat_messages")
          .select("id, metadata")
          .eq("tenant_id", tenantId)
          .not("metadata->>storage_size_bytes", "is", null)
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1)
        // Erro não pode virar "0 MB" silencioso de novo — foi exatamente assim
        // que este bug sobreviveu 2 meses. Loga alto e devolve o parcial real.
        if (error) {
          console.error("[limits] storage_mb: falha ao somar mídia", JSON.stringify({ tenantId, error: error.message }))
          break
        }
        const rows = (data ?? []) as { metadata: unknown }[]
        for (const row of rows) {
          const raw = (row.metadata as { storage_size_bytes?: unknown } | null)?.storage_size_bytes
          const bytes = typeof raw === "number" ? raw : Number(raw)
          if (Number.isFinite(bytes) && bytes > 0) totalBytes += bytes
        }
        if (rows.length < PAGE) break
      }
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
