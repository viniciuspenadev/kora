// ═══════════════════════════════════════════════════════════════
// context.ts — leituras de DB pra alimentar o motor
// ═══════════════════════════════════════════════════════════════
// Toda I/O fica aqui. evaluateTriggers + compilePrompt recebem o
// resultado já pronto e permanecem puros/testáveis.

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { LIFECYCLE_OPTIONS } from "@/lib/ai/describe"
import type { TriggerEvalState } from "@/lib/ai/evaluate-triggers"
import type { CompileContact } from "@/lib/ai/compile-prompt"
import type { ContextPayloadKey } from "@/types/ai"

export interface ConvRow {
  id:           string
  contact_id:   string | null
  stage_id:     string | null
  from_ad_meta: unknown | null
}

export interface ContactRow {
  id:              string
  custom_name:     string | null
  push_name:       string | null
  phone_number:    string
  email:           string | null
  company:         string | null
  lifecycle_stage: string
  notes:           string | null
  source:          string
  primary_channel: string | null
}

const HISTORY_LIMIT = 20

export function displayName(c: ContactRow): string {
  return c.custom_name?.trim() || c.push_name?.trim() || c.phone_number
}

/**
 * created_at (ISO) da última mensagem do contato nesta conversa, ou null.
 * Usado pelo debounce do webhook: comparar baseline vs pós-janela (DB↔DB,
 * sem clock skew) pra saber se chegou mensagem mais nova na rajada.
 */
export async function latestInboundAt(conversationId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("chat_messages")
    .select("created_at")
    .eq("conversation_id", conversationId)
    .eq("sender_type", "contact")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.created_at ?? null
}

function lifecycleLabel(stage: string): string {
  return LIFECYCLE_OPTIONS.find((o) => o.value === stage)?.label ?? stage
}

/** Tag ids aplicadas no contato. */
async function getContactTagIds(tenantId: string, contactId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("taggings")
    .select("tag_id")
    .eq("tenant_id", tenantId)
    .eq("taggable_type", "contact")
    .eq("taggable_id", contactId)
  return (data ?? []).map((t) => t.tag_id)
}

/**
 * Monta o estado determinístico pra evaluateTriggers.
 * `incomingText` é a mensagem que acabou de chegar.
 */
export async function gatherTriggerState(
  tenantId:     string,
  conv:         ConvRow,
  contact:      ContactRow,
  incomingText: string,
): Promise<TriggerEvalState> {
  const tagIds = await getContactTagIds(tenantId, contact.id)

  // Mensagens do contato nesta conversa (pra first-message + inatividade).
  const { data: contactMsgs } = await supabaseAdmin
    .from("chat_messages")
    .select("created_at")
    .eq("conversation_id", conv.id)
    .eq("sender_type", "contact")
    .order("created_at", { ascending: false })
    .limit(2)

  const msgs = contactMsgs ?? []
  // A mensagem que acabou de chegar já está persistida (webhook insere antes
  // de despachar), então 1 = primeira da sessão.
  const isFirstMessageOfSession = msgs.length <= 1

  let inactive24h = false
  if (msgs.length >= 2) {
    const prev = new Date(msgs[1].created_at).getTime()
    inactive24h = Date.now() - prev > 24 * 60 * 60 * 1000
  }

  const lifecycle = contact.lifecycle_stage
  return {
    isKnownContact:          lifecycle !== "contact" || tagIds.length > 0,
    lifecycle,
    tagIds,
    stageId:                 conv.stage_id,
    source:                  contact.source,        // canônico (chat_contacts.source)
    fromAd:                  !!conv.from_ad_meta,    // veio de anúncio (CTWA)
    isFirstMessageOfSession,
    inactive24h,
    incomingTextLower:       incomingText.toLowerCase(),
  }
}

export interface PromptContextResult {
  contact: CompileContact
  history: { role: "user" | "assistant"; content: string }[]
}

/**
 * Resolve o contexto pro compilePrompt (nomes, não ids) + histórico da
 * conversa como mensagens. `contextKeys` decide o que injetar.
 */
export async function gatherPromptContext(
  tenantId:    string,
  conv:        ConvRow,
  contact:     ContactRow,
  contextKeys: ContextPayloadKey[],
): Promise<PromptContextResult> {
  const wants = new Set(contextKeys)

  // Tags (nomes) — só se pedido
  let tagNames: string[] = []
  if (wants.has("contact_tags")) {
    const tagIds = await getContactTagIds(tenantId, contact.id)
    if (tagIds.length > 0) {
      const { data } = await supabaseAdmin
        .from("tags")
        .select("name")
        .eq("tenant_id", tenantId)
        .in("id", tagIds)
      tagNames = (data ?? []).map((t) => t.name)
    }
  }

  // Stage name — só se pedido
  let stageName: string | null = null
  if (wants.has("pipeline_stage") && conv.stage_id) {
    const { data } = await supabaseAdmin
      .from("pipeline_stages")
      .select("name")
      .eq("id", conv.stage_id)
      .eq("tenant_id", tenantId)
      .maybeSingle()
    stageName = data?.name ?? null
  }

  // Histórico — só se pedido
  let history: PromptContextResult["history"] = []
  if (wants.has("conversation_history")) {
    const { data } = await supabaseAdmin
      .from("chat_messages")
      .select("sender_type, content, content_type, is_private_note, created_at")
      .eq("conversation_id", conv.id)
      .eq("is_private_note", false)
      .in("sender_type", ["contact", "agent", "bot"])
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT)

    history = (data ?? [])
      .reverse()
      .filter((m) => m.content && m.content.trim().length > 0)
      .map((m) => ({
        role:    m.sender_type === "contact" ? ("user" as const) : ("assistant" as const),
        content: m.content as string,
      }))
  }

  const contact_: CompileContact = {
    name:      wants.has("contact_fields") ? displayName(contact) : null,
    lifecycle: wants.has("contact_lifecycle") ? lifecycleLabel(contact.lifecycle_stage) : null,
    tags:      tagNames,
    lastNote:  wants.has("last_internal_note") ? contact.notes : null,
    stageName,
  }

  return { contact: contact_, history }
}
