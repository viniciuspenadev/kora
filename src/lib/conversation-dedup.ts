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
import { tenantAiActive } from "@/lib/ai/active"

export interface FindOrReopenInput {
  tenantId:          string
  contactId:         string
  /**
   * Escopa o dedup à instância (split por canal). Quando passado, só reusa/reabre
   * conversa da MESMA instância — o mesmo contato pode ter conversas separadas por
   * número/canal (Baileys vs Oficial). Omitir = comportamento legado (qualquer instância).
   */
  instanceId?:       string
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
  const { tenantId, contactId, instanceId, skipOwnershipCheck } = input

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
  const { data: resolved } = await resolvedQuery
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (resolved) {
    const wasArchived = !!resolved.archived_at
    const now = new Date().toISOString()

    // ── Política de Atendimento — VÍNCULO no retorno (docs/politica-atendimento.md §7) ──
    // Default (carteira) → `policy` vazio → update IDÊNTICO ao comportamento de hoje
    // (sticky). Pool e IA são opt-in por tenant (vínculo 3-way).
    const { data: cfg } = await supabaseAdmin
      .from("tenant_config")
      .select("handoff_binding, reopen_flow_id")
      .eq("tenant_id", tenantId)
      .maybeSingle()
    const binding = (cfg?.handoff_binding as string | undefined) ?? "carteira"
    const reopenFlowId = (cfg?.reopen_flow_id as string | undefined) ?? null
    // Vínculo='ai' só devolve pra IA se ela está ATIVA (módulo + ai_enabled). Senão
    // cai na FILA (humano) — nunca deixa órfão dependendo de uma IA desligada.
    const aiReturn = binding === "ai" ? await tenantAiActive(tenantId) : false
    const meta = ((resolved as { metadata?: Record<string, unknown> | null }).metadata) ?? {}

    const policy: Record<string, unknown> = {}
    if (aiReturn) {
      // IA tria o retorno: solta o responsável + libera a IA (limpa o marcador).
      // Se o tenant escolheu um fluxo de retorno, FIXA ele (o run.ts roda exatamente
      // esse na próxima mensagem — sem passar pelo gatilho do fluxo de captação).
      policy.assigned_to = null
      policy.ai_handling = true
      const m: Record<string, unknown> = { ...meta }
      delete m.ai_routed
      if (reopenFlowId) m.ai_pinned_flow = reopenFlowId
      policy.metadata = m
    } else if (binding === "pool" || binding === "ai") {
      // Pool (ou 'ai' com IA inativa → fail-safe): cai na FILA do setor (humano).
      // Solta o responsável + bloqueia a IA.
      policy.assigned_to = null
      policy.ai_handling = false
      const via = binding === "ai" ? "ai_inactive_reopen" : "pool_reopen"
      if (!meta.ai_routed) policy.metadata = { ...meta, ai_routed: { at: now, via } }
    }
    // carteira (default): nada — mantém assigned_to (sticky). Stage/lifecycle INTACTOS.

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
      .select("*")
      .single()
    if (reopenErr || !reopened) {
      // Race: outra request reabriu/mudou. Refetch.
      const { data: refetched } = await supabaseAdmin
        .from("chat_conversations")
        .select("*")
        .eq("id", resolved.id)
        .eq("tenant_id", tenantId)
        .maybeSingle()
      if (refetched) return { found: "reopened", conversation: refetched as ConversationRow, wasArchived }
      throw new Error("Falha ao reabrir conversa")
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
