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
export type Orientation = "vertical" | "horizontal"

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
  schedule:  () => ({ target: { mode: "fixed" }, intro: "Escolha o melhor horário:", maxSlots: 6, horizonDays: 21 }),
  ai_agent:  () => ({ instruction: "", collect: [], outcomes: [] }),
  ai_router: () => ({ instruction: "", routes: [{ id: genId(), label: "Vendas", description: "quer comprar / contratar" }], fallback: "" }),
  call_flow: () => ({ flowId: "", mode: "subflow" }),
  template:   () => ({ name: "", language: "pt_BR", params: [] }),
  tag:        () => ({ tag: "", action: "add" }),
  move_stage: () => ({ stage: "" }),
  assign:     () => ({}),
  transfer:  () => ({ department: "", summary: "", handoff: "" }),
  resolve:   () => ({}),
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
    type:         "deletable",
  }))
  return { nodes, edges }
}

export function fromRF(nodes: RFNode[], edges: RFEdge[], orientation: Orientation = "vertical"): FlowGraph {
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
    ...(orientation === "horizontal" ? { orientation } : {}), // vertical é default → não polui o JSON
  }
}

// Re-arranja os nós em camadas (longest-path do start) pra a orientação dada.
// Chamado ao alternar horizontal⇄vertical — senão um fluxo montado na vertical
// fica com as linhas torcidas ao virar horizontal. O usuário ainda pode arrastar.
export function autoLayout(nodes: RFNode[], edges: RFEdge[], orientation: Orientation): RFNode[] {
  const out   = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  for (const n of nodes) indeg.set(n.id, 0)
  for (const e of edges) {
    if (!indeg.has(e.source) || !indeg.has(e.target)) continue
    out.set(e.source, [...(out.get(e.source) ?? []), e.target])
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
  }
  // Kahn + longest-path → profundidade (camada) de cada nó.
  const depth = new Map<string, number>()
  const ind   = new Map(indeg)
  const queue: string[] = []
  for (const n of nodes) if ((ind.get(n.id) ?? 0) === 0) { queue.push(n.id); depth.set(n.id, 0) }
  while (queue.length) {
    const u  = queue.shift()!
    const du = depth.get(u) ?? 0
    for (const v of out.get(u) ?? []) {
      depth.set(v, Math.max(depth.get(v) ?? 0, du + 1))
      const d = (ind.get(v) ?? 0) - 1
      ind.set(v, d)
      if (d === 0) queue.push(v)
    }
  }
  for (const n of nodes) if (!depth.has(n.id)) depth.set(n.id, 0) // ciclo defensivo

  const byDepth = new Map<number, RFNode[]>()
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0
    byDepth.set(d, [...(byDepth.get(d) ?? []), n])
  }
  const horizontal = orientation === "horizontal"
  const MAIN  = horizontal ? 340 : 190   // distância entre camadas
  const CROSS = horizontal ? 150 : 290   // distância entre irmãos da mesma camada
  const result: RFNode[] = []
  for (const [d, group] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    // ordem estável: preserva a posição relativa atual no eixo cruzado
    group.sort((a, b) => (horizontal ? a.position.y - b.position.y : a.position.x - b.position.x))
    group.forEach((n, i) => {
      const main  = d * MAIN + 40
      const cross = i * CROSS + 40
      result.push({ ...n, position: horizontal ? { x: main, y: cross } : { x: cross, y: main } })
    })
  }
  return result
}
