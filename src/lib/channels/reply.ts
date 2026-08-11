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
import { getInstagramSender, sendInstagramText, sendInstagramMessage } from "@/lib/instagram/api"
import { buildIgMessage } from "@/lib/instagram/rich-render"
import type { ContentType, InteractivePayload, ReplyContext } from "@/lib/providers/types"
import type { RichMessage } from "@/lib/ai-v2/flow/types"

type ProviderInstance = Parameters<typeof getProvider>[0]

export interface ReplyTarget {
  /** primary_channel do contato (whatsapp | instagram | site | …). Null = whatsapp. */
  channel:     string | null
  /** Número do WhatsApp. Canais futuros passam a usar o id externo próprio. */
  phoneNumber: string
  /** BSUID (Meta) — endereço quando o telefone não está disponível. Doc BSUID §2.3. */
  bsuid?:      string | null
  /** Id externo do canal não-WhatsApp (Instagram: IGSID = contato.primary_external_id). */
  externalId?: string | null
  /** Tenant — necessário nos canais cuja credencial vive fora de `whatsapp_instances`. */
  tenantId?:   string | null
}

/** Endereço WhatsApp do alvo: telefone quando há, senão o BSUID (Meta). */
function waAddress(t: ReplyTarget): string {
  return t.phoneNumber || t.bsuid || ""
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
  replyTo?: ReplyContext,
): Promise<{ messageId: string | null }> {
  const channel = target.channel ?? "whatsapp"

  switch (channel) {
    case "whatsapp": {
      const r = await getProvider(instance).sendText(waAddress(target), text, replyTo)
      return { messageId: r.messageId ?? null }
    }
    case "site":
      // Widget-chat: nada a enviar externamente. Quem persiste a mensagem é o
      // chamador (run.ts); o widget busca a resposta via polling em /api/site/messages.
      return { messageId: null }
    case "instagram": {
      // Instagram Direct — mesmo caminho já provado no inbox (actions/chat.ts): token
      // cifrado da conexão + IGSID do contato. Só vale DENTRO da janela de 24h; fora
      // dela a Meta recusa e o erro sobe pro runtime (vira status "error" no turno).
      if (!target.tenantId) throw new Error("Envio no Instagram sem tenant no alvo.")
      const sender = await getInstagramSender(target.tenantId)
      if (!sender) throw new Error("Conta do Instagram não conectada (conecte em Integrações).")
      const igsid = target.externalId
      if (!igsid) throw new Error("Contato sem identidade do Instagram (IGSID).")
      const r = await sendInstagramText(sender.igAccountId, igsid, sender.token, text)
      if ("error" in r) throw new Error(r.error)
      return { messageId: r.messageId || null }
    }
    default:
      throw new Error(`Resposta no canal '${channel}' ainda não suportada`)
  }
}

/**
 * Envia mídia (por URL) pelo canal certo — irmã aditiva de sendChannelText,
 * NÃO altera o caminho de texto. Usada pelo nó "Enviar mídia" do Studio.
 * A URL deve ser pública (provider busca o arquivo). Transcode/upload não
 * acontece aqui (ao contrário da server-action sendChatMedia do inbox).
 *
 * 🔴 **NÃO LANÇA em canal sem entrega de mídia — devolve `null`** (mesmo contrato da
 *    irmã `sendChannelInteractive`), pra o chamador degradar.
 *
 *    Antes, o `default` fazia `throw`. Como o `case "send_media"` do runtime não trata
 *    exceção, ela subia até o guarda-chuva do turno (`run.ts`) e **matava o turno
 *    inteiro**: o cliente final não recebia NADA e o run ficava parado no nó anterior.
 *    Ou seja, arrastar "Enviar mídia" pra um fluxo de Instagram publicava um fluxo que
 *    quebrava na 1ª execução. É a mesma lição já aprendida no `sendBotTemplate`
 *    ("recusar é aceitável, recusar calado não" — ai-v2/outbound.ts).
 *
 * ⚠️ `null` significa **"o canal não entrega mídia por este caminho"**, não "falhou o
 *    envio". Falha real do provider (rede/400) continua lançando de dentro do `case
 *    "whatsapp"` — são coisas diferentes e o chamador as trata diferente.
 */
export async function sendChannelMedia(
  target:   ReplyTarget,
  media:    { url: string; mediaType: ContentType; caption?: string; fileName?: string },
  instance: ProviderInstance,
  replyTo?: ReplyContext,
): Promise<{ messageId: string | null } | null> {
  const channel = target.channel ?? "whatsapp"

  switch (channel) {
    case "whatsapp": {
      const r = await getProvider(instance).sendMedia(waAddress(target), media.url, media.mediaType, media.caption, media.fileName, replyTo)
      return { messageId: r.messageId ?? null }
    }
    case "site":
      // ⚠️ Widget-chat NÃO entrega mídia — e isto é diferente do texto. O polling do
      // widget seleciona só `content, sender_type, created_at`
      // (`/api/site/messages/route.ts`), então `media_url` nunca chega ao visitante. A
      // linha até era persistida e o ATENDENTE a via no inbox, o que fazia o fluxo (e o
      // inbox) acreditarem numa entrega que não aconteceu. Enquanto o widget não buscar
      // mídia, isto é recusa honesta, não sucesso.
      return null
    default:
      // Instagram / Messenger / TikTok: sem caminho de mídia implementado ainda.
      // Quando o envio rico compartilhado existir (docs/studio-rich-message-design.md
      // §5), o Instagram sai daqui e ganha entrega de verdade.
      return null
  }
}

/**
 * Envia uma MENSAGEM RICA (texto · imagem · botões · cartão) pelo canal, escolhendo o
 * veículo de maior fidelidade que ele aceita. `null` = **não entreguei** — o chamador
 * degrada (nunca lança; ver a lição registrada em `sendChannelMedia`).
 *
 * 🔴 É a costura que faltava no produto. `buildIgMessage` — o montador de cartão/botões
 *    do Instagram, testado ao vivo — existia com **um único consumidor no código
 *    inteiro**: a resposta privada ao comentário. Não era um caminho de envio, era um
 *    beco. Daqui em diante qualquer nó que produza uma mensagem rica entrega por aqui.
 *
 * Desenho: docs/studio-rich-message-design.md §5.
 */
export async function sendChannelRich(
  target: ReplyTarget,
  msg:    RichMessage,
): Promise<{ messageId: string | null } | null> {
  const channel = target.channel ?? "whatsapp"
  // WhatsApp Oficial / Baileys / site entram em fases seguintes; hoje seguem pelos
  // caminhos de texto e interativo que já existem.
  if (channel !== "instagram") return null

  if (!target.tenantId) return null
  const igsid = target.externalId
  if (!igsid) return null
  const sender = await getInstagramSender(target.tenantId)
  if (!sender) return null

  const built = await buildIgMessage(msg, {
    token: sender.token, igAccountId: sender.igAccountId,
    origin: process.env.AUTH_URL ?? process.env.NEXTAUTH_URL,
  })
  if ("error" in built) {
    console.error("[reply.rich] montagem falhou:", built.error)
    return null
  }

  const r = await sendInstagramMessage(sender.igAccountId, igsid, sender.token, built.message)
  if ("error" in r) {
    // Inclui o caso "janela de 24h fechada" — a Meta recusa e nós degradamos, em vez de
    // deixar a exceção subir e matar o turno.
    console.error("[reply.rich] envio recusado:", r.error)
    return null
  }
  return { messageId: r.messageId }
}

/**
 * Tenta enviar uma mensagem INTERATIVA nativa (botões/lista/CTA) pelo canal.
 * Diferente das irmãs: NÃO lança em canal/provider sem suporte — retorna `null`
 * pra o chamador cair num fallback (ex: o nó Menu vira menu numerado no Baileys).
 */
export async function sendChannelInteractive(
  target:   ReplyTarget,
  payload:  InteractivePayload,
  instance: ProviderInstance,
  replyTo?: ReplyContext,
): Promise<{ messageId: string | null } | null> {
  const channel = target.channel ?? "whatsapp"

  /**
   * 🔴 INSTAGRAM — o ganho que os nós **Menu** e **Agendar** recebem de graça.
   *
   * Até aqui este caminho era WhatsApp-only, então TODO Menu/Agendar rodando no Direct
   * degradava pra texto numerado ("digite 1, 2 ou 3") — mesmo o Instagram aceitando
   * botão nativo e mesmo o renderizador estando pronto e testado. Isso passa a valer em
   * fluxo **já publicado**, sem ninguém reconfigurar nada.
   *
   * ⚠️ Só BOTÕES. Lista e CTA não existem no Direct ⇒ `null` e o chamador cai no
   *    numerado — que continua sendo o certo pra 4+ opções (a escada de fidelidade de
   *    `flow/interactive.ts` já decide isso antes de chegar aqui).
   */
  if (channel === "instagram") {
    const btns = payload.buttons ?? []
    if (!btns.length || !payload.body.trim()) return null
    return sendChannelRich(target, {
      format:  "buttons",
      text:    payload.body,
      buttons: btns.map((b) => ({ id: b.id, label: b.title, kind: "reply" as const })),
    })
  }

  if (channel !== "whatsapp") return null

  const provider = getProvider(instance)
  if (!provider.sendInteractive) return null

  const r = await provider.sendInteractive(waAddress(target), payload, replyTo)
  return { messageId: r.messageId ?? null }
}
