import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { checkDestinationAvailability } from "@/lib/atendimento/availability"
import { sendChannelText } from "@/lib/channels/reply"
import { sendBotText } from "../outbound"
import type { ExecCtx } from "./types"
import { StudioControlChangedError } from "../control"

export async function transferToSelectedAgents(ctx: ExecCtx, args: {
  agentIds: string[]; roundRobin: boolean; handoffMessage: string | null;
  waitMessage: string | null; whenUnavailable: string; summary?: string; byAI?: boolean;
  collected?: { label: string; value: string }[]
}, current: { assigned_to: string | null }) {
  const execution = ctx.transferExecution
  if (!execution) throw new Error("Transferência sem identidade de execução.")
  const ids = [...new Set(args.agentIds)]
  if (!ids.length || ids.length > 100 || ids.some(id => !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error("Selecione de 1 a 100 agentes válidos para a transferência.")
  }
  const available = await checkDestinationAvailability(ctx.tenantId, {})
  const { data, error } = await supabaseAdmin.rpc("studio_assign_agents", {
    p_tenant: ctx.tenantId, p_conversation: ctx.conversationId,
    p_flow: execution.flowId, p_node: execution.nodeId, p_run: execution.runKey,
    p_agents: ids, p_round_robin: args.roundRobin,
    p_expected_metadata: ctx.conversationMetadata, p_expected_agent: current.assigned_to,
    p_details: {summary:args.summary??"",collected:args.collected??[],byAI:!!args.byAI},
    p_handoff: args.handoffMessage, p_wait: args.waitMessage,
    p_off_hours: available.reason === "off_hours", p_fallback: args.whenUnavailable, p_dry_run: !!ctx.dryRun,
  })
  if (error?.code === "40001") throw new StudioControlChangedError("O atendimento mudou durante a distribuição.")
  if (error || !data) throw new Error("Não foi possível confirmar a distribuição. Verifique a configuração e a migration do Studio.")
  if (data.kept_ai) {
    if (args.waitMessage && !args.waitMessage.includes("{{agente}}")) await sendBotText(ctx, args.waitMessage)
    return { ok: true, keptAI: true }
  }
  // SQL commits assignment, receipt and pending message together. This claim is
  // at-most-once across workers; a crash/timeout never causes an automatic resend.
  if (data.message_id) {
    try { await deliverPresentation(ctx, data.message_id, data.receipt_id, data.assigned_to) }
    catch { console.warn('[studio-transfer] Atribuição confirmada; apresentação aguarda recuperação.') }
  }
  return { ok: true, routedDepartmentId: data.department_id ?? null }
}

export async function deliverPresentation(ctx: ExecCtx, messageId: string, receiptId: string, agentId: string | null) {
  const { data: message, error } = await supabaseAdmin.from("chat_messages")
    .select("id,content,metadata").eq("tenant_id",ctx.tenantId).eq("conversation_id",ctx.conversationId)
    .eq("id",messageId).eq("metadata->>delivery_state","ready").maybeSingle()
  if (error) throw new Error("Distribuído, mas não foi possível consultar a apresentação pendente.")
  if (!message) return
  const claimed = { ...message.metadata, delivery_state: "sending", claimed_at: new Date().toISOString() }
  const { data: rows, error: claimError } = await supabaseAdmin.from("chat_messages")
    .update({ metadata: claimed }).eq("tenant_id",ctx.tenantId).eq("id",messageId)
    .eq("metadata->>delivery_state","ready").select("id")
  if (claimError) throw new Error("Distribuído, mas não foi possível reservar a apresentação.")
  if (!rows?.length) return
  let state = "unknown"
  try {
    const { data: conversation, error: readError } = await supabaseAdmin.from("chat_conversations")
      .select("assigned_to,status,metadata,updated_at").eq("tenant_id",ctx.tenantId).eq("id",ctx.conversationId).maybeSingle()
    if (readError) throw new Error("Falha ao conferir o atendimento antes da apresentação.")
    if (!conversation || conversation.status !== "open" || conversation.assigned_to !== agentId
      || conversation.metadata?.ai_routed?.receipt_id !== receiptId) {
      state = "cancelled"
      throw new Error("Apresentação cancelada: o atendimento mudou.")
    }
    if (ctx.dryRun) ctx.captured?.push({ kind: "text", content: message.content })
    const sent = ctx.dryRun ? { messageId: null } : await sendChannelText({
      channel: ctx.channel ?? ctx.contact.primary_channel, phoneNumber: ctx.contact.phone_number,
      externalId: ctx.contact.primary_external_id, tenantId: ctx.tenantId,
    },message.content,ctx.instance)
    const { error: saveError } = await supabaseAdmin.from("chat_messages").update({
      status: "sent", whatsapp_msg_id: sent.messageId || null,
      metadata: { ...claimed, delivery_state: "sent" },
    }).eq("tenant_id",ctx.tenantId).eq("id",messageId)
    if (saveError) throw new Error("Envio aceito, confirmação local pendente.")
    await supabaseAdmin.from("chat_conversations").update({last_message_at:new Date().toISOString(),
      last_message_preview:message.content.slice(0,100),last_message_dir:"out",updated_at:new Date().toISOString()})
      .eq("tenant_id",ctx.tenantId).eq("id",ctx.conversationId).eq("updated_at",conversation.updated_at)
  } catch {
    await supabaseAdmin.from("chat_messages").update({ status: "failed",
      metadata: { ...claimed, delivery_state: state },
    }).eq("tenant_id",ctx.tenantId).eq("id",messageId)
    await supabaseAdmin.from("chat_messages").insert({tenant_id:ctx.tenantId,conversation_id:ctx.conversationId,
      sender_type:"system",content_type:"text",is_private_note:true,status:"delivered",
      content: state === "cancelled" ? "Apresentação cancelada porque o atendimento mudou."
        : "Atribuição confirmada. Não foi possível confirmar o envio da apresentação. Confira no WhatsApp antes de reenviar.",
      metadata:{studio:true,transfer_receipt:receiptId}})
  }
}
