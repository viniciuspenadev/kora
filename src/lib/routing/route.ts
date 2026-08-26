import "server-only"
import { loadRoutingSnapshot } from "./snapshot"
import { decideRouting } from "./decide"
import { applyRouting, type ApplyResult } from "./apply"
import type { RoutingTrigger } from "./types"

// ═══════════════════════════════════════════════════════════════
// O maestro: fotografa → decide → aplica
// ═══════════════════════════════════════════════════════════════
// É esta função que os pontos de entrada vão passar a chamar, no lugar de decidirem
// posse por conta própria. Enquanto a migração não acontece, ela não tem chamador —
// e é por isso que este lote não muda comportamento de ninguém.

export interface RouteResult {
  /** `false` quando a conversa não existe (ou não é do tenant). */
  found:    boolean
  decision?: ReturnType<typeof decideRouting>
  outcome?:  ApplyResult
}

export async function routeConversation(
  tenantId:       string,
  conversationId: string,
  trigger:        RoutingTrigger,
  opts?: { excludeAgentIds?: string[]; actorId?: string | null },
): Promise<RouteResult> {
  const foto = await loadRoutingSnapshot(tenantId, conversationId)
  if (!foto) return { found: false }

  const decision = decideRouting(foto.snapshot, trigger, { excludeAgentIds: opts?.excludeAgentIds })

  const outcome = await applyRouting(decision, {
    tenantId,
    conversationId,
    observedAssignedTo:   foto.observedAssignedTo,
    observedDepartmentId: foto.observedDepartmentId,
    actorId:              opts?.actorId ?? null,
  })

  // Log estruturado do desfecho — é o que permite responder "por que essa conversa
  // foi (ou não foi) roteada?" sem abrir o banco.
  console.log(JSON.stringify({
    src: "routing", tenant: tenantId, conversa: conversationId,
    gatilho: trigger, decisao: decision.kind, motivo: decision.reason,
    aplicou: outcome.applied, detalhe: outcome.applied ? outcome.agentId : outcome.reason,
  }))

  return { found: true, decision, outcome }
}
