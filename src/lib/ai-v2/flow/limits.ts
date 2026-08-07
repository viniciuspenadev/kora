import type { FlowGraph } from "./types"

/**
 * Teto do grafo de fluxo (H-15, auditoria 2026-07-30). `saveFlow`/`publishFlow` gravam o
 * `graph` (JSONB) direto no Postgres e o runtime o desserializa a CADA execução — sem teto,
 * um admin poderia gravar um grafo gigante (até o `bodySizeLimit` global de 100MB), inchando
 * storage, memória de execução e o custo de cada disparo (self-DoS por-tenant, mas real).
 *
 * Fluxo legítimo é KB-scale (dezenas de nós); os tetos abaixo dão ~100x de folga sem estorvar
 * o builder. Pura (sem I/O), usável no client tb p/ feedback inline — `TextEncoder` roda nos dois.
 */
export const FLOW_GRAPH_LIMITS = {
  maxNodes:           300,
  maxEdges:           600,
  maxSerializedBytes: 512 * 1024,
} as const

/** Retorna mensagem de erro (pt-BR) se o grafo estourar algum teto, ou `null` se ok. */
export function checkFlowGraphLimits(graph: FlowGraph): string | null {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes.length : 0
  const edges = Array.isArray(graph?.edges) ? graph.edges.length : 0
  if (nodes > FLOW_GRAPH_LIMITS.maxNodes) {
    return `Fluxo muito grande: ${nodes} nós (máx. ${FLOW_GRAPH_LIMITS.maxNodes}). Divida em fluxos menores.`
  }
  if (edges > FLOW_GRAPH_LIMITS.maxEdges) {
    return `Fluxo com conexões demais: ${edges} (máx. ${FLOW_GRAPH_LIMITS.maxEdges}).`
  }
  let bytes: number
  try {
    // Fail-closed: se o graph não serializa (ciclo/BigInt/aninhamento absurdo), é inválido
    // — trata como rejeição amigável em vez de estourar 500 no call site.
    bytes = new TextEncoder().encode(JSON.stringify(graph ?? {})).length
  } catch {
    return "Fluxo inválido (estrutura não serializável)."
  }
  if (bytes > FLOW_GRAPH_LIMITS.maxSerializedBytes) {
    const kb = Math.round(bytes / 1024)
    return `Fluxo excede o tamanho máximo (${kb}KB; máx. ${FLOW_GRAPH_LIMITS.maxSerializedBytes / 1024}KB).`
  }
  return null
}
