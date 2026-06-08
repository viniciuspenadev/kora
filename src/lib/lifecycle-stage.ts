// ═══════════════════════════════════════════════════════════════
// Acoplamento Pipeline → Lifecycle do CONTATO (fonte única)
// ═══════════════════════════════════════════════════════════════
// Cada etapa do pipeline "representa" um estado do lifecycle do contato.
// Hoje deriva das flags que já existem na etapa (is_triage/is_won/is_lost);
// no futuro vira um mapa configurável por-tenant (mesma assinatura).
// Usado pelo kanban (mover card) E pela IA (capacidade move_stage) — o
// MESMO lugar, sem drift. Pensado pra N pipelines: deriva por etapa.

export type ContactLifecycle = "contact" | "lead" | "won" | "lost" | "unfit"

export interface StageFlags {
  is_triage?: boolean | null
  is_won?:    boolean | null
  is_lost?:   boolean | null
}

/** Qual lifecycle uma etapa representa. */
export function lifecycleForStage(stage: StageFlags): ContactLifecycle {
  if (stage.is_won)    return "won"
  if (stage.is_lost)   return "lost"
  if (stage.is_triage) return "contact"
  return "lead" // etapa de trabalho (Lead/Qualificado/Proposta…)
}

// Escada de progresso pra regra "nunca rebaixa". won = topo; lost/unfit são
// terminais (rank 0 — não bloqueiam reabertura pra lead).
const RANK: Record<ContactLifecycle, number> = {
  contact: 0, lead: 1, won: 2, lost: 0, unfit: 0,
}

/**
 * Decide o lifecycle final ao mover pra uma etapa — NUNCA REBAIXA.
 *  • won/lost = conclusão explícita do deal → sempre aplicam (decisão clara).
 *  • na escada (contact→lead→won), só promove; cliente não volta a lead só
 *    por entrar num funil novo.
 * Retorna null se nada muda (pra o caller evitar update desnecessário).
 */
export function resolveLifecycle(current: string | null | undefined, stage: StageFlags): ContactLifecycle | null {
  const cur = (current ?? "contact") as ContactLifecycle
  const target = lifecycleForStage(stage)
  const next = (target === "won" || target === "lost")
    ? target
    : (RANK[cur] >= RANK[target] ? cur : target)
  return next === cur ? null : next
}
