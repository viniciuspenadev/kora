"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { requireModule } from "@/lib/modules"
import { getViewerScope, seesAllDeals, canViewConversation } from "@/lib/visibility"
import { canAccessDeal } from "@/lib/actions/deals"
import { getProvider } from "@/lib/providers"
import { isWindowOpen } from "@/lib/channels/policy"
import { logConversationEvent } from "@/lib/atendimento/events"
import {
  createQuote, createNewVersion, getDealDocuments, getDocumentSettings,
  markDocumentSent, markDocumentAccepted, markDocumentDeclined, voidDocument,
  docCode,
  type DocumentRow, type DocumentSettings, type DocumentConditionsInput, type CreateQuoteInput,
  type DocumentKind, type DocumentStatus,
} from "@/lib/commercial/documents"
import { revalidatePath } from "next/cache"

// ═══════════════════════════════════════════════════════════════
// Documentos (cotações) — wrappers GATED do domínio commercial/documents.ts.
// Gate = o MESMO das actions de deals: módulo crm + acesso ao NEGÓCIO
// (gestor/seesAllDeals, dono, ou acesso via conversa — canAccessDeal).
// Leitura e mutação usam o mesmo alcance (cotação é artefato do negócio).
// ═══════════════════════════════════════════════════════════════

interface Gate { tenantId: string; userId: string }

/** Acesso ao negócio (fail-closed): gestor OU dono OU alcança o contato via conversa. */
async function requireDealAccess(dealId: string): Promise<Gate | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  const t = session.user.tenantId

  const { data: deal } = await supabaseAdmin.from("tenant_deals")
    .select("contact_id, assigned_to").eq("id", dealId).eq("tenant_id", t).maybeSingle()
  if (!deal) return { error: "Negócio não encontrado" }
  const d = deal as { contact_id: string | null; assigned_to: string | null }

  const scope = await getViewerScope()
  const mine = d.assigned_to === session.user.id
  if (!seesAllDeals(scope) && !mine && !(await canAccessDeal(t, d.contact_id))) {
    return { error: "Sem acesso a este negócio" }
  }
  return { tenantId: t, userId: session.user.id }
}

/** Mesmo gate, partindo do DOCUMENTO (resolve o negócio dele primeiro). */
async function requireDocumentAccess(docId: string): Promise<(Gate & { dealId: string | null }) | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  const { data: doc } = await supabaseAdmin.from("commercial_documents")
    .select("deal_id").eq("id", docId).eq("tenant_id", session.user.tenantId).maybeSingle()
  if (!doc) return { error: "Documento não encontrado" }
  const dealId = (doc as { deal_id: string | null }).deal_id
  if (!dealId) {
    // Documento órfão (deal excluído): só gestor mexe.
    try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
    const scope = await getViewerScope()
    if (!seesAllDeals(scope)) return { error: "Sem acesso a este documento" }
    return { tenantId: session.user.tenantId, userId: session.user.id, dealId: null }
  }
  const gate = await requireDealAccess(dealId)
  if ("error" in gate) return gate
  return { ...gate, dealId }
}

function refreshDeal(dealId: string | null) {
  if (dealId) revalidatePath(`/negocios/${dealId}`)
}

// ── Geração ──────────────────────────────────────────────────────

export async function generateQuote(input: CreateQuoteInput): Promise<{ id: string; code: string } | { error: string }> {
  const gate = await requireDealAccess(input.dealId)
  if ("error" in gate) return gate
  const res = await createQuote(gate.tenantId, gate.userId, input)
  if (!("error" in res)) refreshDeal(input.dealId)
  return res
}

export async function generateQuoteVersion(docId: string, cond: DocumentConditionsInput): Promise<{ id: string; code: string } | { error: string }> {
  const gate = await requireDocumentAccess(docId)
  if ("error" in gate) return gate
  const res = await createNewVersion(gate.tenantId, gate.userId, docId, cond)
  if (!("error" in res)) refreshDeal(gate.dealId)
  return res
}

// ── Leituras ─────────────────────────────────────────────────────

/** Cotações do negócio (card "Cotações" da sidebar). Vazio quando sem acesso. */
export async function getQuotesForDeal(dealId: string): Promise<DocumentRow[]> {
  const gate = await requireDealAccess(dealId)
  if ("error" in gate) return []
  return getDealDocuments(gate.tenantId, dealId)
}

/** Padrão da empresa (pré-preenche o modal de gerar). */
export async function getQuoteDefaults(): Promise<DocumentSettings | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  return getDocumentSettings(session.user.tenantId)
}

// ── Transições ───────────────────────────────────────────────────

export async function markQuoteSent(docId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireDocumentAccess(docId)
  if ("error" in gate) return gate
  const res = await markDocumentSent(gate.tenantId, gate.userId, docId)
  if (!("error" in res)) refreshDeal(gate.dealId)
  return res
}

export async function markQuoteAccepted(docId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireDocumentAccess(docId)
  if ("error" in gate) return gate
  const res = await markDocumentAccepted(gate.tenantId, gate.userId, docId)
  if (!("error" in res)) refreshDeal(gate.dealId)
  return res
}

export async function markQuoteDeclined(docId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireDocumentAccess(docId)
  if ("error" in gate) return gate
  const res = await markDocumentDeclined(gate.tenantId, gate.userId, docId)
  if (!("error" in res)) refreshDeal(gate.dealId)
  return res
}

export async function voidQuote(docId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireDocumentAccess(docId)
  if ("error" in gate) return gate
  const res = await voidDocument(gate.tenantId, gate.userId, docId)
  if (!("error" in res)) refreshDeal(gate.dealId)
  return res
}

// ── Envio no chat (D3) ───────────────────────────────────────────
// ESPELHA o caminho de mídia do chat (src/lib/actions/chat.ts sendChatMedia):
// mesma regra de visibilidade (canViewConversation — FONTE ÚNICA), mesmo gate
// fail-closed de janela de canal (isWindowOpen), mesmo auto-assign do pool, mesmo
// formato de mensagem de documento (content_type=document + metadata.storage_path
// pra o proxy /api/media). Diferença: o PDF já está congelado no storage (pdf_path),
// então não há upload — só signed URL sobre o arquivo existente.

const CHAT_BUCKET = "chat-attachments"

/** Provider da instância dona da conversa (mesma resolução do chat.ts). */
async function providerForConversationInstance(instanceId: string, tenantId: string) {
  const { data } = await supabaseAdmin
    .from("whatsapp_instances").select("*").eq("id", instanceId).eq("tenant_id", tenantId).maybeSingle()
  if (!data) throw new Error("Instância da conversa não encontrada.")
  return getProvider(data)
}

/**
 * Envia a cotação (PDF congelado) como DOCUMENTO na conversa do contato.
 * Resolve a conversa a partir de commercial_documents.contact_id → a conversa
 * mais recente NÃO-arquivada do tenant com esse contato. Sem conversa → orienta
 * abrir uma primeiro (nunca falha silenciosa). Em sucesso marca a cotação como
 * ENVIADA (motor) e devolve o id da conversa.
 */
export async function sendQuoteInChat(
  docId: string, caption: string,
): Promise<{ ok: true; conversationId: string } | { error: string }> {
  const gate = await requireDocumentAccess(docId)
  if ("error" in gate) return gate
  const { tenantId, userId } = gate

  const { data: docRow } = await supabaseAdmin
    .from("commercial_documents")
    .select("contact_id, pdf_path, kind, year, number, status")
    .eq("id", docId).eq("tenant_id", tenantId).maybeSingle()
  const doc = docRow as { contact_id: string | null; pdf_path: string | null; kind: DocumentKind; year: number; number: number; status: DocumentStatus } | null
  if (!doc) return { error: "Documento não encontrado" }
  if (!doc.pdf_path) return { error: "PDF da cotação indisponível." }
  if (!doc.contact_id) return { error: "Cotação sem cliente vinculado." }

  // Conversa do contato: a mais recente não-arquivada do tenant.
  const { data: convRow } = await supabaseAdmin
    .from("chat_conversations")
    .select("id, contact_id, instance_id, assigned_to, participants, department_id, channel, last_inbound_at, whatsapp_instances!instance_id(provider), chat_contacts(phone_number, primary_channel, bsuid)")
    .eq("tenant_id", tenantId).eq("contact_id", doc.contact_id).is("archived_at", null)
    .order("last_message_at", { ascending: false }).limit(1).maybeSingle()
  if (!convRow) return { error: "Abra uma conversa com o cliente primeiro." }
  const conv = convRow as unknown as {
    id: string; instance_id: string; assigned_to: string | null; participants: string[] | null
    department_id: string | null; channel: string | null; last_inbound_at: string | null
    whatsapp_instances?: { provider: string | null } | { provider: string | null }[] | null
    chat_contacts?: { phone_number: string | null; primary_channel: string | null; bsuid: string | null } | null
  }

  // Visibilidade — regra ÚNICA do sistema (nunca duplicar inline).
  const scope = await getViewerScope()
  const assignedTo = conv.assigned_to
  if (!canViewConversation(scope, { assigned_to: assignedTo, participants: conv.participants, department_id: conv.department_id, instance_id: conv.instance_id })) {
    return { error: "Sem permissão para enviar nesta conversa. Peça para o atendente atribuído te adicionar como participante." }
  }

  // Documento só sai no WhatsApp (site-chat não tem envio de arquivo).
  const contact = (Array.isArray(conv.chat_contacts) ? conv.chat_contacts[0] : conv.chat_contacts) ?? null
  const channel = contact?.primary_channel ?? "whatsapp"
  if (channel !== "whatsapp") return { error: "Envio de cotação disponível só no WhatsApp." }

  // Gate fail-closed da janela de sessão (mesmo motor de canal do chat.ts).
  const inst = conv.whatsapp_instances
  const providerKind = Array.isArray(inst) ? (inst[0]?.provider ?? null) : (inst?.provider ?? null)
  if (!isWindowOpen(conv.channel, providerKind, conv.last_inbound_at)) {
    return { error: "Janela de atendimento fechada — envie um template aprovado pra reabrir a conversa." }
  }

  const now = new Date().toISOString()

  // Pool — primeiro a enviar vira responsável (auto-assign, igual sendChatMedia).
  if (assignedTo === null) {
    await supabaseAdmin.from("chat_conversations")
      .update({ assigned_to: userId, updated_at: now }).eq("id", conv.id).is("assigned_to", null)
    await logConversationEvent({ tenantId, conversationId: conv.id, type: "assigned", actorKind: "agent", actorId: userId, toAgentId: userId, reason: "auto_assign_pool" })
  }

  // PDF já congelado no storage — signed URL sobre o arquivo existente (sem re-upload).
  const { data: signed } = await supabaseAdmin.storage.from(CHAT_BUCKET).createSignedUrl(doc.pdf_path, 3600)
  if (!signed?.signedUrl) return { error: "Erro ao ler o PDF da cotação." }

  const code = docCode(doc.kind, doc.number, doc.year)
  const fileName = `${code.replace("/", "-")}.pdf`
  const text = caption?.trim() || null

  // Mensagem de documento — formato do sendChatMedia (metadata.storage_path faz o
  // proxy /api/media servir os bytes com URL estável).
  const { data: msg, error: dbErr } = await supabaseAdmin
    .from("chat_messages")
    .insert({
      conversation_id: conv.id, tenant_id: tenantId,
      sender_type: "agent", sender_id: userId,
      content_type: "document", content: text,
      media_url: signed.signedUrl, media_mime_type: "application/pdf", media_file_name: fileName,
      status: "pending", is_private_note: false,
      metadata: { storage_path: doc.pdf_path, document_id: docId },
    })
    .select("id").single()
  if (dbErr || !msg) return { error: dbErr?.message ?? "Erro ao salvar a mensagem." }

  try {
    const provider = await providerForConversationInstance(conv.instance_id, tenantId)
    const result = await provider.sendMedia(contact?.phone_number ?? contact?.bsuid ?? "", signed.signedUrl, "document", text ?? undefined, fileName)
    await supabaseAdmin.from("chat_messages")
      .update({ whatsapp_msg_id: result.messageId || null, status: "sent" }).eq("id", msg.id)
    await supabaseAdmin.from("whatsapp_instances")
      .update({ last_outbound_message_at: now }).eq("id", conv.instance_id)
  } catch (err) {
    await supabaseAdmin.from("chat_messages").update({ status: "failed" }).eq("id", msg.id)
    const m = (err as Error).message ?? ""
    // #131047 = janela de 24h fechada (verdade da Meta, sobrepõe nosso cálculo).
    if (m.includes("131047")) return { error: "A janela de 24h fechou — envie um template aprovado pra reabrir a conversa." }
    return { error: `Não consegui enviar a cotação: ${m}` }
  }

  await supabaseAdmin.from("chat_conversations").update({
    last_message_at: now, last_message_preview: text?.slice(0, 100) || "📎 Cotação",
    last_message_dir: "out", flagged_pending: false, ai_handling: false, updated_at: now,
  }).eq("id", conv.id)

  // Motor: transição pra ENVIADA + evento na espinha (best-effort — o envio já saiu).
  await markDocumentSent(tenantId, userId, docId)
  refreshDeal(gate.dealId)
  revalidatePath("/inbox")
  return { ok: true, conversationId: conv.id }
}
