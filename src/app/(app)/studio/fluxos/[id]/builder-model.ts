// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — modelo do BUILDER (intermediário ⇄ grafo)
// ═══════════════════════════════════════════════════════════════
// O editor trabalha num modelo amigável (intro + leaf) e converte
// pra/from o FlowGraph (formato que o runtime executa) no load/save.
// Puro, sem server-only — usável no client. Cobre o padrão do mockup:
// mensagens de abertura → (menu roteando p/ terminais | terminal direto).
// Condição e menus aninhados = evolução futura (o runtime já suporta).

import type {
  FlowGraph, FlowNode, FlowEdge,
  MessageNodeConfig, MenuNodeConfig, TransferNodeConfig,
} from "@/lib/ai-v2/flow/types"

export type Terminal =
  | { kind: "ai_agent" }
  | { kind: "transfer"; department: string; summary?: string; handoff?: string }
  | { kind: "end"; message?: string }

export interface BuilderMenuOption { id: string; label: string; terminal: Terminal }

export type Leaf =
  | { kind: "menu"; text: string; noMatch?: string; options: BuilderMenuOption[] }
  | { kind: "terminal"; terminal: Terminal }

export interface BuilderFlow {
  intro: string[]
  leaf:  Leaf
}

export function genId(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `n_${Math.random().toString(36).slice(2)}`)
}

export function emptyBuilder(): BuilderFlow {
  return { intro: [], leaf: { kind: "terminal", terminal: { kind: "ai_agent" } } }
}

// ── helpers de leitura tipada de config (sem `any`) ─────────────
function asMessage(n: FlowNode): MessageNodeConfig { return n.config as unknown as MessageNodeConfig }
function asMenu(n: FlowNode): MenuNodeConfig { return n.config as unknown as MenuNodeConfig }
function asTransfer(n: FlowNode): TransferNodeConfig { return n.config as unknown as TransferNodeConfig }

// ── Builder → Graph ─────────────────────────────────────────────
function terminalSub(t: Terminal): { nodes: FlowNode[]; edges: FlowEdge[]; entryId: string } {
  if (t.kind === "ai_agent") {
    const id = genId()
    return { nodes: [{ id, type: "ai_agent", config: {} }], edges: [], entryId: id }
  }
  if (t.kind === "transfer") {
    const id = genId()
    return {
      nodes: [{ id, type: "transfer", config: { department: t.department, summary: t.summary ?? "", handoff: t.handoff ?? "" } }],
      edges: [], entryId: id,
    }
  }
  if (t.message?.trim()) {
    const mid = genId(); const eid = genId()
    return {
      nodes: [{ id: mid, type: "message", config: { text: t.message.trim() } }, { id: eid, type: "end", config: {} }],
      edges: [{ from: mid, to: eid }], entryId: mid,
    }
  }
  const id = genId()
  return { nodes: [{ id, type: "end", config: {} }], edges: [], entryId: id }
}

export function toGraph(b: BuilderFlow): FlowGraph {
  const nodes: FlowNode[] = [{ id: "start", type: "start", config: {} }]
  const edges: FlowEdge[] = []
  let prev = "start"
  const link = (to: string) => { edges.push({ from: prev, to }); prev = to }

  for (const text of b.intro) {
    if (!text.trim()) continue
    const id = genId()
    nodes.push({ id, type: "message", config: { text: text.trim() } })
    link(id)
  }

  if (b.leaf.kind === "menu") {
    const menuId = genId()
    nodes.push({
      id: menuId, type: "menu",
      config: { text: b.leaf.text, options: b.leaf.options.map((o) => ({ id: o.id, label: o.label })), noMatch: b.leaf.noMatch ?? "" },
    })
    link(menuId)
    for (const o of b.leaf.options) {
      const sub = terminalSub(o.terminal)
      nodes.push(...sub.nodes)
      edges.push(...sub.edges)
      edges.push({ from: menuId, to: sub.entryId, branch: o.id })
    }
  } else {
    const sub = terminalSub(b.leaf.terminal)
    nodes.push(...sub.nodes)
    edges.push(...sub.edges)
    edges.push({ from: prev, to: sub.entryId })
  }
  return { nodes, edges }
}

// ── Graph → Builder (best-effort; fluxos nascem do builder) ─────
export function fromGraph(g: FlowGraph): BuilderFlow {
  const byId = new Map<string, FlowNode>(g.nodes.map((n) => [n.id, n]))
  const defEdge = (from: string) => g.edges.find((e) => e.from === from && (e.branch == null || e.branch === ""))

  const terminalFromNode = (node: FlowNode | null): Terminal => {
    if (!node) return { kind: "end" }
    if (node.type === "ai_agent") return { kind: "ai_agent" }
    if (node.type === "transfer") {
      const c = asTransfer(node)
      return { kind: "transfer", department: c.department ?? "", summary: c.summary, handoff: c.handoff }
    }
    if (node.type === "message") return { kind: "end", message: asMessage(node).text ?? "" }
    return { kind: "end" }
  }

  const intro: string[] = []
  let cur = "start"

  for (let guard = 0; guard < 100; guard++) {
    const e = defEdge(cur)
    if (!e) break
    const node = byId.get(e.to)
    if (!node) break

    if (node.type === "message") {
      const ne = defEdge(node.id)
      const next = ne ? byId.get(ne.to) ?? null : null
      if (next?.type === "end") {
        return { intro, leaf: { kind: "terminal", terminal: { kind: "end", message: asMessage(node).text ?? "" } } }
      }
      intro.push(asMessage(node).text ?? "")
      cur = node.id
      continue
    }

    if (node.type === "menu") {
      const cfg = asMenu(node)
      const options: BuilderMenuOption[] = (cfg.options ?? []).map((o) => {
        const be = g.edges.find((x) => x.from === node.id && x.branch === o.id)
        return { id: o.id, label: o.label, terminal: terminalFromNode(be ? byId.get(be.to) ?? null : null) }
      })
      return { intro, leaf: { kind: "menu", text: cfg.text ?? "", noMatch: cfg.noMatch, options } }
    }

    return { intro, leaf: { kind: "terminal", terminal: terminalFromNode(node) } }
  }

  return { intro, leaf: { kind: "terminal", terminal: { kind: "ai_agent" } } }
}
