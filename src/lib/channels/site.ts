// ═══════════════════════════════════════════════════════════════
// Site-chat — contato + conversa do visitante do widget (channel='site')
// ═══════════════════════════════════════════════════════════════
// Usa a fundação da Fase 1: contato sem telefone, identificado por
// (primary_channel='site', primary_external_id=visitor_id). A IA pode
// coletar o WhatsApp durante o papo (e a Fase 2 funde os contatos).

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { findOrReopenConversation } from "@/lib/conversation-dedup"

/**
 * Acha (ou cria) o contato anônimo do visitante por identidade de site.
 * `source='webform'` (aquisição, alinhado aos relatórios); identidade = visitor_id.
 */
export async function getOrCreateSiteContact(tenantId: string, visitorId: string): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from("chat_contacts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("primary_channel", "site")
    .eq("primary_external_id", visitorId)
    .maybeSingle()
  if (existing) return existing.id

  const { data: created, error } = await supabaseAdmin
    .from("chat_contacts")
    .insert({
      tenant_id:           tenantId,
      whatsapp_id:         null,                 // anônimo (Fase 1 permite)
      phone_number:        null,                 // sem telefone ainda
      push_name:           "Visitante do site",
      source:              "webform",
      primary_channel:     "site",
      primary_external_id: visitorId,
    })
    .select("id")
    .single()
  if (created) return created.id

  // Corrida (2 mensagens simultâneas): unique de identidade → refetch.
  if (error?.code === "23505") {
    const { data: again } = await supabaseAdmin
      .from("chat_contacts")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("primary_channel", "site")
      .eq("primary_external_id", visitorId)
      .single()
    if (again) return again.id
  }
  throw new Error(`Falha ao criar contato do site: ${error?.message ?? "desconhecido"}`)
}

/**
 * Acha (ou cria) a conversa do visitante (channel='site'). Reusa o dedup
 * canônico (1 conversa por contato). `instanceId` = instância WhatsApp do
 * tenant (instance_id é NOT NULL no schema; não é usada pra enviar no site).
 */
export async function getOrCreateSiteConversation(
  tenantId:   string,
  contactId:  string,
  instanceId: string,
): Promise<string> {
  const dedup = await findOrReopenConversation({ tenantId, contactId, skipOwnershipCheck: true })
  if (dedup.found !== "none") return dedup.conversation.id

  // Coloca no funil padrão (consistente com o lead de form).
  const { data: tc } = await supabaseAdmin
    .from("tenant_config")
    .select("default_pipeline_id")
    .eq("tenant_id", tenantId)
    .maybeSingle()

  const pipelineId: string | null = tc?.default_pipeline_id ?? null
  let stageId: string | null = null
  if (pipelineId) {
    const { data: firstStage } = await supabaseAdmin
      .from("pipeline_stages")
      .select("id")
      .eq("pipeline_id", pipelineId)
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle()
    stageId = firstStage?.id ?? null
  }

  const { data: created, error } = await supabaseAdmin
    .from("chat_conversations")
    .insert({
      tenant_id:     tenantId,
      contact_id:    contactId,
      instance_id:   instanceId,
      channel:       "site",
      status:        "open",
      unread_count:  0,
      pipeline_id:   pipelineId,
      stage_id:      stageId,
      assigned_to:   null,   // pool
      last_message_at: new Date().toISOString(),
    })
    .select("id")
    .single()
  if (error || !created) throw new Error(`Falha ao criar conversa do site: ${error?.message ?? "desconhecido"}`)
  return created.id
}
