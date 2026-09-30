// ═══════════════════════════════════════════════════════════════
// Acoplamento Pipeline → Lifecycle do CONTATO (fonte única)
// ═══════════════════════════════════════════════════════════════
// Cada etapa do pipeline "representa" um estado do lifecycle do contato.
// Hoje deriva das flags que já existem na etapa (is_triage/is_won/is_lost);
// no futuro vira um mapa configurável por-tenant (mesma assinatura).
// Usado pelo kanban (mover card) E pela IA (capacidade move_stage) — o
// MESMO lugar, sem drift. Pensado pra N pipelines: deriva por etapa.

// Eixo de RELACIONAMENTO do contato (decisão 2026-06-20, doc §5). O desfecho
// won/lost é do NEGÓCIO, não da pessoa. `won`/`lost` legados são tolerados na
// leitura (normalize) até a migração won→customer/lost→lead.
export type ContactLifecycle = "contact" | "lead" | "customer" | "unfit"

export interface StageFlags {
  is_triage?: boolean | null
  is_won?:    boolean | null
  is_lost?:   boolean | null
}

/** Normaliza o valor cru (inclui legado pré-migração). */
export function normalizeLifecycle(s: string | null | undefined): ContactLifecycle {
  switch (s) {
    case "won":      return "customer"   // legado: ganhou = é cliente
    case "lost":     return "lead"       // legado: perder não marca a pessoa
    case "lead":
    case "customer":
    case "unfit":
    case "contact":  return s
    default:         return "contact"
  }
}

/**
 * Qual relacionamento uma etapa representa. `null` = etapa sem implicação no
 * contato (perdido — é eixo do negócio, não marca a pessoa).
 */
export function lifecycleForStage(stage: StageFlags): ContactLifecycle | null {
  if (stage.is_won)    return "customer" // ganhou → vira cliente
  if (stage.is_lost)   return null       // perder NÃO rebaixa o contato
  if (stage.is_triage) return "contact"
  return "lead" // etapa de trabalho (Lead/Qualificado/Proposta…)
}

// Escada de progresso pra regra "nunca rebaixa". customer = topo (Sempre Cliente).
const RANK: Record<ContactLifecycle, number> = {
  contact: 0, lead: 1, customer: 2, unfit: 0,
}

/**
 * Decide o lifecycle final ao mover pra uma etapa — NUNCA REBAIXA.
 *  • won → customer (sempre promove pra cliente; topo da escada).
 *  • lost → null (não toca o contato; o motivo vive no negócio/conversa).
 *  • escada (contact→lead→customer), só promove.
 * Retorna null se nada muda (pra o caller evitar update desnecessário).
 */
export function resolveLifecycle(current: string | null | undefined, stage: StageFlags): ContactLifecycle | null {
  const cur = normalizeLifecycle(current)
  const target = lifecycleForStage(stage)
  if (target === null) return null  // perdido → não mexe na pessoa
  const next = target === "customer" ? "customer" : (RANK[cur] >= RANK[target] ? cur : target)
  return next === cur ? null : next
}
