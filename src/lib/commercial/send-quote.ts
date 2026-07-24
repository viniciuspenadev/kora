import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { getProvider } from "@/lib/providers"
import { isWindowOpen } from "@/lib/channels/policy"
import { logConversationEvent } from "@/lib/atendimento/events"
import { docCode, markDocumentSent, type DocumentKind, type DocumentStatus } from "./documents"

// ═══════════════════════════════════════════════════════════════
// Envio de cotação numa conversa — NÚCLEO sem-sessão (reuso humano + IA)
// ═══════════════════════════════════════════════════════════════
// Núcleo do "mandar o PDF da cotação no WhatsApp" pra a tool da IA (send_quote): a
// garantia de escopo é o documento pertencer ao CONTATO da conversa (anti-IDOR aqui).
// Só documento ATIVO/ENVIADO (autorizado por humano) sai — nunca rascunho.
// ⚠️ DÉBITO (auditoria 2026-07-24): a action de sessão sendQuoteInChat (actions/
// documents.ts) AINDA duplica este corpo de envio — refatorar pra delegar aqui num
// follow-up (mantidas as divergências dela: rejeita meta_cloud, seta ai_handling=false).

const CHAT_BUCKET = "chat-attachments"

export interface SendQuoteResult { ok: true; conversationId: string }

/**
 * Envia o PDF de `docId` na conversa `conversationId`. `actorUserId` = atendente
 * (humano) ou null (IA). Gates fail-closed: doc do MESMO contato da conversa +
 * canal WhatsApp + janela 24h. Não faz visibilidade por-atendente (é do chamador
 * com sessão). Marca a cotação como ENVIADA em sucesso.
 */
export async function sendQuoteToConversation(params: {
  tenantId: string; docId: string; conversationId: string
  actorUserId: string | null; caption?: string | null
}): Promise<SendQuoteResult | { error: string }> {
  const { tenantId, docId, conversationId, actorUserId } = params

  const { data: docRow } = await supabaseAdmin.from("commercial_documents")
    .select("contact_id, pdf_path, kind, year, number, status")
    .eq("id", docId).eq("tenant_id", tenantId).maybeSingle()
  const doc = docRow as { contact_id: string | null; pdf_path: string | null; kind: DocumentKind; year: number; number: number | null; status: DocumentStatus } | null
  if (!doc) return { error: "Documento não encontrado" }
  // Só o que o humano AUTORIZOU (active) ou já mandou (sent). Rascunho/anulada não saem.
  if (doc.status !== "active" && doc.status !== "sent") return { error: "Esta cotação ainda não está pronta para envio." }
  if (!doc.pdf_path || doc.number == null) return { error: "PDF da cotação indisponível." }
  if (!doc.contact_id) return { error: "Cotação sem cliente vinculado." }

  const { data: convRow } = await supabaseAdmin.from("chat_conversations")
    .select("id, contact_id, instance_id, assigned_to, channel, last_inbound_at, whatsapp_instances!instance_id(provider), chat_contacts(phone_number, primary_channel, bsuid)")
    .eq("id", conversationId).eq("tenant_id", tenantId).maybeSingle()
  if (!convRow) return { error: "Conversa não encontrada." }
  const conv = convRow as unknown as {
    id: string; contact_id: string | null; instance_id: string | null; assigned_to: string | null
    channel: string | null; last_inbound_at: string | null
    whatsapp_instances?: { provider: string | null } | { provider: string | null }[] | null
    chat_contacts?: { phone_number: string | null; primary_channel: string | null; bsuid: string | null } | null
  }

  // ⛔ ANTI-IDOR: a cotação PRECISA ser do contato desta conversa (o único elo que
  // impede a IA — ou um docId trocado — de vazar proposta de terceiro).
  if (!conv.contact_id || conv.contact_id !== doc.contact_id) return { error: "A cotação não pertence a este cliente." }
  if (!conv.instance_id) return { error: "Conversa sem instância." }

  const contact = (Array.isArray(conv.chat_contacts) ? conv.chat_contacts[0] : conv.chat_contacts) ?? null
  const channel = contact?.primary_channel ?? conv.channel ?? "whatsapp"
  if (channel !== "whatsapp" && channel !== "meta_cloud") return { error: "Envio de cotação disponível só no WhatsApp." }

  const inst = conv.whatsapp_instances
  const providerKind = Array.isArray(inst) ? (inst[0]?.provider ?? null) : (inst?.provider ?? null)
  if (!isWindowOpen(conv.channel, providerKind, conv.last_inbound_at)) {
    return { error: "Janela de atendimento fechada — precisa de um template pra reabrir." }
  }

  const now = new Date().toISOString()

  // Pool + atendente humano → vira responsável (igual sendQuoteInChat). IA não assume.
  if (conv.assigned_to === null && actorUserId) {
    await supabaseAdmin.from("chat_conversations")
      .update({ assigned_to: actorUserId, updated_at: now }).eq("id", conv.id).is("assigned_to", null)
    await logConversationEvent({ tenantId, conversationId: conv.id, type: "assigned", actorKind: "agent", actorId: actorUserId, toAgentId: actorUserId, reason: "auto_assign_pool" })
  }

  const { data: signed } = await supabaseAdmin.storage.from(CHAT_BUCKET).createSignedUrl(doc.pdf_path, 3600)
  if (!signed?.signedUrl) return { error: "Erro ao ler o PDF da cotação." }

  const code = docCode(doc.kind, doc.number, doc.year)
  const fileName = `${code.replace("/", "-")}.pdf`
  const text = params.caption?.trim() || null

  const { data: msg, error: dbErr } = await supabaseAdmin.from("chat_messages").insert({
    conversation_id: conv.id, tenant_id: tenantId,
    // IA envia como bot; humano como agent (mesmo padrão do resto).
    sender_type: actorUserId ? "agent" : "bot", sender_id: actorUserId,
    content_type: "document", content: text,
    media_url: signed.signedUrl, media_mime_type: "application/pdf", media_file_name: fileName,
    status: "pending", is_private_note: false,
    metadata: { storage_path: doc.pdf_path, document_id: docId, ...(actorUserId ? {} : { ai: true, studio: true }) },
  }).select("id").single()
  if (dbErr || !msg) return { error: dbErr?.message ?? "Erro ao salvar a mensagem." }

  try {
    const { data: instData } = await supabaseAdmin.from("whatsapp_instances").select("*").eq("id", conv.instance_id).eq("tenant_id", tenantId).maybeSingle()
    if (!instData) throw new Error("Instância da conversa não encontrada.")
    const provider = getProvider(instData)
    const result = await provider.sendMedia(contact?.phone_number ?? contact?.bsuid ?? "", signed.signedUrl, "document", text ?? undefined, fileName)
    await supabaseAdmin.from("chat_messages").update({ whatsapp_msg_id: result.messageId || null, status: "sent" }).eq("id", msg.id)
    await supabaseAdmin.from("whatsapp_instances").update({ last_outbound_message_at: now }).eq("id", conv.instance_id)
  } catch (err) {
    await supabaseAdmin.from("chat_messages").update({ status: "failed" }).eq("id", msg.id)
    const m = (err as Error).message ?? ""
    if (m.includes("131047")) return { error: "A janela de 24h fechou — precisa de um template pra reabrir." }
    return { error: `Não consegui enviar a cotação: ${m}` }
  }

  await supabaseAdmin.from("chat_conversations").update({
    last_message_at: now, last_message_preview: text?.slice(0, 100) || "📎 Cotação",
    last_message_dir: "out", flagged_pending: false, updated_at: now,
  }).eq("id", conv.id)

  await markDocumentSent(tenantId, actorUserId, docId)
  return { ok: true, conversationId: conv.id }
}
