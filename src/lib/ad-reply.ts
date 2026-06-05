import type { ExternalAdReply } from "@/types/chat"

/**
 * Blindagem do `external_ad_reply` pra render seguro.
 *
 * O Baileys manda alguns campos como **Buffer/Uint8Array** (ex: `thumbnail`, e
 * em raros casos `ctwaClid`/`ctwaPayload`). Ao serializar pro jsonb, um Buffer
 * vira um objeto de chaves numéricas `{"0":..,"414":..}`. Se esse objeto cair
 * como **filho** de um elemento React (ex: `{ad.ctwaClid}`), estoura o
 * **erro #31** ("Objects are not valid as a React child") e a conversa inteira
 * fica inacessível.
 *
 * Aqui todo campo que o UI renderiza como texto é mantido **só se for string**;
 * qualquer Buffer/objeto é descartado (o render cai no fallback). Campos não-
 * texto (mediaType number, flags boolean) são preservados — eles já têm guarda
 * própria no render. Idempotente e barato. Fonte do bug: o webhook do Baileys
 * gravava o objeto cru; ver também a normalização no webhook.
 */
const STRING_FIELDS = [
  "title", "body", "sourceId", "sourceUrl", "sourceApp", "sourceType",
  "ctwaClid", "ctwaPayload", "mediaUrl", "greetingMessageBody",
  "thumbnail", "thumbnailUrl", "originalImageUrl", "attributionFormat",
  "conversionSource", "ref",
]

export function sanitizeAdReply(
  raw: ExternalAdReply | null | undefined,
): ExternalAdReply | null {
  if (!raw || typeof raw !== "object") return null
  const safe: Record<string, unknown> = { ...raw }
  for (const k of STRING_FIELDS) {
    if (k in safe && typeof safe[k] !== "string") delete safe[k]
  }
  return safe as ExternalAdReply
}
