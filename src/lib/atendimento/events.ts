// ═══════════════════════════════════════════════════════════════
// conversation_events — emissor do log do ciclo de atendimento
// ═══════════════════════════════════════════════════════════════
// Fonte ÚNICA de "registrar um evento do atendimento" (docs/transfer-node-design.md).
// TODO ponto do ciclo (assign, transferência, hand-back, 1ª resposta, plano B,
// resolve, reopen, SLA) chama `logConversationEvent` — os relatórios agregam disso.
//
// FAIL-OPEN por design: uma falha ao logar NUNCA pode quebrar o atendimento.
// O evento é métrica, não gate — se o insert falhar, loga o erro e segue.

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

export type ConversationEventType =
  | "assigned"        // passou a ter dono
  | "unassigned"      // voltou pro pool/fila
  | "transferred"     // encaminhada (setor e/ou atendente)
  | "ai_handback"     // IA devolveu o controle pro humano
  | "first_response"  // 1ª resposta humana
  | "plan_b"          // transfer caiu no fallback
  | "resolved"        // conversa concluída
  | "reopened"        // cliente voltou depois de concluída
  | "sla_breach"      // estourou o SLA
  | "window_expired"  // janela de 24h (canal oficial) venceu sem resposta humana

export type ConversationActorKind = "agent" | "ai" | "system" | "contact"

export interface ConversationEventInput {
  tenantId:       string
  conversationId: string
  type:           ConversationEventType
  /** Quem AGIU. Default 'system'. */
  actorKind?:     ConversationActorKind
  /** profiles.id quando actorKind='agent'. */
  actorId?:       string | null
  /** Transferência: de qual atendente saiu. */
  fromAgentId?:   string | null
  /** Assign/transfer: pra qual atendente foi (sujeito do relatório por atendente). */
  toAgentId?:     string | null
  /** Setor/fila de destino. */
  departmentId?:  string | null
  /** Motivo (transfer / plan_b). */
  reason?:        string | null
  /** Extras livres: duration_ms, plan_b action, sla_target, etc. */
  meta?:          Record<string, unknown>
}

/**
 * Registra um evento do ciclo de atendimento (append-only, pra relatórios).
 * FAIL-OPEN: erro de log é engolido (só console.error) — nunca propaga.
 */
export async function logConversationEvent(e: ConversationEventInput): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("conversation_events").insert({
      tenant_id:       e.tenantId,
      conversation_id: e.conversationId,
      type:            e.type,
      actor_kind:      e.actorKind ?? "system",
      actor_id:        e.actorId ?? null,
      from_agent_id:   e.fromAgentId ?? null,
      to_agent_id:     e.toAgentId ?? null,
      department_id:   e.departmentId ?? null,
      reason:          e.reason ?? null,
      meta:            e.meta ?? {},
    })
    if (error) console.error("[conversation_events] insert falhou:", error.message)
  } catch (err) {
    console.error("[conversation_events] log exception:", err instanceof Error ? err.message : err)
  }
}
