// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — sync canvas (React Flow) ⇄ FlowGraph
// ═══════════════════════════════════════════════════════════════
// O editor canvas trabalha com nós/arestas do React Flow; o runtime
// executa o FlowGraph. Aqui é a ponte 1:1 (nó↔nó, conexão↔aresta,
// handle do menu↔branch). Posição persiste em FlowNode.position
// (o runtime ignora).

import type { Node, Edge } from "@xyflow/react"
import type { FlowGraph, FlowNodeType } from "@/lib/ai-v2/flow/types"

export type RFData = { config: Record<string, unknown> }
export type RFNode = Node<RFData>
export type RFEdge = Edge

export function genId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `n_${Math.random().toString(36).slice(2)}`
}

const DEFAULT_CONFIG: Record<FlowNodeType, () => Record<string, unknown>> = {
  start:     () => ({}),
  message:   () => ({ text: "" }),
  send_media: () => ({ url: "", mediaType: "image", caption: "" }),
  menu:      () => ({ text: "Como posso ajudar?", options: [{ id: genId(), label: "Opção 1" }], noMatch: "" }),
  condition: () => ({ check: "has_phone" }),
  set_variable:   () => ({ assignments: [] }),
  switch:         () => ({ variable: "", cases: [{ id: genId(), equals: "" }] }),
  business_hours: () => ({ days: [1, 2, 3, 4, 5], open: "09:00", close: "18:00", timezone: "America/Sao_Paulo" }),
  wait:           () => ({ amount: 1, unit: "hours" }),
  http:      () => ({ url: "", method: "GET", headers: {}, body: "", saveAs: "http_response" }),
  collect:   () => ({ question: "Qual o seu nome?", saveAs: "resposta", validate: "text" }),
  ai_agent:  () => ({ instruction: "", collect: [], outcomes: [] }),
  ai_router: () => ({ instruction: "", routes: [{ id: genId(), label: "Vendas", description: "quer comprar / contratar" }], fallback: "" }),
  call_flow: () => ({ flowId: "", mode: "subflow" }),
  tag:        () => ({ tag: "", action: "add" }),
  move_stage: () => ({ stage: "" }),
  assign:     () => ({}),
  transfer:  () => ({ department: "", summary: "", handoff: "" }),
  return:    () => ({}),
  end:       () => ({}),
}

export function newRFNode(type: FlowNodeType, position: { x: number; y: number }): RFNode {
  return {
    id:       type === "start" ? "start" : genId(),
    type,
    position,
    data:     { config: DEFAULT_CONFIG[type]() },
  }
}

export function toRF(graph: FlowGraph): { nodes: RFNode[]; edges: RFEdge[] } {
  const nodes: RFNode[] = graph.nodes.map((n, i) => ({
    id:       n.id,
    type:     n.type,
    position: n.position ?? { x: 280, y: 40 + i * 150 },
    data:     { config: n.config ?? {} },
  }))
  const edges: RFEdge[] = graph.edges.map((e) => ({
    id:           `${e.from}:${e.branch ?? ""}:${e.to}`,
    source:       e.from,
    target:       e.to,
    sourceHandle: e.branch || undefined,
  }))
  return { nodes, edges }
}

export function fromRF(nodes: RFNode[], edges: RFEdge[]): FlowGraph {
  return {
    nodes: nodes.map((n) => ({
      id:       n.id,
      type:     (n.type ?? "message") as FlowNodeType,
      config:   (n.data?.config ?? {}) as Record<string, unknown>,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    })),
    edges: edges.map((e) => ({
      from:   e.source,
      to:     e.target,
      branch: e.sourceHandle ?? undefined,
    })),
  }
}
