// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — saída: envia texto da IA + persiste
// ═══════════════════════════════════════════════════════════════
// Reusa a "boca" channel-agnostic do sistema (sendChannelText). Grava
// a mensagem (sender_type 'bot') e bumpa a conversa (inbox sobe). v2
// marca metadata.studio=true pra distinguir do v1 na timeline/debug.

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { sendChannelText, sendChannelMedia, sendChannelInteractive } from "@/lib/channels/reply"
import { getProvider } from "@/lib/providers"
import type { InteractivePayload } from "@/lib/providers/types"
import type { ExecCtx } from "./capabilities/types"

type MediaKind = "image" | "audio" | "video" | "document"

/** Contexto mínimo que os senders precisam (inclui respiro + typing). */
type OutboundCtx = Pick<ExecCtx,
  "tenantId" | "conversationId" | "contact" | "channel" | "instance" | "dryRun" | "captured" | "inboundMsgId" | "pace">

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
  const sent = ctx.dryRun
    ? { messageId: null }
    : await sendChannelText(
        { channel: (ctx.channel ?? ctx.contact.primary_channel), phoneNumber: ctx.contact.phone_number },
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
      ai_handling:          true,
      updated_at:           new Date().toISOString(),
    })
    .eq("id", ctx.conversationId)
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

  // Respira SÓ se este caminho vai mesmo transmitir (canal whatsapp + provider
  // com interativo) — senão o fallback de texto do chamador respiraria de novo.
  if (((ctx.channel ?? ctx.contact.primary_channel) ?? "whatsapp") === "whatsapp" && getProvider(ctx.instance).sendInteractive) {
    await humanPace(ctx, payload.body.length)
  }

  const sent = await sendChannelInteractive(
    { channel: (ctx.channel ?? ctx.contact.primary_channel), phoneNumber: ctx.contact.phone_number },
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
      ai_handling:          true,
      updated_at:           new Date().toISOString(),
    })
    .eq("id", ctx.conversationId)
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
  const sent = ctx.dryRun
    ? { messageId: null }
    : await sendChannelMedia(
        { channel: (ctx.channel ?? ctx.contact.primary_channel), phoneNumber: ctx.contact.phone_number },
        media,
        ctx.instance,
      )
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
      ai_handling:          true,
      updated_at:           new Date().toISOString(),
    })
    .eq("id", ctx.conversationId)
  return { messageId: sent.messageId }
}

/**
 * Envia um TEMPLATE aprovado (nó Template — Meta oficial) + persiste. Provider
 * resolvido de ctx.instance (só meta_cloud tem sendTemplate; Baileys = no-op).
 * `params` já vêm interpolados do runtime. v1: variáveis POSICIONAIS.
 */
export async function sendBotTemplate(
  ctx:  OutboundCtx,
  tpl:  { name: string; language: string; params?: string[] },
  meta: Record<string, unknown> = {},
): Promise<{ messageId: string | null }> {
  const display = `[template: ${tpl.name}]`
  if (ctx.dryRun) { ctx.captured?.push({ kind: "text", content: display }); return { messageId: null } }
  await humanPace(ctx, 80)

  const provider = getProvider(ctx.instance)
  if (!provider.sendTemplate) return { messageId: null }   // canal sem template (Baileys) → no-op
  const bodyParams = (tpl.params ?? []).filter((p) => p.trim() !== "").map((p) => ({ text: p }))
  const sent = await provider.sendTemplate(ctx.contact.phone_number ?? "", tpl.name, tpl.language, bodyParams.length ? bodyParams : undefined)

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
    last_message_dir: "out", ai_handling: true, updated_at: new Date().toISOString(),
  }).eq("id", ctx.conversationId)
  return { messageId: sent.messageId }
}
