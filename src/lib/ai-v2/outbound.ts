// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — saída: envia texto da IA + persiste
// ═══════════════════════════════════════════════════════════════
// Reusa a "boca" channel-agnostic do sistema (sendChannelText). Grava
// a mensagem (sender_type 'bot') e bumpa a conversa (inbox sobe). v2
// marca metadata.studio=true pra distinguir do v1 na timeline/debug.

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { sendChannelText } from "@/lib/channels/reply"
import type { ExecCtx } from "./capabilities/types"

export async function sendBotText(
  ctx:  Pick<ExecCtx, "tenantId" | "conversationId" | "contact" | "instance">,
  text: string,
  meta: Record<string, unknown> = {},
): Promise<{ messageId: string | null }> {
  const sent = await sendChannelText(
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
