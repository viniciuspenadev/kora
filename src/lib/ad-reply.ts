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

/**
 * Campos "pesados" do ad reply que NÃO devem ir nas cópias denormalizadas que
 * trafegam em caminhos quentes: `chat_conversations.from_ad_meta` (payload da
 * lista do inbox + re-broadcast Realtime a cada UPDATE) e
 * `chat_contacts.metadata.first_ad_reply` (embed do contato na lista).
 *
 * O `thumbnail`/`jpegThumbnail` é a miniatura do anúncio em **base64** (~17 KB,
 * até 35 KB) e `ctwaPayload` é um blob opaco da Meta. Ambos são redundantes: o
 * render (AdSourceBanner, LeadSourceCard) sempre prefere `thumbnailUrl` /
 * `originalImageUrl`, e só cairia no base64 como último fallback — cenário que
 * hoje não existe em nenhuma linha (toda atribuição traz a URL).
 *
 * A cópia RICA permanece em `chat_messages.metadata.external_ad_reply`, que não
 * está em caminho quente (carrega só ao abrir a conversa) e serve de fallback
 * autoritativo. Idempotente e não-mutante.
 */
const HEAVY_AD_FIELDS = ["thumbnail", "jpegThumbnail", "ctwaPayload"] as const

export function slimAdMeta(
  ad: ExternalAdReply | null | undefined,
): ExternalAdReply | null {
  if (!ad || typeof ad !== "object") return ad ?? null
  const slim: Record<string, unknown> = { ...ad }
  for (const k of HEAVY_AD_FIELDS) delete slim[k]
  return slim as ExternalAdReply
}
