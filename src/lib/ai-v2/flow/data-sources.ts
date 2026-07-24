import "server-only"
import type { FlowGraph, DataSourceNodeConfig } from "./types"
import type { ToolConfig } from "../capabilities/types"
import { CONSULT_APPOINTMENTS, CONSULT_DEALS, CONSULT_QUOTES } from "../capabilities"

// ═══════════════════════════════════════════════════════════════
// Fonte de Consulta → tools do Agente IA (docs/studio-data-source-node-design.md)
// ═══════════════════════════════════════════════════════════════
// Um nó `data_source` conecta ao Agente IA por uma aresta { from: fonte, to: agente }.
// Aqui, dado o graph + o id do nó de IA, resolvemos as Fontes ligadas nele e
// derivamos: quais tools de consulta liberar + a governança de campos (toolConfig).
// A régua 🔴 Nunca NÃO mora aqui — é imposta no server (consult.ts); esta função só
// carrega o que o autor LIBEROU (🟢 implícito + 🔵 ligados + custom fields).

const SOURCE_TOOL: Record<string, string> = {
  agenda: CONSULT_APPOINTMENTS,
  deals:  CONSULT_DEALS,
  quotes: CONSULT_QUOTES,
}

/** Tools + toolConfig derivados das Fontes de Consulta conectadas a `agentNodeId`. */
export function resolveConnectedSources(
  graph: FlowGraph, agentNodeId: string,
): { tools: string[]; toolConfig: ToolConfig } {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const tools: string[] = []
  const toolConfig: ToolConfig = {}
  for (const e of graph.edges) {
    if (e.to !== agentNodeId) continue
    const src = byId.get(e.from)
    if (!src || src.type !== "data_source") continue
    const cfg = src.config as unknown as DataSourceNodeConfig
    const toolId = SOURCE_TOOL[cfg.source]
    if (!toolId) continue
    tools.push(toolId)
    // `__src` marca "governado por Fonte" → consult.ts usa o modelo de campos NOVO
    // (opt-in). Sem ele = config inline legada (defaults antigos). Campos 🔵 ligados
    // (fields) + custom fields (Negócios).
    toolConfig[toolId] = {
      __src: true,
      ...(cfg.fields ?? {}),
      ...(cfg.customFields?.length ? { customFields: cfg.customFields } : {}),
    }
  }
  return { tools: [...new Set(tools)], toolConfig }
}
