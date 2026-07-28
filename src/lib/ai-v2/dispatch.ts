// ═══════════════════════════════════════════════════════════════
// Kora Studio — DISPATCH da automação (único ponto de decisão)
// ═══════════════════════════════════════════════════════════════
// Toda entrada de mensagem que aciona automação passa por aqui. Regra:
//   • tem o módulo ai_studio → runStudioTurn (Kora Studio)
//   • senão                  → SEM automação (skipped)
//
// O motor v1 ("Atendente IA") era o fallback deste ponto e foi REMOVIDO
// (docs/ai-v1-removal-plan.md §F2). A IA roda EXCLUSIVAMENTE dentro de um
// fluxo, pelo nó Agente IA — não existe auto-atendente global.

import "server-only"
import { hasModule } from "@/lib/modules"
import { supabaseAdmin } from "@/lib/supabase"
import { activeFlowRun } from "./flow/triggers"
import type { RunAITurnInput, RunAITurnResult } from "@/types/automation"
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
  // Sem o módulo do Studio = SEM automação. O fallback pro motor v1 (runAITurn)
  // foi desligado aqui (§F2 do plano). Equivalente em comportamento: o v1 já
  // retornava `skipped` na entrada pra TODOS os tenants (nenhum tem ai_atendente).
  // Os 3 callers (webhook Baileys/Meta + widget do site) tratam `skipped` caindo
  // no dispatchAutomations — mesmo destino de antes.
  return { status: "skipped", reason: "no_automation_module" }
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
  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .update({ ai_handling: false, updated_at: new Date().toISOString() })
    .eq("id", input.conversationId)
    .eq("tenant_id", input.tenantId)
    .select("assigned_to, department_id")
    .maybeSingle()

  // Evento do ciclo (relatórios): a IA devolveu o controle pro humano.
  // to_agent = o dono da carteira que recebe (null = caiu na fila/setor).
  await logConversationEvent({
    tenantId: input.tenantId, conversationId: input.conversationId,
    type: "ai_handback", actorKind: "ai",
    toAgentId:    (conv as { assigned_to: string | null } | null)?.assigned_to ?? null,
    departmentId: (conv as { department_id: string | null } | null)?.department_id ?? null,
  })
}
