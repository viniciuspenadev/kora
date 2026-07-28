// ═══════════════════════════════════════════════════════════════
// Fonte ÚNICA de "esse tenant tem IA ATIVA agora?"
// ═══════════════════════════════════════════════════════════════
// = tem o MÓDULO (god mode) E o master switch (ai_enabled) ligado.
// O dispatcher já faz isso na ENTRADA (módulo → motor; motor checa
// ai_enabled). Esta função leva a MESMA regra aos caminhos LATERAIS
// (cron de resume, fail-safe das políticas de atendimento) — pra
// "desabilitar = parar de verdade, em qualquer caminho".

import "server-only"
import { hasModule } from "@/lib/modules"

export async function tenantAiActive(tenantId: string): Promise<boolean> {
  // Controle = MÓDULO do Studio (o toggle ai_enabled do tenant saiu em 2026-07-18).
  //
  // O ramo do v1 (ai_atendente + ai_config.ai_enabled) foi REMOVIDO junto com o motor
  // v1 (§F2/R1 do plano). Mantê-lo abriria um buraco real: a conversa nasceria/reabriria
  // com ai_handling=true (seed em inbound-conversation/site/conversation-dedup), o
  // dispatch devolveria `skipped` (ninguém responde) E a rede de inatividade a excluiria
  // (atendimento/inactivity filtra ai_handling=false) → cliente esperando pra sempre.
  return hasModule(tenantId, "ai_studio")
}
