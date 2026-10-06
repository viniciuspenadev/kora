// ═══════════════════════════════════════════════════════════════
// Formulário → Studio: o que pode rodar ANTES de existir conversa (puro)
// ═══════════════════════════════════════════════════════════════
// Quem enviou o formulário ainda não falou com a empresa: não há conversa, então nada pode
// ESPERAR resposta nem FALAR com a pessoa até o Disparar no WhatsApp abrir o fio
// (docs/forms-design.md §4.3). Uma regra só: o motor (`runFormEntry`) só executa estes nós,
// e a publicação (`validateFormFlowPublish`) recusa o fluxo que puser outro no caminho.

import { NODE_TITLE } from "./node-titles"
import type { FlowGraph, FlowNode, FlowNodeType, OutreachNodeConfig } from "./types"

/** Rodam na hora, sem conversa e sem mensagem para a pessoa. */
export const PRE_CONVERSATION_NODES: ReadonlySet<FlowNodeType> = new Set<FlowNodeType>([
  "start", "condition", "switch", "set_variable", "business_hours", "tag", "http", "outreach", "end", "return",
])

/** Saídas do Disparar em que NADA foi enviado — o fluxo segue sem conversa por elas. */
const NOT_SENT = ["no_whatsapp", "blocked"] as const

/**
 * Nós alcançados antes de existir conversa: do Início em diante, atravessando o Disparar só
 * pelas saídas de "não enviou". A saída PADRÃO do Disparar (sem rótulo) entra quando alguma
 * dessas não tem ligação própria — o motor usa a padrão para qualquer resultado sem ligação
 * (`edgeTarget`), inclusive "Sem WhatsApp".
 */
export function preConversationNodes(graph: FlowGraph): FlowNode[] {
  const start = graph.nodes.find((n) => n.type === "start") ?? graph.nodes[0]
  if (!start) return []
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const seen = new Set<string>()
  const out: FlowNode[] = []
  const queue = [start.id]
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const node = byId.get(id)
    if (!node) continue
    out.push(node)
    const edges = graph.edges.filter((e) => e.from === id)
    for (const e of edges) {
      if (node.type === "outreach") {
        const branch = e.branch ?? ""
        if (branch === "sent") continue                                   // vai para a conversa do WhatsApp
        if (branch && !(NOT_SENT as readonly string[]).includes(branch)) continue
        if (!branch && NOT_SENT.every((b) => edges.some((x) => x.branch === b))) continue
      }
      queue.push(e.to)
    }
  }
  return out
}

/** O número serve ao tipo escolhido no Disparar? (oficial = meta_cloud · comum = baileys · automático = qualquer) */
export function outreachInstanceFits(provider: string | null | undefined, channel: string): boolean {
  if (channel === "official") return provider === "meta_cloud"
  if (channel === "baileys") return provider === "baileys"
  return provider === "meta_cloud" || provider === "baileys"
}

/**
 * Por qual número o Disparar sai — o MESMO critério do envio (`pickInstance`): o escolhido no
 * nó; senão o do tipo (no automático, o oficial primeiro), o mais antigo. `ambiguous` = há
 * mais de um candidato e ninguém escolheu (o fluxo de formulário exige a escolha).
 */
export function resolveOutreachInstance<T extends { id: string; provider: string | null }>(
  cfg: Pick<OutreachNodeConfig, "channel" | "instanceId">, oldestFirst: readonly T[],
): { instance: T | null; ambiguous: boolean; missing: boolean } {
  if (cfg.instanceId) {
    const inst = oldestFirst.find((i) => i.id === cfg.instanceId) ?? null
    return { instance: inst, ambiguous: false, missing: !inst }
  }
  const channel = cfg.channel ?? "auto"
  const fits = oldestFirst.filter((i) => outreachInstanceFits(i.provider, channel))
  const pool = channel === "auto" && fits.some((i) => i.provider === "meta_cloud") ? fits.filter((i) => i.provider === "meta_cloud") : fits
  return { instance: pool[0] ?? null, ambiguous: pool.length > 1, missing: false }
}

/** O Disparar tem com o que chamar? (o que depende dos números da empresa a publicação confere) */
export function outreachContentProblem(cfg: OutreachNodeConfig): string | null {
  const hasText = !!cfg.text?.trim()
  const hasTemplate = !!cfg.template?.name?.trim()
  if (cfg.channel === "official" && !hasTemplate) return "O Disparar no WhatsApp usa o número oficial: escolha um modelo aprovado — a Meta só aceita modelo para chamar quem ainda não falou com você."
  if (cfg.channel === "baileys" && !hasText) return "Escreva a mensagem do Disparar no WhatsApp."
  if ((cfg.channel ?? "auto") === "auto" && !hasText && !hasTemplate) return "Escreva a mensagem (número comum) ou escolha um modelo aprovado (número oficial) no Disparar no WhatsApp."
  return null
}

/** O que impede um fluxo de formulário de rodar como desenhado (vazio = pode publicar). */
export function formFlowProblems(graph: FlowGraph): string[] {
  const problems: string[] = []
  for (const n of preConversationNodes(graph)) {
    if (!PRE_CONVERSATION_NODES.has(n.type)) {
      problems.push(`Quem enviou o formulário ainda não falou com você: o nó ${NODE_TITLE[n.type] ?? n.type} só pode vir depois do Disparar no WhatsApp, na saída “Enviado”.`)
    } else if (n.type === "outreach") {
      const p = outreachContentProblem(n.config as unknown as OutreachNodeConfig)
      if (p) problems.push(p)
    }
  }
  return [...new Set(problems)]
}
