// ═══════════════════════════════════════════════════════════════
// Resposta channel-agnostic — a "boca" do sistema
// ═══════════════════════════════════════════════════════════════
// Decide POR ONDE enviar uma mensagem com base no canal do contato.
// Hoje só WhatsApp; Instagram/widget-chat plugam aqui SEM o motor da IA
// (run.ts) ou outros consumidores precisarem saber de canal.
//
// Parte da fundação multicanal (docs/multichannel-design.md §4):
// o cérebro é neutro de canal; aqui mora a única peça WhatsApp-específica
// do envio, isolada pra troca futura.

import "server-only"
import { getProvider } from "@/lib/providers"
import type { ContentType } from "@/lib/providers/types"

type ProviderInstance = Parameters<typeof getProvider>[0]

export interface ReplyTarget {
  /** primary_channel do contato (whatsapp | instagram | site | …). Null = whatsapp. */
  channel:     string | null
  /** Número do WhatsApp. Canais futuros passam a usar o id externo próprio. */
  phoneNumber: string
}

/**
 * Envia um texto pelo canal certo do contato. Retorna o id da mensagem no
 * canal (quando houver). Lança em canal ainda não suportado — assim a gente
 * SABE se um contato não-WhatsApp chegar antes do canal estar pronto.
 */
export async function sendChannelText(
  target:   ReplyTarget,
  text:     string,
  instance: ProviderInstance,
): Promise<{ messageId: string | null }> {
  const channel = target.channel ?? "whatsapp"

  switch (channel) {
    case "whatsapp": {
      const r = await getProvider(instance).sendText(target.phoneNumber, text)
      return { messageId: r.messageId ?? null }
    }
    case "site":
      // Widget-chat: nada a enviar externamente. Quem persiste a mensagem é o
      // chamador (run.ts); o widget busca a resposta via polling em /api/site/messages.
      return { messageId: null }
    // case "instagram": ...  (entra com o canal Instagram Direct)
    default:
      throw new Error(`Resposta no canal '${channel}' ainda não suportada`)
  }
}

/**
 * Envia mídia (por URL) pelo canal certo — irmã aditiva de sendChannelText,
 * NÃO altera o caminho de texto. Usada pelo nó "Enviar mídia" do Studio.
 * A URL deve ser pública (provider busca o arquivo). Transcode/upload não
 * acontece aqui (ao contrário da server-action sendChatMedia do inbox).
 */
export async function sendChannelMedia(
  target:   ReplyTarget,
  media:    { url: string; mediaType: ContentType; caption?: string; fileName?: string },
  instance: ProviderInstance,
): Promise<{ messageId: string | null }> {
  const channel = target.channel ?? "whatsapp"

  switch (channel) {
    case "whatsapp": {
      const r = await getProvider(instance).sendMedia(target.phoneNumber, media.url, media.mediaType, media.caption, media.fileName)
      return { messageId: r.messageId ?? null }
    }
    case "site":
      return { messageId: null }
    default:
      throw new Error(`Mídia no canal '${channel}' ainda não suportada`)
  }
}
