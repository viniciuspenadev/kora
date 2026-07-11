import "server-only"
import type { FlowGraph } from "@/lib/ai-v2/flow/types"

// ─────────────────────────────────────────────────────────────────
// Campanha-por-fluxo (§CB) — o fluxo É a campanha e o 1º nó é o TEMPLATE de
// acionamento (regra de compliance: cold-open só via template). Estes helpers
// acham esse opener e o passo seguinte (pra o motor mandar o template a frio e
// o fluxo continuar DEPOIS do opener no engajamento — sem duplicar).
// ─────────────────────────────────────────────────────────────────

/** O nó Template que abre o fluxo (start → template). Null = fluxo não é campaign-ready. */
export function openerTemplateNode(graph: FlowGraph): { nodeId: string; name: string; language: string } | null {
  const start = graph.nodes.find((n) => n.type === "start")
  if (!start) return null
  const firstEdge = graph.edges.find((e) => e.from === start.id)
  const opener = firstEdge ? graph.nodes.find((n) => n.id === firstEdge.to) : null
  if (!opener || opener.type !== "template") return null
  const cfg = (opener.config ?? {}) as { name?: string; language?: string }
  if (!cfg.name?.trim()) return null
  return { nodeId: opener.id, name: cfg.name.trim(), language: cfg.language?.trim() || "pt_BR" }
}

/**
 * Acha o nó Template do grafo cujo nome casa com o template que o motor enviou a
 * frio (`campaigns.template_name`). É a âncora ROBUSTA pra retomar DEPOIS do opener:
 * não depende da posição (start → template), então sobrevive à edição do fluxo
 * (inserir/reordenar nós antes do template) — evita reenviar o template no engajamento.
 */
export function templateNodeByName(graph: FlowGraph, templateName: string): string | null {
  const want = templateName.trim().toLowerCase()
  if (!want) return null
  const node = graph.nodes.find((n) => {
    if (n.type !== "template") return false
    const cfg = (n.config ?? {}) as { name?: string }
    return (cfg.name ?? "").trim().toLowerCase() === want
  })
  return node?.id ?? null
}

/** Nó seguinte a um nó (aresta default) — usado pra retomar o fluxo DEPOIS do opener. */
export function nodeAfter(graph: FlowGraph, nodeId: string): string | null {
  return graph.edges.find((e) => e.from === nodeId && !e.branch)?.to
    ?? graph.edges.find((e) => e.from === nodeId)?.to
    ?? null
}
