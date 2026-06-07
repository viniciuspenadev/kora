// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — DISPATCH v1/v2 (único ponto de decisão)
// ═══════════════════════════════════════════════════════════════
// Toda entrada de mensagem que aciona automação passa por aqui (em vez
// de chamar runAITurn direto). Decide o motor pelo MÓDULO do tenant:
//   • tem ai_studio (v2)  → runStudioTurn  (Kora Studio)
//   • senão               → runAITurn      (v1 Atendente IA, congelado)
//
// Cutover por-tenant = ligar o módulo ai_studio no god mode. Enquanto
// nenhum tenant tem o módulo, este shim é passthrough puro pro v1 →
// zero mudança de comportamento. Mutuamente exclusivos (doc §7).

import "server-only"
import { hasModule } from "@/lib/modules"
import { runAITurn, type RunAITurnInput, type RunAITurnResult } from "@/lib/ai/run"
import { runStudioTurn } from "./run"

export async function routeAutomationTurn(input: RunAITurnInput): Promise<RunAITurnResult> {
  if (await hasModule(input.tenantId, "ai_studio")) {
    return runStudioTurn(input)
  }
  return runAITurn(input)
}
