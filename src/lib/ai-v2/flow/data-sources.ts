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

// Lista branca de campos 🔵 POR FONTE — imposta no SERVIDOR (gate no banco, não na UI).
// Só estas chaves atravessam pro toolConfig; qualquer outra (ex: uma key 🔴 injetada
// num config adulterado) é DESCARTADA aqui, antes de chegar ao consult.ts. Campos 🔴
// (nome/etapa/previsão/custo/margem…) NÃO têm chave — não existe toggle pra ligá-los.
// ⚠️ Espelha os toggles de DS_OPT_FIELDS (config-panel). includeHistory/includeClosed
// NÃO entram: são só do modo legado inline (a Fonte não expõe histórico/concluídos).
const FIELD_ALLOW: Record<string, ReadonlySet<string>> = {
  agenda: new Set(["professional", "duration"]),
  deals:  new Set(["value", "funnel"]),
  quotes: new Set(["value"]),
}
// customFields só faz sentido em Negócios (e é filtrado por entity="deal" no consult).
const CUSTOM_FIELDS_SOURCES = new Set(["deals"])

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
    // (fields) + custom fields (Negócios) — TODOS passados pela lista branca do server.
    const allow = FIELD_ALLOW[cfg.source] ?? new Set<string>()
    const safeFields: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(cfg.fields ?? {})) {
      // Preserva o boolean EXPLÍCITO (inclusive false): "desligado pelo autor" ≠ "não
      // configurado". Campo com newDflt=true (ex: quotes.value) precisa do false pra
      // respeitar o opt-out — senão o consult.ts reexpõe pelo default (regressão 07-24).
      if (allow.has(k) && typeof v === "boolean") safeFields[k] = v
    }
    const customFields = CUSTOM_FIELDS_SOURCES.has(cfg.source) && cfg.customFields?.length
      ? cfg.customFields.filter((id) => typeof id === "string")
      : []
    toolConfig[toolId] = {
      __src: true,
      ...safeFields,
      ...(customFields.length ? { customFields } : {}),
    }
  }
  return { tools: [...new Set(tools)], toolConfig }
}
