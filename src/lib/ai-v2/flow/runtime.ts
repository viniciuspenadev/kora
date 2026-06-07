// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — RUNTIME do fluxo (máquina de estado)
// ═══════════════════════════════════════════════════════════════
// Dois modos de entrada:
//   • RESUME: a conversa esperava input num menu → parseia, escolhe o
//     branch, e avança.
//   • ADVANCE: caminha o grafo executando nós até esperar input (menu),
//     encaminhar (transfer), delegar (ai_agent), ou terminar (end).
// Estado persistido em studio_flow_runs (1 por conversa). Bounded por
// MAX_HOPS (anti-ciclo). Nós determinísticos não custam LLM; só ai_agent.

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { sendBotText } from "../outbound"
import { getCapability, TRANSFER, type ExecCtx } from "../capabilities"
import { runAgentTurn, type AgentTurnResult } from "../agent"
import type { PersonaInput } from "../prompt"
import { sendMenu, parseMenuReply } from "./menu"
import type {
  FlowGraph, FlowNode, FlowRow, FlowRunRow,
  MessageNodeConfig, MenuNodeConfig, ConditionNodeConfig, TransferNodeConfig,
} from "./types"

const MAX_HOPS = 25

export interface FlowExecInput {
  ctx:          ExecCtx
  model:        string
  persona:      PersonaInput
  history:      { role: "user" | "assistant"; content: string }[]
  incomingText: string
}

export interface FlowResult {
  status:       "responded" | "routed" | "no_action" | "error"
  departmentId: string | null
  error:        string | null
  /** preenchido se um nó ai_agent rodou (pra studio_runs detalhado). */
  agent:        AgentTurnResult | null
}

// ── helpers de grafo ────────────────────────────────────────────
function nodeById(g: FlowGraph, id: string | null): FlowNode | null {
  if (!id) return null
  return g.nodes.find((n) => n.id === id) ?? null
}
function edgeTarget(g: FlowGraph, from: string, branch?: string): string | null {
  // branch específico primeiro; senão a aresta default (sem branch).
  const exact = g.edges.find((e) => e.from === from && e.branch === branch)
  if (exact) return exact.to
  const def = g.edges.find((e) => e.from === from && (e.branch == null || e.branch === ""))
  return def?.to ?? null
}

function evalCondition(node: FlowNode, ctx: ExecCtx): boolean {
  const cfg = node.config as unknown as ConditionNodeConfig
  const c = ctx.contact
  switch (cfg.check) {
    case "has_email":    return !!c.email?.trim()
    case "has_phone":    return !!c.phone_number?.trim()
    case "has_name":     return !!(c.custom_name?.trim() || c.push_name?.trim())
    case "has_document": return !!c.doc_id?.trim()
    default:             return false
  }
}

// ── persistência do estado ──────────────────────────────────────
async function persistRun(
  runId: string,
  fields: { current_node_id: string | null; variables: Record<string, unknown>; status: FlowRunRow["status"] },
): Promise<void> {
  await supabaseAdmin
    .from("studio_flow_runs")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", runId)
}
async function finishRun(runId: string): Promise<void> {
  await supabaseAdmin
    .from("studio_flow_runs")
    .update({ status: "done", updated_at: new Date().toISOString() })
    .eq("id", runId)
}

// ── execução ────────────────────────────────────────────────────
export async function runFlow(input: FlowExecInput, flow: FlowRow, run: FlowRunRow): Promise<FlowResult> {
  const { ctx } = input
  const graph = flow.graph
  const variables = { ...run.variables }
  let currentId: string | null = run.current_node_id
  let responded = false

  // RESUME — estava esperando input num menu.
  if (run.status === "waiting" && currentId) {
    const node = nodeById(graph, currentId)
    if (node?.type === "menu") {
      const cfg = node.config as unknown as MenuNodeConfig
      const picked = parseMenuReply(cfg, input.incomingText)
      if (!picked) {
        await sendBotText(ctx, cfg.noMatch?.trim() || "Não entendi 🤔 Responda com o número da opção:")
        await sendMenu(ctx, cfg)
        await persistRun(run.id, { current_node_id: node.id, variables, status: "waiting" })
        return { status: "responded", departmentId: null, error: null, agent: null }
      }
      variables[`menu:${node.id}`] = picked.id
      currentId = edgeTarget(graph, node.id, picked.id)
    }
  }

  // ADVANCE — caminha o grafo.
  let hops = 0
  while (currentId && hops < MAX_HOPS) {
    hops++
    const node = nodeById(graph, currentId)
    if (!node) break

    switch (node.type) {
      case "start": {
        currentId = edgeTarget(graph, node.id)
        break
      }
      case "message": {
        const cfg = node.config as unknown as MessageNodeConfig
        const text = (cfg.text ?? "").trim()
        if (text) { await sendBotText(ctx, text, { studio_flow: true }); responded = true }
        currentId = edgeTarget(graph, node.id)
        break
      }
      case "condition": {
        const ok = evalCondition(node, ctx)
        currentId = edgeTarget(graph, node.id, ok ? "true" : "false")
        break
      }
      case "menu": {
        const cfg = node.config as unknown as MenuNodeConfig
        await sendMenu(ctx, cfg)
        await persistRun(run.id, { current_node_id: node.id, variables, status: "waiting" })
        return { status: "responded", departmentId: null, error: null, agent: null }
      }
      case "transfer": {
        const cfg = node.config as unknown as TransferNodeConfig
        const cap = getCapability(TRANSFER)
        const r = await cap?.run(ctx, {
          department:      cfg.department,
          summary:         cfg.summary ?? "Encaminhado pelo fluxo.",
          handoff_message: cfg.handoff ?? null,
        })
        await finishRun(run.id)
        if (r?.routedDepartmentId) return { status: "routed", departmentId: r.routedDepartmentId, error: null, agent: null }
        // departamento inválido na config → não encaminhou; deixa o registro pro admin ver.
        return { status: responded ? "responded" : "no_action", departmentId: null, error: r?.error ?? null, agent: null }
      }
      case "ai_agent": {
        const turn = await runAgentTurn(input)
        await finishRun(run.id)
        if (turn.status === "routed")    return { status: "routed", departmentId: turn.departmentId, error: null, agent: turn }
        if (turn.status === "responded") return { status: "responded", departmentId: null, error: null, agent: turn }
        if (turn.status === "error")     return { status: "error", departmentId: null, error: turn.error, agent: turn }
        return { status: responded ? "responded" : "no_action", departmentId: null, error: null, agent: turn }
      }
      case "end": {
        await finishRun(run.id)
        return { status: responded ? "responded" : "no_action", departmentId: null, error: null, agent: null }
      }
      default: {
        currentId = edgeTarget(graph, node.id)
        break
      }
    }
  }

  // Fim implícito (sem próximo nó ou estourou hops).
  await finishRun(run.id)
  return { status: responded ? "responded" : "no_action", departmentId: null, error: null, agent: null }
}
