// ═══════════════════════════════════════════════════════════════
// describeNode — descritor SEMÂNTICO de um nó de destino (derivação de saídas)
// ═══════════════════════════════════════════════════════════════
// Ideia do owner (2026-07-25): a SAÍDA do Agente IA não precisa de rótulo digitado —
// o NÓ ligado nela já diz o que ela significa (ligou no Agendar = "Agendar horário").
// FONTE ÚNICA: o mesmo descritor alimenta a IA (o rótulo que ela copia no finish_step,
// via runtime → outcomeChoices) E o espelho na config. Rótulo manual continua vencendo
// (override). "" = sem destino → o outcomeChoices cai no posicional "Saída N".
//
// Puro (sem server-only) — importável pelo runtime E pelo editor/config no client.

import type { FlowGraph, FlowNode, FlowNodeType } from "./types"

/** Nós de PASSAGEM: têm 1 saída default e só executam efeito colateral → o rótulo
 *  real é o do PRÓXIMO nó com significado (mensagem/mídia entram porque não são um
 *  "resultado conversacional" — são um passo antes do destino de verdade). */
const TRANSPARENT: ReadonlySet<FlowNodeType> =
  new Set<FlowNodeType>(["set_variable", "wait", "http", "message", "send_media"])

export interface DescribeCtx {
  /** call_flow: resolve flowId → nome do fluxo. Editor passa a lista `flows`; runtime,
   *  um lookup (degrada pra "Sub-fluxo" se ausente — não quebra). */
  flowName?: (id: string) => string | undefined
}

/**
 * Descritor semântico de um nó DESTINO (tipo + config). Atravessa nós de passagem
 * (até o 1º com significado). Devolve "" quando não há destino (o chamador decide o
 * posicional). Guardado por `depth` contra ciclo de passagem.
 */
export function describeNode(node: FlowNode | null | undefined, graph: FlowGraph, ctx: DescribeCtx = {}, depth = 0): string {
  if (!node) return ""
  // Passagem: anda pro 1º nó com significado — SÓ por aresta default (branch vazio).
  if (TRANSPARENT.has(node.type) && depth < 6) {
    const def = graph.edges.find((e) => e.from === node.id && !e.branch)
    if (def) {
      const d = describeNode(graph.nodes.find((n) => n.id === def.to), graph, ctx, depth + 1)
      if (d) return d
    }
    // sem próximo → descreve o próprio nó (fallbacks abaixo)
  }
  const c = (node.config ?? {}) as Record<string, unknown>
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "")
  switch (node.type) {
    case "schedule":       return "Agendar horário"
    case "transfer":       return s(c.target) === "owner" ? "Transferir → responsável"
                                : s(c.target) === "pool"  ? "Transferir → fila"
                                : s(c.target) === "agent" ? "Transferir → atendente"
                                : s(c.department) ? `Transferir → ${s(c.department)}` : "Transferir"
    case "call_flow":      return ctx.flowName?.(s(c.flowId)) || (s(c.mode) === "goto" ? "Ir para fluxo" : "Sub-fluxo")
    case "resolve":        return "Encerrar conversa"
    case "end":            return "Fim"
    case "return":         return "Voltar ao fluxo"
    case "tag":            return `${s(c.action) === "remove" ? "Remover" : "Etiquetar"}${s(c.tag) ? ` "${s(c.tag)}"` : " etiqueta"}`
    case "move_stage":     return s(c.stage) ? `Mover para ${s(c.stage)}` : "Mover etapa"
    case "template":       return s(c.name) ? `Enviar template ${s(c.name)}` : "Enviar template"
    case "outreach":       return "Disparar no WhatsApp"
    case "ai_agent":       return s(c.instruction).slice(0, 60) || "Agente IA"
    case "ai_router":      return "Roteador IA"
    case "menu":           return "Menu de opções"
    case "assign":         return "Distribuir"
    case "collect":        return "Coletar dado"
    case "condition":      return "Condição"
    case "switch":         return "Ramificar por valor"
    case "business_hours": return "Verifica horário"
    case "message":        return "Enviar mensagem"
    case "send_media":     return "Enviar mídia"
    default:               return ""
  }
}

/** Nó de destino de um outcome (aresta cujo branch = outcome.id), ou null se não ligado. */
export function outcomeTarget(graph: FlowGraph, nodeId: string, outcomeId: string): FlowNode | null {
  const e = graph.edges.find((x) => x.from === nodeId && x.branch === outcomeId)
  return e ? graph.nodes.find((n) => n.id === e.to) ?? null : null
}

/** Rótulo efetivo de um outcome: label manual (override) → derivado do destino → "". */
export function outcomeLabel(graph: FlowGraph, nodeId: string, outcome: { id: string; label?: string }, ctx: DescribeCtx = {}): string {
  return outcome.label?.trim() || describeNode(outcomeTarget(graph, nodeId, outcome.id), graph, ctx)
}
