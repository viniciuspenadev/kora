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
import { channelDispatchesAI } from "@/lib/ai-v2/dispatch"
import { logConversationEvent } from "@/lib/atendimento/events"

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

    // ── Política de Atendimento — VÍNCULO no retorno (docs/politica-atendimento.md §7) ──
    // VÍNCULO (carteira|pool) e "IA atende o retorno" são ORTOGONAIS. Default
    // (carteira + IA off) → `policy` vazio → update IDÊNTICO ao de hoje (sticky).
    const { data: cfg } = await supabaseAdmin
      .from("tenant_config")
      .select("handoff_binding, reopen_to_ai, reopen_flow_id")
      .eq("tenant_id", tenantId)
      .maybeSingle()
    const rawBinding = (cfg?.handoff_binding as string | undefined) ?? "carteira"
    const legacyAi = rawBinding === "ai"                   // 3-way antigo = ownerless + IA-on
    const binding = legacyAi ? "pool" : rawBinding         // carteira | pool
    const reopenFlowId = (cfg?.reopen_flow_id as string | undefined) ?? null
    const prevOwner = ((resolved as { assigned_to?: string | null }).assigned_to) ?? null
    // Unificação carteira↔owner_id: o retorno da carteira roteia pro DONO (owner_id
    // denormalizado na conversa), não pro último handler — que pode ter sido um
    // pit-stop (Ana do Financeiro). Fallback = último assigned_to (retrocompat: quando
    // não há owner_id, ou owner_id == assigned_to, o comportamento é idêntico ao de hoje).
    const ownerId = ((resolved as { owner_id?: string | null }).owner_id) ?? null
    const carteiraTarget = ownerId ?? prevOwner
    const meta = ((resolved as { metadata?: Record<string, unknown> | null }).metadata) ?? {}
    // Flag do decouple (por-tenant): no modo desacoplado o dono da carteira FICA
    // (a IA tria por cima via ai_handling), em vez de ser zerado e restaurado no fim.
    const { data: sc } = await supabaseAdmin
      .from("studio_config").select("ai_control_decoupled").eq("tenant_id", tenantId).maybeSingle()
    const decoupled = !!sc?.ai_control_decoupled

    // "IA atende o retorno?" —
    //  DESACOPLADO: DERIVADO (sem toggle): canal despacha IA + IA ativa. O Studio
    //  decide O QUÊ roda (gatilho Retornou/catch-all/agente, escopado por canal);
    //  se nada casar, o hand-back devolve pro humano. Sem pin (morre o bypass
    //  cross-canal do reopen_flow_id).
    //  LEGADO (flag off): comportamento antigo intacto (reopen_to_ai + pin).
    const convChannel = ((resolved as { channel?: string | null }).channel) ?? "whatsapp"
    const aiFirst = decoupled
      ? (channelDispatchesAI(convChannel) && (await tenantAiActive(tenantId)))
      : ((cfg?.reopen_to_ai || legacyAi) ? await tenantAiActive(tenantId) : false)

    const policy: Record<string, unknown> = {}
    if (aiFirst) {
      // IA tria o retorno. Carteira: LEMBRA o dono (backup — se a IA TRANSFERIR,
      // que zera assigned_to, o restore devolve). DESACOPLADO + carteira: o dono
      // FICA no assigned_to (a IA tria por cima via ai_handling). LEGADO (ou pool):
      // zera pra a IA rodar (gate antigo lê assigned_to) + fixa o fluxo (pin).
      policy.ai_handling = true
      const m: Record<string, unknown> = { ...meta }
      delete m.ai_routed
      if (reopenFlowId && !decoupled) m.ai_pinned_flow = reopenFlowId
      // Backup do dono pro restore pós-IA = o DONO DA CARTEIRA (owner_id), não o último handler.
      if (binding === "carteira" && carteiraTarget) m.reopen_owner = carteiraTarget
      else delete m.reopen_owner
      if (decoupled && binding === "carteira" && carteiraTarget) {
        // Desacoplado + carteira: o DONO fica no assigned_to (a IA tria por cima via
        // ai_handling). Roteia pro dono da CARTEIRA — não pro último que atendeu.
        policy.assigned_to = carteiraTarget
      } else {
        policy.assigned_to = null
      }
      policy.metadata = m
    } else if (binding === "pool") {
      // Pool sem IA: cai na FILA do setor (humano). Solta o dono + bloqueia a IA.
      policy.assigned_to = null
      policy.ai_handling = false
      if (!meta.ai_routed) policy.metadata = { ...meta, ai_routed: { at: now, via: "pool_reopen" } }
    } else if (binding === "carteira" && carteiraTarget) {
      // Carteira sem IA: o retorno vai pro DONO (owner_id), não pro último que atendeu.
      // Quando owner_id == assigned_to atual (caso comum, auto-dono), é no-op = sticky clássico.
      policy.assigned_to = carteiraTarget
    }
    // carteira sem dono resolvível: nada — mantém o que estava (comportamento clássico).

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
    if (reopened) {
      // Evento do ciclo (relatórios): cliente voltou. Guarda quem ficou dono
      // (carteira preservada = to_agent; pool = null) e se a IA tria o retorno.
      await logConversationEvent({
        tenantId, conversationId: resolved.id, type: "reopened",
        actorKind: "contact",
        toAgentId: (reopened as { assigned_to?: string | null }).assigned_to ?? null,
        meta:      { ai_first: aiFirst, binding },
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
