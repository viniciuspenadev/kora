// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — saída: envia texto da IA + persiste
// ═══════════════════════════════════════════════════════════════
// Reusa a "boca" channel-agnostic do sistema (sendChannelText). Grava
// a mensagem (sender_type 'bot') e bumpa a conversa (inbox sobe). v2
// marca metadata.studio=true pra distinguir do v1 na timeline/debug.

import "server-only"
import { assertStudioControl } from "./control"
import { supabaseAdmin } from "@/lib/supabase"
import { sendChannelText, sendChannelMedia, sendChannelInteractive, sendChannelRich } from "@/lib/channels/reply"
import { cardImageUrl } from "@/lib/storage/card-image-token"
import type { RichMessage } from "@/lib/ai-v2/flow/types"
import { getProvider } from "@/lib/providers"
import { isWhatsAppChannel, getChannelPolicy } from "@/lib/channels/policy"
import type { InteractivePayload } from "@/lib/providers/types"
import type { ExecCtx } from "./capabilities/types"

type MediaKind = "image" | "audio" | "video" | "document"

/** Contexto mínimo que os senders precisam (inclui respiro + typing). */
type OutboundCtx = Pick<ExecCtx,
  "tenantId" | "conversationId" | "contact" | "channel" | "instance" | "dryRun" | "captured" | "inboundMsgId" | "pace"> & Partial<Pick<ExecCtx, "conversationMetadata">>

// ── Respiro humanizado (pacing) ─────────────────────────────────
// Nenhum humano digita 400 caracteres em 2 segundos: antes de cada mensagem
// do bot, pausa proporcional ao tamanho do texto com "digitando…" aceso.
// Por canal: Baileys = sendPresence; Meta = typing_indicator (preso ao id do
// inbound; re-acionado a cada mensagem porque o envio anterior o apaga);
// site = só a pausa (o polling ~2s do widget entrega o ritmo). O budget por
// turno limita sequências de nós (mensagem→mensagem→menu): cada uma respira,
// o fluxo não hiberna. Simulador (dryRun) e resume sem pace não esperam.
const PACE_BASE_MS        = 900
const PACE_PER_CHAR_MS    = 35
const PACE_MAX_MS         = 3_500
const PACE_TURN_BUDGET_MS = 10_000

async function humanPace(ctx: OutboundCtx, textLength: number): Promise<void> {
  if (ctx.dryRun || !ctx.pace) return
  const want    = Math.min(PACE_MAX_MS, PACE_BASE_MS + textLength * PACE_PER_CHAR_MS)
  const allowed = Math.min(want, PACE_TURN_BUDGET_MS - ctx.pace.usedMs)
  if (allowed <= 0) return
  ctx.pace.usedMs += allowed
  if (((ctx.channel ?? ctx.contact.primary_channel) ?? "whatsapp") === "whatsapp") {
    try {
      const provider = getProvider(ctx.instance)
      if (provider.providerName === "meta_cloud") {
        if (ctx.inboundMsgId) await provider.sendTyping?.(ctx.inboundMsgId)
      } else {
        await provider.sendPresence(ctx.contact.phone_number ?? "", "typing")
      }
    } catch { /* typing é cosmético — nunca bloqueia o envio */ }
  }
  await new Promise((r) => setTimeout(r, allowed))
}

export async function sendBotText(
  ctx:  OutboundCtx,
  text: string,
  meta: Record<string, unknown> = {},
): Promise<{ messageId: string | null }> {
  // Simulador: captura pra UI e NÃO transmite ao WhatsApp (mas segue persistindo).
  if (ctx.dryRun) ctx.captured?.push({ kind: "text", content: text })
  await humanPace(ctx, text.length)
  await assertStudioControl(ctx)
  const sent = ctx.dryRun
    ? { messageId: null }
    : await sendChannelText(
        { channel: (ctx.channel ?? ctx.contact.primary_channel), phoneNumber: ctx.contact.phone_number,
          externalId: ctx.contact.primary_external_id, tenantId: ctx.tenantId },
        text,
        ctx.instance,
      )
  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: ctx.conversationId,
    tenant_id:       ctx.tenantId,
    sender_type:     "bot",
    content_type:    "text",
    content:         text,
    status:          "sent",
    whatsapp_msg_id: sent.messageId || null,
    is_private_note: false,
    metadata:        { ai: true, studio: true, ...meta },
  })
  await supabaseAdmin
    .from("chat_conversations")
    .update({
      last_message_at:      new Date().toISOString(),
      last_message_preview: text.substring(0, 100),
      last_message_dir:     "out",
      updated_at:           new Date().toISOString(),
    })
    .eq("id", ctx.conversationId).eq("tenant_id", ctx.tenantId)
  return { messageId: sent.messageId }
}

/**
 * Tenta enviar uma mensagem INTERATIVA nativa (botões/lista) + persiste.
 * Retorna `true` se transmitiu de forma interativa; `false` se o canal/provider
 * não suporta — aí o chamador (nó Menu) faz fallback pro texto numerado.
 *
 * Persiste UMA linha de bot com `content = persistText` (representação legível
 * pro atendente ver no inbox o que foi perguntado) + metadata do tipo interativo.
 */
export async function sendBotInteractive(
  ctx:     OutboundCtx,
  payload: InteractivePayload,
  persistText: string,
  meta:    Record<string, unknown> = {},
): Promise<boolean> {
  // Simulador: não há superfície interativa no sandbox → deixa o chamador usar texto.
  if (ctx.dryRun) return false

  // Respira SÓ se este caminho vai mesmo transmitir — senão o fallback de texto do
  // chamador respiraria DE NOVO (respiro dobrado num turno que nem foi interativo).
  // Instagram: transmite quando há BOTÕES (lista/CTA não existem no Direct e caem no
  // numerado). WhatsApp: quando o provider implementa interativo (Baileys não).
  const outCh = (ctx.channel ?? ctx.contact.primary_channel) ?? "whatsapp"
  const willTransmit = outCh === "instagram"
    ? (payload.buttons?.length ?? 0) > 0
    : outCh === "whatsapp" && !!getProvider(ctx.instance).sendInteractive
  if (willTransmit) await humanPace(ctx, payload.body.length)

  await assertStudioControl(ctx)
  const sent = await sendChannelInteractive(
    // ⚠️ `externalId` + `tenantId` são OBRIGATÓRIOS pro ramo do Instagram (IGSID do
    //    contato + conexão do tenant). Sem eles o alvo chegava incompleto e o caminho
    //    novo jamais seria alcançado — o Menu seguiria caindo no numerado em silêncio.
    //    O irmão `sendBotMedia` já montava o alvo assim.
    { channel: outCh, phoneNumber: ctx.contact.phone_number,
      externalId: ctx.contact.primary_external_id, tenantId: ctx.tenantId },
    payload,
    ctx.instance,
  )
  if (!sent) return false   // provider sem suporte (ex: Baileys) → fallback no chamador

  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: ctx.conversationId,
    tenant_id:       ctx.tenantId,
    sender_type:     "bot",
    content_type:    "text",
    content:         persistText,
    status:          "sent",
    whatsapp_msg_id: sent.messageId || null,
    is_private_note: false,
    metadata:        { ai: true, studio: true, ...meta },
  })
  await supabaseAdmin
    .from("chat_conversations")
    .update({
      last_message_at:      new Date().toISOString(),
      last_message_preview: persistText.substring(0, 100),
      last_message_dir:     "out",
      updated_at:           new Date().toISOString(),
    })
    .eq("id", ctx.conversationId).eq("tenant_id", ctx.tenantId)
  return true
}

/** Envia mídia (por URL) da IA + persiste. Irmã de sendBotText: mesmo formato,
 *  respeita ctx.dryRun (captura e não transmite). */
export async function sendBotMedia(
  ctx:   OutboundCtx,
  media: { url: string; mediaType: MediaKind; caption?: string },
  meta:  Record<string, unknown> = {},
): Promise<{ messageId: string | null }> {
  if (ctx.dryRun) ctx.captured?.push({ kind: "media", content: media.caption || media.url })
  await humanPace(ctx, (media.caption?.length ?? 0) + 40)   // mídia: respiro de "preparo"
  await assertStudioControl(ctx)
  const sent = ctx.dryRun
    ? { messageId: null }
    : await sendChannelMedia(
        { channel: (ctx.channel ?? ctx.contact.primary_channel), phoneNumber: ctx.contact.phone_number,
          externalId: ctx.contact.primary_external_id, tenantId: ctx.tenantId },
        media,
        ctx.instance,
      )

  // 🔴 Canal sem entrega de mídia (`null`) → NOTA INTERNA e o fluxo SEGUE. Mesmo padrão
  //    do `sendBotTemplate` logo abaixo: recusar é aceitável, recusar calado não.
  //    Antes isto era um `throw` lá no reply.ts que matava o turno inteiro.
  // ⚠️ NÃO persiste a linha de mídia: gravar `status:"sent"` com `media_url` de algo que
  //    o cliente nunca recebeu é justamente a mentira que o atendente lê como entrega.
  if (sent === null) {
    const ch    = ctx.channel ?? ctx.contact.primary_channel
    const label = getChannelPolicy(ch, ctx.instance?.provider).label
    await noteFlowSkip(
      ctx,
      `⚠️ Mídia não enviada — ${label} não entrega mídia por este caminho. O fluxo seguiu sem ela.`,
      { node: "send_media", channel: ch ?? null, media_type: media.mediaType, url: media.url },
    )
    return { messageId: null }
  }

  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: ctx.conversationId,
    tenant_id:       ctx.tenantId,
    sender_type:     "bot",
    content_type:    media.mediaType,
    content:         media.caption ?? "",
    media_url:       media.url,
    status:          "sent",
    whatsapp_msg_id: sent.messageId || null,
    is_private_note: false,
    metadata:        { ai: true, studio: true, ...meta },
  })
  await supabaseAdmin
    .from("chat_conversations")
    .update({
      last_message_at:      new Date().toISOString(),
      last_message_preview: media.caption?.substring(0, 100) || `[${media.mediaType}]`,
      last_message_dir:     "out",
      updated_at:           new Date().toISOString(),
    })
    .eq("id", ctx.conversationId).eq("tenant_id", ctx.tenantId)
  return { messageId: sent.messageId }
}

/**
 * Envia uma MENSAGEM RICA (texto · imagem · botões · cartão) pelo melhor veículo do canal.
 *
 * 🔴 **A escada de degradação — "compõe uma vez, cada canal entrega o que consegue".**
 *    O autor do fluxo monta UM objeto; quem traduz é aqui, nunca ele.
 *
 *      1. Canal com envio rico nativo (Instagram) → cartão/botão numa mensagem só.
 *      2. Botões + canal com interativo nativo (WhatsApp Oficial) → botão nativo.
 *      3. Tem imagem → manda a imagem com o texto de legenda.
 *      4. Texto puro.
 *
 *    Nos canais SEM botão nativo (Baileys/site) as opções viram lista numerada dentro do
 *    próprio texto — e o casamento da resposta (`resolveRichButton`) aceita o número. As
 *    SAÍDAS do nó são as mesmas nos quatro canais; só a aparência muda.
 *
 * ⚠️ A imagem vai pela rota opaca `/api/card-image/<token>` (pública de propósito: o
 *    servidor da Meta busca sem login). Bucket segue privado, sem URL assinada.
 */
export async function sendBotRich(
  ctx:  OutboundCtx,
  msg:  RichMessage,
  meta: Record<string, unknown> = {},
): Promise<{ messageId: string | null }> {
  const text    = (msg.text ?? "").trim()
  const replies = (msg.buttons ?? []).filter((b) => b.kind === "reply")
  const target  = {
    channel: (ctx.channel ?? ctx.contact.primary_channel), phoneNumber: ctx.contact.phone_number,
    externalId: ctx.contact.primary_external_id, tenantId: ctx.tenantId,
  }

  if (ctx.dryRun) {
    ctx.captured?.push({ kind: "text", content: numberedBody(text, replies) })
    return { messageId: null }
  }

  // 1) Rico nativo — hoje Instagram. `null` = canal não faz; segue a escada.
  await humanPace(ctx, text.length)
  await assertStudioControl(ctx)
  const rich = await sendChannelRich(target, msg)
  if (rich) {
    await persistBotMessage(ctx, numberedBody(text, replies), rich.messageId, {
      ...meta, rich: true, interactive_kind: replies.length ? "button" : undefined,
    })
    return { messageId: rich.messageId }
  }

  // 2) Botão nativo (WhatsApp Oficial). Sem suporte → false, e a escada continua.
  if (replies.length && text) {
    const ok = await sendBotInteractive(
      ctx,
      { body: text, buttons: replies.slice(0, 3).map((b) => ({ id: b.id, title: b.label })) },
      numberedBody(text, replies),
      { ...meta, rich: true },
    ).catch(() => false)
    if (ok) return { messageId: null }
  }

  // 3/4) Sem botão nativo: as opções entram NUMERADAS no próprio texto — uma mensagem só,
  //      em vez de "imagem" + "texto" + "opções" em três bolhas.
  const body = numberedBody(text, replies)
  if (msg.media?.path) {
    const origin = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")
    // `cardImageUrl` devolve null se a cifra do token falhar (chave ausente/inválida) —
    // sem URL não há como o provedor buscar a imagem.
    const url = origin ? cardImageUrl(msg.media.path, origin) : null
    if (url) {
      return sendBotMedia(ctx, {
        url,
        mediaType: msg.media.kind === "document" ? "document" : msg.media.kind,
        caption: body || undefined,
      }, { ...meta, rich: true })
    }
    // Sem URL possível: manda o texto assim mesmo (entregar algo > entregar nada) e deixa
    // o motivo visível pro atendente, em vez de a imagem sumir calada.
    await noteFlowSkip(ctx, "⚠️ Imagem não enviada: o endereço público do app não está configurado.", { node: "message" })
  }
  if (!body) return { messageId: null }
  /**
   * 🔴 RESPIRO JÁ FOI GASTO LÁ EM CIMA — e chamar `sendBotText` aqui o gastava DE NOVO
   *    (achado ao construir os balões, 2026-08-17). Uma mensagem rica só-texto consumia
   *    até 7s do orçamento de 10s do turno em vez de 3,5s.
   *
   *    Com um balão só isso só deixava a mensagem lenta. Com balões é pior: o teto de 4
   *    balões é DERIVADO desse orçamento (MAX_BALOES), então gastar em dobro faria o 3º
   *    chegar em rajada quando a conta diz que o 4º é que chega.
   *
   * ⚠️ `pace: undefined` desliga só o respiro; o "digitando…" já foi aceso lá em cima e
   *    a persistência da linha segue idêntica.
   */
  return sendBotText({ ...ctx, pace: undefined }, body, { ...meta, rich: true })
}

/** Texto + opções numeradas — o corpo usado quando o canal não tem botão nativo, e também
 *  a representação legível que fica no inbox (o atendente vê o que foi oferecido). */
function numberedBody(text: string, replies: { label: string }[]): string {
  if (replies.length === 0) return text
  const lines = replies.map((b, i) => `${["1️⃣", "2️⃣", "3️⃣"][i] ?? `${i + 1}.`} ${b.label}`)
  return [text, "", ...lines].join("\n").trim()
}

/** Persiste a linha de bot + bumpa a conversa. Extraído porque `sendBotRich` tem 4 saídas
 *  possíveis e repetir o insert em cada uma é como as versões divergem. */
async function persistBotMessage(
  ctx: OutboundCtx, content: string, messageId: string | null, meta: Record<string, unknown>,
): Promise<void> {
  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: ctx.conversationId, tenant_id: ctx.tenantId,
    sender_type: "bot", content_type: "text", content,
    status: "sent", whatsapp_msg_id: messageId || null, is_private_note: false,
    metadata: { ai: true, studio: true, ...meta },
  })
  await supabaseAdmin.from("chat_conversations").update({
    last_message_at:      new Date().toISOString(),
    last_message_preview: content.substring(0, 100),
    last_message_dir:     "out",
    updated_at:           new Date().toISOString(),
  }).eq("id", ctx.conversationId).eq("tenant_id", ctx.tenantId)
}

/**
 * Nota interna no fio (o cliente NÃO vê) explicando por que o nó não entregou.
 * Padrão da casa pra falha de nó (capabilities/transfer.ts): recusar é aceitável,
 * recusar CALADO não — o atendente precisa ver no inbox e agir.
 */
export async function noteFlowSkip(ctx: OutboundCtx, content: string, meta: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin.from("chat_messages").insert({
    conversation_id: ctx.conversationId, tenant_id: ctx.tenantId,
    sender_type: "system", content_type: "text", content,
    status: "delivered", is_private_note: true,
    metadata: { studio: true, skipped: true, ...meta },
  })
  if (error) console.error("[ai-v2.outbound] nota de recusa não gravada:", error.message)
}

/**
 * Envia um TEMPLATE aprovado (nó Template — Meta oficial) + persiste. Provider
 * resolvido de ctx.instance (só meta_cloud tem sendTemplate; Baileys = no-op).
 * `params` já vêm interpolados do runtime. v1: variáveis POSICIONAIS.
 *
 * ⛔ Gate de CANAL. Template é veículo EXCLUSIVO da família WhatsApp e o roteamento
 * é pelo canal da CONVERSA (o fio), como manda channels/policy.ts — nunca pelo
 * primary_channel do contato (hub multicanal) nem pelo provider da instância. Sem
 * este gate, um fluxo com nó Template rodando em thread de Instagram/site pegava o
 * `instance_id` EMPRESTADO (que é meta_cloud), montava um provider FUNCIONAL e
 * disparava um template COBRADO pro WhatsApp de quem só falou no Direct — ou, se o
 * contato não tivesse telefone, mandava pra string vazia e explodia no meio do fluxo
 * (com o run travado `active`, re-executando a cada mensagem seguinte).
 *
 * Nunca lança: o `case "template"` do runtime não trata exceção, então um throw aqui
 * congelaria o fluxo. Recusa = nota interna + no-op, e o fluxo segue pro próximo nó.
 */
export async function sendBotTemplate(
  ctx:  OutboundCtx,
  tpl:  { name: string; language: string; params?: string[] },
  meta: Record<string, unknown> = {},
): Promise<{ messageId: string | null }> {
  const display = `[template: ${tpl.name}]`
  if (ctx.dryRun) { ctx.captured?.push({ kind: "text", content: display }); return { messageId: null } }

  const channel = ctx.channel ?? ctx.contact.primary_channel ?? "whatsapp"
  if (!isWhatsAppChannel(channel)) {
    await noteFlowSkip(ctx,
      `⚠️ Nó Template não enviou "${tpl.name}": modelos são exclusivos do WhatsApp e esta conversa é do canal ${getChannelPolicy(channel).label}. Troque o nó por "Enviar mensagem" neste ramo do fluxo (Kora Studio).`,
      { node: "template", template: tpl.name, channel })
    return { messageId: null }
  }

  // Endereço WhatsApp: telefone quando há, senão BSUID (mesma regra do reply.ts).
  // Vazio = não há pra onde mandar → recusa visível em vez de chamada com "".
  const to = ctx.contact.phone_number || ctx.contact.bsuid || ""
  if (!to) {
    await noteFlowSkip(ctx,
      `⚠️ Nó Template não enviou "${tpl.name}": o contato não tem número de WhatsApp nem identificador da Meta.`,
      { node: "template", template: tpl.name, channel })
    return { messageId: null }
  }

  await humanPace(ctx, 80)

  const provider = getProvider(ctx.instance)
  if (!provider.sendTemplate) return { messageId: null }   // provider sem template (Baileys) → no-op
  const bodyParams = (tpl.params ?? []).filter((p) => p.trim() !== "").map((p) => ({ text: p }))
  await assertStudioControl(ctx)
  const sent = await provider.sendTemplate(to, tpl.name, tpl.language, bodyParams.length ? bodyParams : undefined)

  await supabaseAdmin.from("chat_messages").insert({
    conversation_id: ctx.conversationId,
    tenant_id:       ctx.tenantId,
    sender_type:     "bot",
    content_type:    "text",
    content:         display,
    status:          "sent",
    whatsapp_msg_id: sent.messageId || null,
    is_private_note: false,
    metadata:        { ai: true, studio: true, template: tpl.name, language: tpl.language, ...meta },
  })
  await supabaseAdmin.from("chat_conversations").update({
    last_message_at: new Date().toISOString(), last_message_preview: display,
    last_message_dir: "out", updated_at: new Date().toISOString(),
  }).eq("id", ctx.conversationId).eq("tenant_id", ctx.tenantId)
  return { messageId: sent.messageId }
}
