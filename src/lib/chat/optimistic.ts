// ═══════════════════════════════════════════════════════════════
// Bolha provisória (envio otimista) × mensagem real — regra ÚNICA
// ═══════════════════════════════════════════════════════════════
// O inbox mostra a mensagem na hora com id `temp-…` e depois a troca pela real. A real chega por
// DOIS caminhos, em qualquer ordem: a resposta do envio e o tempo real (Realtime). Se as duas não
// se reconhecem, sobra uma bolha fantasma "no relógio" até a próxima atualização da tela.
//
// 🔴 Achado em prod (30/09/2026): com assinatura ligada, o texto GRAVADO é `*Nome*\n\n` + texto;
//    a provisória tem só o texto. Quando o tempo real chegava antes da resposta do envio, a
//    comparação por texto falhava e a mensagem entrava duplicada.

import type { ChatMessage } from "@/types/chat"
import { signatureBody } from "@/lib/atendimento/agent-signature"

const MATCH_WINDOW_MS = 30_000
const text = (content: string | null | undefined) => content ?? ""

/** A mensagem real que chegou por tempo real é a confirmação desta bolha provisória? */
export function matchesOptimistic(temp: ChatMessage, real: ChatMessage): boolean {
  if (!temp.id.startsWith("temp-") || temp.sender_type !== real.sender_type) return false
  if (temp.sender_id && real.sender_id && temp.sender_id !== real.sender_id) return false
  const shown = text(temp.content)
  const stored = text(real.content)
  // O servidor pode ter posto a assinatura na frente: compara também sem ela.
  if (shown !== stored && shown !== signatureBody(stored, real.metadata)) return false
  return Math.abs(new Date(temp.created_at).getTime() - new Date(real.created_at).getTime()) < MATCH_WINDOW_MS
}

/**
 * Resposta do envio chegou: a provisória vira a real. Se a real JÁ está na tela (o tempo real
 * chegou antes e não a reconheceu), a provisória só sai — nunca ficam duas com o mesmo id.
 */
export function confirmOptimistic(list: ChatMessage[], tempId: string, confirmed: Partial<ChatMessage> & { id: string }): ChatMessage[] {
  if (list.some((m) => m.id === confirmed.id)) return list.filter((m) => m.id !== tempId)
  return list.map((m) => (m.id === tempId ? { ...m, ...confirmed } : m))
}
