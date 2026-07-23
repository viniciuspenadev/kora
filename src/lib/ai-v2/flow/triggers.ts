// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — disparo e carga de fluxos
// ═══════════════════════════════════════════════════════════════
// Decide QUAL fluxo (publicado e ativo) inicia pra uma mensagem. Fluxo
// tem precedência sobre o agente; o agente é o fallback (doc §1).

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import type { FlowRow, FlowRunRow, FlowTrigger } from "./types"

const FLOW_SELECT = "id, tenant_id, name, version, trigger, graph"

/** Sinais do inbound usados pelo matcher (além do texto/isNewContact). */
export interface MatchSignals {
  channel?:    string | null
  instanceId?: string | null
  isReopened?: boolean
  /** Conversa nasceu de um anúncio Meta (Click-to-WhatsApp)? */
  fromAd?:     boolean
  /** Id do anúncio de origem (from_ad_meta.sourceId), p/ filtro por anúncio específico. */
  adId?:       string | null
}

/** Normaliza p/ comparação PT-BR: minúsculas + remove acento (olá → ola). */
function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
}

function matchesKeyword(t: FlowTrigger, text: string): boolean {
  const haystack = norm(text)
  const exact = t.keywordMatch === "exact"
  // "exact" = palavra inteira (tokens separados por não-alfanumérico).
  const tokens = exact ? new Set(haystack.split(/[^\p{L}\p{N}]+/u).filter(Boolean)) : null
  return (t.keywords ?? []).some((k) => {
    const kw = norm(k.trim())
    if (!kw) return false
    return exact ? tokens!.has(kw) : haystack.includes(kw)
  })
}

function matchesTrigger(t: FlowTrigger | null, text: string, isNewContact: boolean, sig: MatchSignals): boolean {
  if (!t) return false
  // Só o RECEPTIVO casa com um inbound. Ativo (manual/campanha) e Automático
  // (inatividade — disparado pelo cron) nunca reagem a uma mensagem de entrada.
  if ((t.mode ?? "receptive") !== "receptive") return false
  // Filtros de canal/instância (ausente/vazio = qualquer).
  if (t.channels?.length  && !t.channels.includes(sig.channel ?? "")) return false
  if (t.instances?.length && !t.instances.includes(sig.instanceId ?? "")) return false
  switch (t.type) {
    case "any_message": return true
    case "new_contact": return isNewContact
    case "reopened":    return !!sig.isReopened
    case "keyword":     return matchesKeyword(t, text)
    case "from_ad":
      if (!sig.fromAd) return false
      // Filtro de anúncio específico (ausente/vazio = qualquer anúncio).
      if (t.adIds?.length) return !!sig.adId && t.adIds.includes(sig.adId)
      return true
    default: return false
  }
}

// Especificidade do gatilho — o MAIS específico vence quando vários casam. O
// `any_message` (catch-all) é o ÚLTIMO recurso, não compete de igual com keyword.
// `from_ad` é o mais específico (origem declarada do contato).
const TRIGGER_RANK: Record<string, number> = { from_ad: 5, reopened: 4, keyword: 3, new_contact: 2, any_message: 1 }

/**
 * Fluxo publicado+ativo que inicia pra esta mensagem. Entre vários que casam,
 * vence o de gatilho MAIS ESPECÍFICO (keyword > new_contact > any_message);
 * empate de rank → o mais antigo (updated_at asc). Null = nenhum (→ agente).
 */
export async function findFlowToStart(
  tenantId: string,
  incomingText: string,
  isNewContact: boolean,
  signals: MatchSignals = {},
): Promise<FlowRow | null> {
  const { data } = await supabaseAdmin
    .from("studio_flows")
    .select(FLOW_SELECT)
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .eq("active", true)
    .order("updated_at", { ascending: true })

  let best: FlowRow | null = null
  let bestRank = 0
  for (const f of (data ?? []) as FlowRow[]) {
    if (!matchesTrigger(f.trigger, incomingText, isNewContact, signals)) continue
    const rank = TRIGGER_RANK[f.trigger?.type ?? ""] ?? 0
    if (rank > bestRank) { best = f; bestRank = rank }   // empate mantém o 1º (mais antigo)
  }
  return best
}

/**
 * Existe fluxo publicado+ativo que RESPONDERIA a um inbound neste canal? Usado pelo
 * widget do site no BOOT (decidir "digitando…" × "recebido") — ainda não existe texto,
 * então keyword-only conta como NÃO: melhor prometer humano e o bot surpreender do que
 * prometer bot e ninguém responder (mesma régua fail-closed do resto).
 */
export async function hasReceptiveFlowForChannel(tenantId: string, channel: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("studio_flows")
    .select("trigger")
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .eq("active", true)
  return ((data ?? []) as { trigger: FlowTrigger | null }[]).some(({ trigger: t }) => {
    if (!t) return false
    if ((t.mode ?? "receptive") !== "receptive") return false
    if (t.channels?.length && !t.channels.includes(channel)) return false
    // Sem o texto futuro, só os gatilhos que pegam a 1ª mensagem contam.
    return t.type === "any_message" || t.type === "new_contact"
  })
}

/** Carrega um fluxo por id (pra retomar um run ativo). */
export async function loadFlow(tenantId: string, flowId: string): Promise<FlowRow | null> {
  const { data } = await supabaseAdmin
    .from("studio_flows")
    .select(FLOW_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", flowId)
    .maybeSingle()
  return (data as FlowRow | null) ?? null
}

/**
 * Carrega um fluxo por id SÓ se estiver publicado + ativo (startable).
 * Usado pelo "fluxo de retorno" fixado (vínculo='ai'): se o fluxo escolhido foi
 * despublicado/arquivado, devolve null → o caller degrada (gatilho/agente).
 */
export async function loadStartableFlow(tenantId: string, flowId: string): Promise<FlowRow | null> {
  const { data } = await supabaseAdmin
    .from("studio_flows")
    .select(FLOW_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", flowId)
    .eq("status", "published")
    .eq("active", true)
    .maybeSingle()
  return (data as FlowRow | null) ?? null
}

const RUN_SELECT = "id, conversation_id, flow_id, flow_version, current_node_id, created_at, variables, call_stack, status, resume_at"

/** Run ativo (active|waiting) da conversa, se houver. */
export async function activeFlowRun(conversationId: string): Promise<FlowRunRow | null> {
  const { data } = await supabaseAdmin
    .from("studio_flow_runs")
    .select(RUN_SELECT)
    .eq("conversation_id", conversationId)
    .in("status", ["active", "waiting"])
    .maybeSingle()
  return (data as FlowRunRow | null) ?? null
}

/** Cria/zera o run da conversa (upsert por conversation_id, UNIQUE). */
export async function startFlowRun(tenantId: string, conversationId: string, flow: FlowRow): Promise<FlowRunRow> {
  const startNode = flow.graph.nodes.find((n) => n.type === "start") ?? flow.graph.nodes[0] ?? null
  return startFlowRunAt(tenantId, conversationId, flow, startNode?.id ?? null)
}

/** Como startFlowRun, mas começa num nó específico (campanha-por-fluxo: retoma DEPOIS
 *  do template de acionamento, já enviado a frio — sem duplicar o opener). */
export async function startFlowRunAt(tenantId: string, conversationId: string, flow: FlowRow, nodeId: string | null): Promise<FlowRunRow> {
  const row = {
    tenant_id: tenantId,
    conversation_id: conversationId,
    flow_id: flow.id,
    flow_version: flow.version,
    current_node_id: nodeId,
    variables: {},
    call_stack: [],
    status: "active" as const,
  }
  const { data } = await supabaseAdmin
    .from("studio_flow_runs")
    .upsert(row, { onConflict: "conversation_id" })
    .select(RUN_SELECT)
    .maybeSingle()
  // Fallback defensivo (upsert deve sempre retornar a linha).
  return (data as FlowRunRow | null) ?? { id: "", ...row }
}
