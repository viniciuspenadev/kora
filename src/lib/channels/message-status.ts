/**
 * Regra ÚNICA de transição de status de mensagem enviada (fonte única pros 3 canais:
 * meta_cloud, baileys, instagram). Nunca duplicar inline — sempre importar daqui.
 *
 * **Forward-only.** Webhook de status chega fora de ordem (Meta e Baileys atrasam e
 * reemitem eventos), então um update só pode AVANÇAR. Sem essa trava, um `delivered`
 * atrasado sobrescreve um `read` já aplicado e a bolha "desmarca" sozinha na cara do
 * atendente. A mesma regra já existia inline pra `campaign_recipients` no webhook Meta;
 * a mensagem em si tinha ficado de fora.
 *
 * **Carimbos.** `delivered_at` / `read_at` existem em `chat_messages` desde a migration
 * 20260728_chat_messages_delivery_timestamps. Antes dela o UPDATE inteiro era recusado
 * pelo PostgREST — em silêncio, porque o retorno não era checado.
 */

export type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed"

/** Status ANTERIORES a partir dos quais `next` pode ser aplicado. */
const ALLOWED_FROM: Record<MessageStatus, MessageStatus[]> = {
  pending:   [],
  sent:      ["pending"],
  delivered: ["pending", "sent"],
  read:      ["pending", "sent", "delivered"],
  failed:    ["pending", "sent"],
}

/** Use em `.in("status", allowedFrom(next))` — trava forward-only no próprio WHERE. */
export function allowedFrom(next: MessageStatus): MessageStatus[] {
  return ALLOWED_FROM[next] ?? []
}

/** Patch de status + carimbo de tempo correspondente (delivered_at / read_at). */
export function statusPatch(
  next: MessageStatus,
  at: string = new Date().toISOString(),
): Record<string, unknown> {
  const patch: Record<string, unknown> = { status: next }
  if (next === "delivered") patch.delivered_at = at
  if (next === "read")      patch.read_at      = at
  return patch
}
