import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { resolveLimitMax, monthlyQuotaPeriodStart, monthlyQuotaResetsAt } from "@/lib/limits"
import { createNotification } from "@/lib/notifications"

// ═══════════════════════════════════════════════════════════════
// Automação do Instagram — licença + cota + CLAIM (fonte ÚNICA)
// ═══════════════════════════════════════════════════════════════
// Desenho: docs/instagram-modulo-e-limites.md §4.1.
//
// Duas perguntas e uma reserva, num lugar só:
//   1. "pode?"      → módulo `instagram_automation` (FILHO de `ai_studio`; o gate no banco
//                     já exige o pai recursivamente — desligar o Studio derruba junto,
//                     desligar só ele mantém o inbox do Direct vivo).
//   2. "ainda tem?" → cota ÚNICA e SOMADA do tenant no mês (todos os fluxos e todos os
//                     `kind` do ledger consomem o mesmo teto).
//   3. reserva      → a linha do ledger, no MESMO comando que checou a cota.
//
// 🔴 POR QUE 2 E 3 SÃO INDIVISÍVEIS. A versão anterior fazia `count(*)` aqui e o `INSERT`
//    lá no handler. Isso é TOCTOU: num post viral a Meta entrega 500 comentários em POSTs
//    concorrentes e, com 40 handlers entre a contagem e o insert, os 40 leem "49 de 50" e
//    os 40 passam. O teto vira sugestão e o overrun cresce junto com a rajada — exatamente
//    quando o limite importa. Agora quem conta e quem reserva é a MESMA transação, sob
//    `pg_advisory_xact_lock` por tenant (ver a função na migration 20260730_..._f2.sql).
//
// 🔴 BLOQUEAR = PARAR DE CAPTURAR EVENTO NOVO. Nunca cortar conversa em andamento:
//    quem já respondeu o direct segue sendo atendido normalmente — o fluxo dele já roda
//    pelo motor comum, que não passa por aqui.
//
// Genérico por `kind` de propósito: story_reply/follow_dm/ad_ctd reusam esta função
// inteira (gate + cota + claim + aviso), sem reimplementar nenhuma das etapas.

const RESOURCE = "instagram_automations_per_month" as const

/** Fração da cota que dispara o aviso preventivo. 🔴 É o aviso que evita o prejuízo:
 *  esgotado, o estrago já ocorreu (a private reply tem prazo de 7 dias e não dá pra
 *  recuperar comentário perdido). Avisar antes dá tempo de subir de plano. */
const WARN_AT = 0.8

/**
 * Janela do anti-repetição POR PESSOA.
 *
 * Sem isto, a mesma pessoa comentando 20× no mesmo post recebe 20 directs idênticos e
 * queima 20 unidades de cota — e o caso de uso número um da feature é sorteio
 * ("comenta QUERO pra participar"), onde comentar repetido é o comportamento normal.
 * Janela, e não índice único: a mesma pessoa pode legitimamente participar da campanha
 * do mês seguinte.
 */
const PERSON_WINDOW = "24 hours"

export type IgClaimOutcome =
  | "claimed"     // reservado: pode chamar a Meta
  | "duplicate"   // outro webhook já pegou este evento (a Meta duplica em post impulsionado)
  | "quota"       // teto do plano atingido
  | "person"      // esta pessoa já foi atendida na janela (anti-spam)
  | "module"      // tenant não tem a licença
  | "error"       // falha de banco → fail-closed

export interface IgClaimResult {
  outcome: IgClaimOutcome
  /** Preenchido SÓ em 'claimed'. */
  runId:   string | null
  used:    number
  /** null = ilimitado (enterprise / override). */
  limit:   number | null
  /** ISO do início do próximo ciclo — o "até DD/MM" da mensagem ao cliente. */
  resetsAt: string
}

export interface IgClaimInput {
  tenantId:     string
  connectionId: string
  /** 'comment_dm' hoje; 'story_reply' | 'follow_dm' | 'ad_ctd' depois — sem DDL. */
  kind:         string
  /** Id do evento NA META (comment_id/story_id/mid). Chave da idempotência. */
  sourceId:     string
  ruleId:       string | null
  flowId:       string | null
  mediaId:      string | null
  fromUsername: string | null
  occurredAt:   string | null
  /** Desliga o anti-repetição por pessoa (automação que por natureza repete). */
  allowRepeat?: boolean
}

/**
 * Licença + cota + reserva, atômico. Devolve `runId` SOMENTE quando pode disparar.
 *
 * Fail-closed em qualquer erro: melhor deixar de capturar um comentário do que mandar
 * direct duplicado (a Meta permite exatamente UM por comentário) ou furar a cota paga.
 */
export async function claimIgAutomation(input: IgClaimInput): Promise<IgClaimResult> {
  const resetsAt = monthlyQuotaResetsAt()
  const base = { runId: null, used: 0, limit: 0 as number | null, resetsAt }

  // Licença primeiro: sem módulo não há cota a discutir (e nada a notificar — não é
  // "acabou", é "não contratou"; quem resolve isso é comercial, não o sininho).
  if (!(await hasModule(input.tenantId, "instagram_automation"))) {
    return { ...base, outcome: "module" }
  }

  const { max } = await resolveLimitMax(input.tenantId, RESOURCE)

  const { data, error } = await supabaseAdmin.rpc("claim_ig_automation_run", {
    p_tenant_id:     input.tenantId,
    p_connection_id: input.connectionId,
    p_kind:          input.kind,
    p_source_id:     input.sourceId,
    p_rule_id:       input.ruleId,
    p_flow_id:       input.flowId,
    p_media_id:      input.mediaId,
    p_from_username: input.fromUsername,
    p_occurred_at:   input.occurredAt,
    p_max:           max,
    p_period_start:  monthlyQuotaPeriodStart(),
    p_person_window: input.allowRepeat ? null : PERSON_WINDOW,
  })

  if (error) {
    console.error("[ig-quota] claim:", JSON.stringify({ tenantId: input.tenantId, code: error.code, message: error.message }))
    return { ...base, outcome: "error", limit: max }
  }

  // A função devolve SETOF: uma linha só.
  const row = (Array.isArray(data) ? data[0] : data) as
    { run_id?: string | null; used?: number; outcome?: string } | null | undefined
  if (!row?.outcome) {
    console.error("[ig-quota] claim: resposta vazia da RPC", JSON.stringify({ tenantId: input.tenantId }))
    return { ...base, outcome: "error", limit: max }
  }

  const result: IgClaimResult = {
    outcome:  row.outcome as IgClaimOutcome,
    runId:    row.run_id ?? null,
    used:     row.used ?? 0,
    limit:    max,
    resetsAt,
  }

  // Aviso só nos dois desfechos que o dono precisa saber. 'duplicate'/'person' são
  // funcionamento saudável — notificar viraria ruído.
  if (result.outcome === "claimed" || result.outcome === "quota") {
    await notifyQuota(input.tenantId, result).catch((e) => console.error("[ig-quota] aviso falhou:", e))
  }
  return result
}

/**
 * Avisa donos/admins em 80% e no estouro — 1 vez por tenant POR CICLO.
 *
 * 🔴 O carimbo é `tenant_quota_notices` com índice ÚNICO (tenant, resource, period, level),
 * e não mais um SELECT em `notifications`. O SELECT era read-then-write: numa rajada, N
 * handlers cruzavam o limiar juntos, os N liam "ainda não avisei" e os N inseriam — ×
 * cada owner/admin, cada um espelhado em web push. Agora quem perde a corrida leva 23505
 * do banco e não notifica. O dono desligar o sininho por spam custa mais caro do que
 * qualquer aviso vale.
 *
 * O texto é do TENANT, nunca do fluxo: "todos os fluxos premium pausados". Se soar local,
 * o dono mexe num fluxo, não resolve, e repete nos outros nove.
 */
async function notifyQuota(tenantId: string, gate: IgClaimResult): Promise<void> {
  if (gate.limit === null || gate.limit <= 0) return           // ilimitado / sem cota = nada a avisar
  const ratio = gate.used / gate.limit
  const level = gate.outcome === "quota" ? "blocked"
              : ratio >= WARN_AT        ? "warn"
              : null
  if (!level) return
  const type = level === "blocked" ? "ig_quota_exhausted" : "ig_quota_warning"

  // Carimbo ANTES de notificar: se perder a corrida, ninguém manda nada.
  const { error: stampErr } = await supabaseAdmin.from("tenant_quota_notices").insert({
    tenant_id: tenantId,
    resource:  RESOURCE,
    period:    monthlyQuotaPeriodStart().slice(0, 10),   // 'YYYY-MM-DD' (UTC) = o ciclo
    level,
  })
  if (stampErr) {
    // 23505 = outro handler já avisou neste ciclo. Silêncio é o comportamento correto.
    if (stampErr.code !== "23505") console.error("[ig-quota] carimbo:", stampErr.code, stampErr.message)
    return
  }

  const { data: members, error: membersErr } = await supabaseAdmin
    .from("tenant_users")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .in("role", ["owner", "admin"])
  if (membersErr) { console.error("[ig-quota] destinatários:", membersErr.code, membersErr.message); return }

  const userIds = (members ?? []).map((m) => m.user_id as string)
  if (!userIds.length) return

  const until = new Date(gate.resetsAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" })
  const exhausted = level === "blocked"
  const title = exhausted
    ? "Cota de automações do Instagram esgotada"
    : "Cota de automações do Instagram em 80%"
  const body = exhausted
    ? `Todos os fluxos premium do Instagram estão pausados até ${until}. Comentários novos deixaram de virar direct — quem já respondeu segue sendo atendido.`
    : `Você já usou ${gate.used} de ${gate.limit} automações do mês. Ao esgotar, os comentários param de virar direct até ${until}.`

  // payload leva o número + o destino: o sininho abre direto em /configuracoes/uso.
  const payload = { used: gate.used, limit: gate.limit, resets_at: gate.resetsAt, url: "/configuracoes/uso" }

  // Sequencial de propósito: o fan-out é de 1–5 pessoas e cada createNotification já
  // dispara push. Paralelizar aqui só criaria pico de push por um ganho irrelevante.
  for (const recipientId of userIds) {
    await createNotification({ tenantId, recipientId, type, title, body, payload })
  }

  console.log("[ig-quota]", JSON.stringify({ tenantId, type, used: gate.used, limit: gate.limit, recipients: userIds.length }))
}
