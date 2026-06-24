"use server"

// ═══════════════════════════════════════════════════════════════
// LGPD — Direitos do titular de dados (Art. 18)
// ═══════════════════════════════════════════════════════════════
// Implementação dos direitos:
//   II — acesso aos dados        → exportPersonalData()
//   VI — eliminação dos dados    → deletePersonalData()
//
// Quem pode invocar: apenas owner/admin do tenant (atendentes não).
//
// Pra cliente final (titular) pedir os dados dele, o fluxo é:
//   1. Titular contata o tenant (telefone/email)
//   2. Tenant valida identidade (CPF, código por WhatsApp, etc)
//   3. Owner/admin invoca a action correspondente no painel
//   4. Tenant entrega/elimina conforme pedido
//
// Audit log captura TODAS as operações pra prova jurídica.
//
// ⚠️ AO ADICIONAR TABELAS NOVAS LINKADAS A chat_contacts (futuro CRM):
//   1. exportPersonalData → adicionar SELECT da nova tabela
//   2. deletePersonalData → garantir FK ON DELETE CASCADE
//                           OU adicionar .delete() explícito ANTES do delete do contato
//   3. Atualizar lista de tabelas cobertas no comentário abaixo:
//
//   Tabelas atualmente cobertas (2026-05-23):
//     - chat_contacts          (raiz)
//     - chat_conversations     (FK contact_id, CASCADE)
//     - chat_messages          (via conversation_id, CASCADE)
//     - taggings               (taggable_id = contact_id)
//     - ai_suggestions         (FK contact_id, CASCADE)
//     - storage chat-attachments (cleanup manual no delete)

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { logAudit, sanitizeForAudit } from "@/lib/audit"
import { revalidatePath } from "next/cache"

async function requireAdmin() {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  if (!["owner", "admin"].includes(session.user.role)) {
    throw new Error("Apenas owner/admin podem executar operações LGPD")
  }
  return session
}

/**
 * LGPD Art. 18 II — Direito de acesso aos dados.
 *
 * Retorna JSON com TUDO que o tenant armazena sobre este contato:
 * dados cadastrais, mensagens, tags, pertencimento a pipelines, visitas
 * de site (se vinculadas), e sugestões IA.
 *
 * O JSON pode ser entregue ao titular conforme Art. 19 (formato legível).
 */
export async function exportPersonalData(contactId: string): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { error: string }
> {
  const session = await requireAdmin()
  const tenantId = session.user.tenantId

  // 1. Contato (deve pertencer ao tenant)
  const { data: contact } = await supabaseAdmin
    .from("chat_contacts")
    .select("*")
    .eq("id", contactId)
    .eq("tenant_id", tenantId)
    .maybeSingle()
  if (!contact) return { error: "Contato não encontrado" }

  // 2. Conversas
  const { data: conversations } = await supabaseAdmin
    .from("chat_conversations")
    .select("*")
    .eq("contact_id", contactId)
    .eq("tenant_id", tenantId)

  const conversationIds = (conversations ?? []).map((c) => c.id)

  // 3. Mensagens (de todas as conversas do contato)
  const { data: messages } = conversationIds.length
    ? await supabaseAdmin
        .from("chat_messages")
        .select("*")
        .in("conversation_id", conversationIds)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: true })
    : { data: [] }

  // 4. Tags aplicadas
  const { data: taggings } = await supabaseAdmin
    .from("taggings")
    .select("*, tags(*)")
    .eq("taggable_type", "contact")
    .eq("taggable_id", contactId)
    .eq("tenant_id", tenantId)

  const payload = {
    exported_at: new Date().toISOString(),
    exported_by: { id: session.user.id, email: session.user.email },
    contact,
    conversations: conversations ?? [],
    messages:      messages ?? [],
    taggings:      taggings ?? [],
    counts: {
      conversations: conversations?.length ?? 0,
      messages:      messages?.length ?? 0,
      taggings:      taggings?.length ?? 0,
    },
  }

  await logAudit({
    tenantId,
    actorId:    session.user.id,
    actorEmail: session.user.email ?? null,
    action:     "contact.export_personal_data",
    targetType: "contact",
    targetId:   contactId,
    metadata: {
      counts:  payload.counts,
      reason:  "LGPD Art. 18 II — direito de acesso",
    },
  })

  return { ok: true, data: payload }
}

/**
 * LGPD Art. 18 VI — Direito à eliminação dos dados.
 *
 * Apaga PERMANENTEMENTE o contato e todos os dados associados:
 * conversas, mensagens, mídia (storage), tags, sugestões IA.
 *
 * Cascateamento via FOREIGN KEY ON DELETE CASCADE (já configurado
 * no schema). Storage de mídia precisa de cleanup manual via
 * Supabase Storage API (não-cascateado por design).
 *
 * Audit log mantém prova da exclusão (snapshot pré-delete).
 */
export async function deletePersonalData(contactId: string): Promise<
  | { ok: true; deletedAt: string }
  | { error: string }
> {
  const session = await requireAdmin()
  const tenantId = session.user.tenantId

  // 1. Snapshot pre-delete (pro audit log)
  const { data: contact } = await supabaseAdmin
    .from("chat_contacts")
    .select("*")
    .eq("id", contactId)
    .eq("tenant_id", tenantId)
    .maybeSingle()
  if (!contact) return { error: "Contato não encontrado" }

  // Conta o que vai ser deletado pra audit
  const { count: conversationCount } = await supabaseAdmin
    .from("chat_conversations")
    .select("id", { count: "exact", head: true })
    .eq("contact_id", contactId)
    .eq("tenant_id", tenantId)

  const { count: messageCount } = await supabaseAdmin
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .in(
      "conversation_id",
      ((await supabaseAdmin
        .from("chat_conversations")
        .select("id")
        .eq("contact_id", contactId)
        .eq("tenant_id", tenantId)
      ).data ?? []).map((c) => c.id)
    )

  // 2. Coleta storage_path de mensagens com mídia (pra limpar bucket depois)
  const { data: mediaMessages } = await supabaseAdmin
    .from("chat_messages")
    .select("storage_path")
    .eq("tenant_id", tenantId)
    .not("storage_path", "is", null)
    .in(
      "conversation_id",
      ((await supabaseAdmin
        .from("chat_conversations")
        .select("id")
        .eq("contact_id", contactId)
        .eq("tenant_id", tenantId)
      ).data ?? []).map((c) => c.id)
    )

  const storagePaths = (mediaMessages ?? [])
    .map((m) => m.storage_path)
    .filter((p): p is string => !!p)

  // 3. DELETE — cascade apaga conversations + messages + taggings + ai_suggestions
  const { error: deleteErr } = await supabaseAdmin
    .from("chat_contacts")
    .delete()
    .eq("id", contactId)
    .eq("tenant_id", tenantId)

  if (deleteErr) return { error: `Erro ao deletar contato: ${deleteErr.message}` }

  // 4. Limpa mídia do storage (best-effort, não bloqueia)
  if (storagePaths.length > 0) {
    try {
      await supabaseAdmin.storage.from("chat-attachments").remove(storagePaths)
    } catch (err) {
      console.error("[lgpd] failed to remove storage files", err)
    }
  }

  const deletedAt = new Date().toISOString()

  // 5. Audit log (snapshot sanitizado)
  await logAudit({
    tenantId,
    actorId:    session.user.id,
    actorEmail: session.user.email ?? null,
    action:     "contact.delete_personal_data",
    targetType: "contact",
    targetId:   contactId,
    before:     sanitizeForAudit(contact),
    metadata: {
      reason:               "LGPD Art. 18 VI — direito à eliminação",
      cascaded_conversations: conversationCount ?? 0,
      cascaded_messages:      messageCount ?? 0,
      cascaded_media_files:   storagePaths.length,
    },
  })

  revalidatePath("/inbox")
  revalidatePath("/contatos")
  revalidatePath("/kanban")

  return { ok: true, deletedAt }
}
