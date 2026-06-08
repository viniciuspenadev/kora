// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — saída: envia texto da IA + persiste
// ═══════════════════════════════════════════════════════════════
// Reusa a "boca" channel-agnostic do sistema (sendChannelText). Grava
// a mensagem (sender_type 'bot') e bumpa a conversa (inbox sobe). v2
// marca metadata.studio=true pra distinguir do v1 na timeline/debug.

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { sendChannelText, sendChannelMedia } from "@/lib/channels/reply"
import type { ExecCtx } from "./capabilities/types"

type MediaKind = "image" | "audio" | "video" | "document"

export async function sendBotText(
  ctx:  Pick<ExecCtx, "tenantId" | "conversationId" | "contact" | "instance" | "dryRun" | "captured">,
  text: string,
  meta: Record<string, unknown> = {},
): Promise<{ messageId: string | null }> {
  // Simulador: captura pra UI e NÃO transmite ao WhatsApp (mas segue persistindo).
  if (ctx.dryRun) ctx.captured?.push({ kind: "text", content: text })
  const sent = ctx.dryRun
    ? { messageId: null }
    : await sendChannelText(
        { channel: ctx.contact.primary_channel, phoneNumber: ctx.contact.phone_number },
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

/** Envia mídia (por URL) da IA + persiste. Irmã de sendBotText: mesmo formato,
 *  respeita ctx.dryRun (captura e não transmite). */
export async function sendBotMedia(
  ctx:   Pick<ExecCtx, "tenantId" | "conversationId" | "contact" | "instance" | "dryRun" | "captured">,
  media: { url: string; mediaType: MediaKind; caption?: string },
  meta:  Record<string, unknown> = {},
): Promise<{ messageId: string | null }> {
  if (ctx.dryRun) ctx.captured?.push({ kind: "media", content: media.caption || media.url })
  const sent = ctx.dryRun
    ? { messageId: null }
    : await sendChannelMedia(
        { channel: ctx.contact.primary_channel, phoneNumber: ctx.contact.phone_number },
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
