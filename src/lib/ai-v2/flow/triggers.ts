// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — disparo e carga de fluxos
// ═══════════════════════════════════════════════════════════════
// Decide QUAL fluxo (publicado e ativo) inicia pra uma mensagem. Fluxo
// tem precedência sobre o agente; o agente é o fallback (doc §1).

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import type { FlowRow, FlowRunRow, FlowTrigger } from "./types"

const FLOW_SELECT = "id, tenant_id, name, version, trigger, graph"

function matchesTrigger(t: FlowTrigger | null, text: string, isNewContact: boolean): boolean {
  switch (t?.type) {
    case "any_message": return true
    case "new_contact": return isNewContact
    case "keyword": return (t.keywords ?? []).some((k) => k && text.toLowerCase().includes(k.toLowerCase()))
    default: return false
  }
}

// Especificidade do gatilho — o MAIS específico vence quando vários casam. O
// `any_message` (catch-all) é o ÚLTIMO recurso, não compete de igual com keyword.
const TRIGGER_RANK: Record<string, number> = { keyword: 3, new_contact: 2, any_message: 1 }

/**
 * Fluxo publicado+ativo que inicia pra esta mensagem. Entre vários que casam,
 * vence o de gatilho MAIS ESPECÍFICO (keyword > new_contact > any_message);
 * empate de rank → o mais antigo (updated_at asc). Null = nenhum (→ agente).
 */
export async function findFlowToStart(
  tenantId: string,
  incomingText: string,
  isNewContact: boolean,
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
    if (!matchesTrigger(f.trigger, incomingText, isNewContact)) continue
    const rank = TRIGGER_RANK[f.trigger?.type ?? ""] ?? 0
    if (rank > bestRank) { best = f; bestRank = rank }   // empate mantém o 1º (mais antigo)
  }
  return best
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

const RUN_SELECT = "id, conversation_id, flow_id, flow_version, current_node_id, variables, call_stack, status"

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
  const row = {
    tenant_id: tenantId,
    conversation_id: conversationId,
    flow_id: flow.id,
    flow_version: flow.version,
    current_node_id: startNode?.id ?? null,
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
