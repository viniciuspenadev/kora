// ═══════════════════════════════════════════════════════════════
// Conversation Dedup — regra única do Kora
// ═══════════════════════════════════════════════════════════════
// Padrão de SAC moderno: SEMPRE 1 conversa por contato (zero duplicação).
//
// Regra:
//   1. Se existe conversa ATIVA (open/pending/snoozed) → reusa, unarchive se necessário
//   2. Senão, se existe QUALQUER conversa fechada (resolved), independente
//      de quanto tempo atrás → REABRE (status → open + unarchive se necessário)
//   3. Senão → caller cria nova
//
// Quando reabre: stage do kanban, lifecycle, won_at, lost_at → INTACTOS.
// (Decisão do user: manter contexto histórico. Cliente que era "won" volta a
// falar = conv reaparece na coluna "Ganho" do kanban. Atendente move se quiser.)
//
// Unarchive: msg nova num contato que tinha conv arquivada **automaticamente
// desarquiva** — o contato se manifestou, então a conv volta a ser visível
// pro atendente.
//
// HISTÓRICO:
//   - Antes: janela de 7 dias pra reabrir. Após isso, criava nova.
//   - 2026-05-26: removida janela — 1 conv pra sempre por contato.
//
// SEGURANÇA:
//  - tenantId sempre de session.user.tenantId (NUNCA input do cliente)
//  - contactId validado pertencer ao tenant antes de qualquer write
//  - Toda query com .eq('tenant_id') explícito

import { supabaseAdmin } from "@/lib/supabase"
import { tenantAiActive } from "@/lib/llm/active"
import { channelDispatchesAI } from "@/lib/ai-v2/dispatch"
import { logConversationEvent } from "@/lib/atendimento/events"
import { routeToHumanDefault } from "@/lib/atendimento/human-routing"

export interface FindOrReopenInput {
  tenantId:          string
  contactId:         string
  /**
   * Escopa o dedup à instância (número). Quando passado, só reusa/reabre conversa da
   * MESMA instância — multi-número: o mesmo contato tem fios separados por número.
   * null/undefined = sem escopo de instância (canal sem número: IG/site).
   */
  instanceId?:       string | null
  /**
   * Escopa o dedup ao CANAL (whatsapp | instagram | site …). O mesmo contato pode ter
   * um fio ATIVO por canal simultaneamente (WhatsApp + Instagram coexistem). Junto com
   * instanceId, a chave do fio é (contato, canal, instância). Omitir = legado (qualquer canal).
   */
  channel?:          string | null
  /** Pula a validação de ownership do contato (usado pelo webhook que já validou upstream). */
  skipOwnershipCheck?: boolean
}

export type FindOrReopenResult =
  | { found: "active";   conversation: ConversationRow; wasArchived: boolean }  // tinha aberta (talvez archived → unarchive)
  | { found: "reopened"; conversation: ConversationRow; wasArchived: boolean }  // estava fechada → status virou open
  | { found: "none";     conversation: null;            wasArchived: false }    // caller cria nova

export interface ConversationRow {
  id:                string
  tenant_id:         string
  contact_id:        string
  instance_id:       string | null
  status:            string
  channel:           string | null
  pipeline_id:       string | null
  stage_id:          string | null
  assigned_to:       string | null
  metadata:          Record<string, unknown> | null
  created_at:        string
  updated_at:        string
  [key: string]: unknown
}

/**
 * Procura conversa existente OU reabre fechada. Não cria nova
 * — caller decide se cria conforme retorno `found === "none"`.
 *
 * Auto-unarchive: se a conv encontrada estava arquivada, desarquiva
 * (admin tinha escondido, mas cliente voltou a falar → re-exibe).
 */
export async function findOrReopenConversation(
  input: FindOrReopenInput,
): Promise<FindOrReopenResult> {
  const { tenantId, contactId, instanceId, channel, skipOwnershipCheck } = input

  // ── 1. Valida ownership do contato (anti-IDOR) ──
  // Webhook pula porque já validou contact via findOrCreateContact upstream.
  if (!skipOwnershipCheck) {
    const { data: contact } = await supabaseAdmin
      .from("chat_contacts")
      .select("id")
      .eq("id", contactId)
      .eq("tenant_id", tenantId)
      .maybeSingle()
    if (!contact) {
      throw new Error("Contato não encontrado ou não pertence ao tenant")
    }
  }

  // ── 2. Conversa ativa? (open/pending/snoozed) ──
  let activeQuery = supabaseAdmin
    .from("chat_conversations")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("contact_id", contactId)
    .in("status", ["open", "pending", "snoozed"])
  if (instanceId) activeQuery = activeQuery.eq("instance_id", instanceId)
  if (channel)    activeQuery = activeQuery.eq("channel", channel)
  const { data: active } = await activeQuery
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (active) {
    const wasArchived = !!active.archived_at
    if (wasArchived) {
      // Desarquiva — cliente se manifestou, conv volta a ser visível.
      const { data: updated } = await supabaseAdmin
        .from("chat_conversations")
        .update({ archived_at: null, updated_at: new Date().toISOString() })
        .eq("id", active.id)
        .eq("tenant_id", tenantId)
        .select("*")
        .single()
      await supabaseAdmin.from("chat_messages").insert({
        conversation_id: active.id,
        tenant_id:       tenantId,
        sender_type:     "system",
        content_type:    "text",
        content:         "Conversa restaurada — contato retornou.",
        status:          "delivered",
        is_private_note: false,
      })
      return { found: "active", conversation: (updated ?? active) as ConversationRow, wasArchived: true }
    }
    return { found: "active", conversation: active as ConversationRow, wasArchived: false }
  }

  // ── 3. Conversa fechada (resolved)? Reabre, qualquer idade. ──
  let resolvedQuery = supabaseAdmin
    .from("chat_conversations")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("contact_id", contactId)
    .eq("status", "resolved")
  if (instanceId) resolvedQuery = resolvedQuery.eq("instance_id", instanceId)
  if (channel)    resolvedQuery = resolvedQuery.eq("channel", channel)
  const { data: resolved } = await resolvedQuery
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (resolved) {
    const wasArchived = !!resolved.archived_at
    const now = new Date().toISOString()

    // Vínculo só controla o carimbo. Todo retorno oferece a entrada ao Studio;
    // sem Studio, o núcleo resolve responsável elegível ou fila.
    const convChannel = resolved.channel ?? "whatsapp"
    const aiFirst = channelDispatchesAI(convChannel) && await tenantAiActive(tenantId)
    const metadata = { ...((resolved.metadata ?? {}) as Record<string, unknown>) }
    metadata.attendance_cycle = now
    delete metadata.ai_routed
    delete metadata.reopen_owner
    delete metadata.ai_pinned_flow
    delete metadata.studio_entry
    const policy = { assigned_to: null, department_id: null, ai_handling: aiFirst, metadata }

    // Só encerra execuções anteriores ao ciclo fechado. Nunca cancela um run novo
    // que outro inbound tenha iniciado depois desta leitura.
    const { error: runError } = await supabaseAdmin.from("studio_flow_runs")
      .update({ status: "done", resume_at: null, updated_at: now })
      .eq("tenant_id", tenantId).eq("conversation_id", resolved.id)
      .in("status", ["active", "waiting"]).lte("updated_at", resolved.updated_at)
    if (runError) throw new Error("Não foi possível encerrar o fluxo do atendimento anterior.")

    const { data: reopened, error: reopenErr } = await supabaseAdmin
      .from("chat_conversations")
      .update({
        status:      "open",
        updated_at:  now,
        resolved_at: null,
        ...(wasArchived ? { archived_at: null } : {}),
        ...policy,
      })
      .eq("id", resolved.id)
      .eq("tenant_id", tenantId)
      .eq("status", "resolved")
      .eq("updated_at", resolved.updated_at)
      .select("*")
      .single()
    if (reopened) {
      // Evento do ciclo (relatórios): cliente voltou. Guarda quem ficou dono
      // (carteira preservada = to_agent; pool = null) e se a IA tria o retorno.
      await logConversationEvent({
        tenantId, conversationId: resolved.id, type: "reopened",
        actorKind: "contact",
        toAgentId: (reopened as { assigned_to?: string | null }).assigned_to ?? null,
        meta:      { ai_first: aiFirst },
      })
    }

    if (reopenErr || !reopened) {
      // Race: outra request reabriu/mudou. Refetch.
      const { data: refetched } = await supabaseAdmin
        .from("chat_conversations")
        .select("*")
        .eq("id", resolved.id)
        .eq("tenant_id", tenantId)
        .maybeSingle()
      if (refetched && refetched.status !== "resolved") return { found: "active", conversation: refetched as ConversationRow, wasArchived }
      throw new Error("Falha ao reabrir conversa")
    }

    if (!aiFirst) {
      await routeToHumanDefault(tenantId, resolved.id, "reopened_without_studio")
      const { data: routed } = await supabaseAdmin.from("chat_conversations").select("*")
        .eq("tenant_id", tenantId).eq("id", resolved.id).maybeSingle()
      if (routed) Object.assign(reopened, routed)
    }

    // Mensagem de sistema indicando o reopen
    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: reopened.id,
      tenant_id:       tenantId,
      sender_type:     "system",
      content_type:    "text",
      content:         wasArchived
        ? "Conversa reaberta e restaurada — contato retornou."
        : "Conversa reaberta — contato retornou.",
      status:          "delivered",
      is_private_note: false,
    })

    return { found: "reopened", conversation: reopened as ConversationRow, wasArchived }
  }

  // ── 4. Não há nada reaproveitável — caller cria nova ──
  return { found: "none", conversation: null, wasArchived: false }
}
