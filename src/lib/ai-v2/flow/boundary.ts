// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — CONTRATO DE FRONTEIRA (deferral por capacidade)
// ═══════════════════════════════════════════════════════════════
// O problema: um nó ai_agent SEM uma tool de ação (ex: agenda) mas com um nó
// DETERMINÍSTICO logo à frente que executa essa ação (ex: schedule). O LLM não
// "sabe" que não tem a ferramenta — ausência de tool tira a mão, não a boca — e
// a persona ("seu papel é marcar horário") é um atrator. Resultado: ele CONDUZ a
// ação (pergunta serviço/dia/hora, crava horário) ou ALUCINA que executou.
//
// A engine fecha o contrato: deriva do GRAFO o que o nó NÃO pode fazer mas existe
// logo ali, e injeta um "anti-playbook" de deferral no prompt (espelho do Playbook
// das capacidades concedidas — Pilar 1, inverso). Genérico por CAPACIDADE (não por
// domínio): hoje "agenda"; amanhã pagamento/coleta = só somar uma entrada aqui.

import type { FlowGraph } from "./types"

/** Conceito de ação que um nó determinístico provê (e a IA pode ter que deferir). */
export type DeferralConcept = "agenda"

/** Tipo de nó determinístico → conceito de ação que ele PROVÊ. */
const NODE_PROVIDES: Partial<Record<string, DeferralConcept>> = {
  schedule: "agenda",
}

/** Tools que, se CONCEDIDAS ao nó, fazem o nó "ter" o conceito (→ não defere). */
const CONCEPT_TOOLS: Record<DeferralConcept, string[]> = {
  agenda: ["check_availability", "schedule_appointment", "reschedule_appointment"],
}

// Fronteira CURTA: só conta o provedor se estiver logo à frente. Mais que isso
// (atrás de várias ramificações) não é "defira agora". E NÃO atravessa outro
// ai_agent — a responsabilidade de deferir seria dele, não deste nó.
const MAX_HOPS = 3

function edgesFrom(graph: FlowGraph, id: string): string[] {
  return graph.edges.filter((e) => e.from === id).map((e) => e.to)
}

/**
 * Conceitos que um nó determinístico alcançável (≤MAX_HOPS) provê E que ESTE nó
 * NÃO possui como tool concedida. Vazio = nada a deferir (o nó conduz normal, ou
 * ele mesmo tem a tool). Determinístico, computado do grafo a cada execução do nó.
 */
export function deferralConcepts(graph: FlowGraph, fromNodeId: string, grantedTools: string[]): DeferralConcept[] {
  const found = new Set<DeferralConcept>()
  const seen  = new Set<string>([fromNodeId])
  let frontier = edgesFrom(graph, fromNodeId)
  for (let hop = 0; hop < MAX_HOPS && frontier.length; hop++) {
    const next: string[] = []
    for (const id of frontier) {
      if (seen.has(id)) continue
      seen.add(id)
      const node = graph.nodes.find((n) => n.id === id)
      if (!node) continue
      const concept = NODE_PROVIDES[node.type]
      if (concept) found.add(concept)
      // não atravessa outro nó de IA (a deferral seria responsabilidade DELE).
      if (node.type === "ai_agent") continue
      next.push(...edgesFrom(graph, id))
    }
    frontier = next
  }
  const granted = new Set(grantedTools)
  return [...found].filter((c) => !CONCEPT_TOOLS[c].some((t) => granted.has(t)))
}

// ── o contrato (anti-playbook) por conceito ────────────────────
// Estrutura (convergência dos dois agentes de design): escopo positivo → gatilho
// de SAÍDA (deferir = CONCLUIR o passo, ação positiva, não "parar de falar") →
// dúvida×execução → auto-detecção que vira trigger de conclusão. Forte o bastante
// pra vencer a persona (injetado como REGRA DURA pós-persona, ver prompt.ts).
const DEFERRAL_TEXT: Record<DeferralConcept, string> = {
  agenda:
`Você NÃO agenda, marca, remarca nem reserva horários — quem faz isso é a etapa de AGENDAMENTO logo a seguir. Não existe "agendar conversando": se você não tem uma ferramenta de agenda nesta mensagem, agendar não é função sua.
Quando o cliente quiser marcar/agendar (mesmo vago: "quero marcar", "como agendo", "pode ser sexta?", "tem horário amanhã?"):
- NÃO pergunte qual serviço, nem dia, nem horário; NÃO sugira nem cite horários; NÃO diga que vai confirmar nem dê a entender que marcou.
- Responda em UMA frase curta de transição e CONCLUA o passo (finish_step). Ex.: "Perfeito! Vou te levar pro agendamento agora pra você escolher certinho." Depois disso, PARE — a próxima etapa coleta serviço e horário do zero, e isso é o correto.
DÚVIDA vs. AGENDAR: se a pergunta se resolve com INFORMAÇÃO (o que é o serviço, preço, duração, se atendem tal dia da semana) → RESPONDA, não conclua. Se só se resolve mexendo na agenda (escolher/reservar um horário real) → CONCLUA o passo. "pode ser sexta?" / "tem às 17h?" NÃO é dúvida, é tentativa de marcar → conclua.
Se você se pegar prestes a perguntar serviço/dia/hora ou a citar um horário, esse é o sinal exato de CONCLUIR o passo com a frase-ponte.`,
}

/** Texto do contrato de deferral pros conceitos dados (vazio = sem contrato). */
export function deferralContract(concepts: DeferralConcept[]): string {
  return concepts.map((c) => DEFERRAL_TEXT[c]).filter(Boolean).join("\n\n")
}
