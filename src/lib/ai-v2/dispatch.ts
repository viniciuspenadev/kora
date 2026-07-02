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
import { supabaseAdmin } from "@/lib/supabase"
import { activeFlowRun } from "./flow/triggers"
import { runAITurn, type RunAITurnInput, type RunAITurnResult } from "@/lib/ai/run"
import { runStudioTurn } from "./run"
import { logConversationEvent } from "@/lib/atendimento/events"

// ═══ Quais CANAIS despacham a IA (verdade do motor, não config) ═══
// Espelha quais pipelines de entrada chamam routeAutomationTurn. Instagram
// ainda NÃO (bot do IG é frente pendente) → conversa de IG nunca nasce/reabre
// "IA atendendo". Quando o bot do IG for ligado, adicionar "instagram" aqui —
// 1 linha, e seed/reopen/painel derivam sozinhos. Config do TENANT (IA ligada,
// fluxos/gatilhos por canal) mora no Studio; isto aqui é só capacidade do motor.
const AI_DISPATCH_CHANNELS = new Set(["whatsapp", "site"])

/** O canal despacha a IA? (null/undefined = whatsapp, default do banco) */
export function channelDispatchesAI(channel: string | null | undefined): boolean {
  return AI_DISPATCH_CHANNELS.has(channel ?? "whatsapp")
}

export async function routeAutomationTurn(input: RunAITurnInput): Promise<RunAITurnResult> {
  if (await hasModule(input.tenantId, "ai_studio")) {
    const result = await runStudioTurn(input)
    await maybeHandBackDecoupled(input, result)
    return result
  }
  return runAITurn(input)
}

/**
 * Hand-back do decouple (só no modo desacoplado, por flag). Se a IA NÃO respondeu
 * E NÃO está conduzindo um fluxo (nada active/waiting dormindo pra retomar), devolve
 * o controle pro humano (`ai_handling=false`) → o próximo turno cai pro atendente e a
 * rede de inatividade volta a valer. Fluxo em curso = a IA ainda conduz → NÃO devolve
 * (senão o gate `!ai_handling` mataria o fluxo no meio).
 */
async function maybeHandBackDecoupled(input: RunAITurnInput, result: RunAITurnResult): Promise<void> {
  if (result.status === "responded") return
  const { data: sc } = await supabaseAdmin
    .from("studio_config").select("ai_control_decoupled").eq("tenant_id", input.tenantId).maybeSingle()
  if (!sc?.ai_control_decoupled) return
  // activeFlowRun já filtra active|waiting — se existe, a IA está no meio de um fluxo.
  if (await activeFlowRun(input.conversationId)) return
  await supabaseAdmin
    .from("chat_conversations")
    .update({ ai_handling: false, updated_at: new Date().toISOString() })
    .eq("id", input.conversationId)
    .eq("tenant_id", input.tenantId)

  // Evento do ciclo (relatórios): a IA devolveu o controle pro humano.
  await logConversationEvent({
    tenantId: input.tenantId, conversationId: input.conversationId,
    type: "ai_handback", actorKind: "ai",
  })
}
