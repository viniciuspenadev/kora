import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { findOrReopenConversation } from "@/lib/conversation-dedup"
import { tenantAiActive } from "@/lib/llm/active"
import { channelDispatchesAI } from "@/lib/ai-v2/dispatch"

// ═══════════════════════════════════════════════════════════════
// Fonte ÚNICA de recebimento — nascer/reusar conversa (1:1)
// ═══════════════════════════════════════════════════════════════
// TODOS os canais de entrada (Meta · Baileys · Site · Manual) passam por aqui,
// no lugar das 5 cópias inline que divergiam (umas nasciam na etapa de triagem,
// outras na 1ª por posição). Encapsula: dedup/reopen (findOrReopenConversation)
// + criação com etapa inicial resolvida de forma CONSISTENTE. department_id
// nasce null (= Triagem, estado de entrada). assigned_to = quem criou (manual)
// ou null (inbound → pool/auto-assign fica no canal, por ora).
//
// Grupos NÃO usam este helper — a dedup deles é por group_jid, não por contato.
//
// Passo 2 (futuro): tornar o pipeline/stage OPCIONAL aqui (gated por
// default_pipeline_id) é uma mudança de UM lugar só — este helper.

export interface InboundConversationInput {
  tenantId:   string
  contactId:  string
  /** Instância (número). IG/site-first podem nascer sem número → null (coluna é nullable). */
  instanceId: string | null
  /** Canal da conversa. WhatsApp (Meta/Baileys) omite (default do banco); site passa "site". */
  channel?:   string | null
  /** Dono inicial — criação MANUAL carimba o criador; inbound deixa null (pool). */
  assignTo?:  string | null
}

export interface InboundConversationResult {
  id:           string
  status:       string
  unread_count: number
  isNew:        boolean
  reopened:     boolean
}

/** Etapa inicial: pipeline padrão do tenant (opcional) → etapa de triagem, com
 *  fallback pra 1ª por posição. Unifica os 5 caminhos antigos. Sem pipeline
 *  padrão → null/null (conversa nasce sem funil). */
async function resolveInitialStage(tenantId: string): Promise<{ pipelineId: string | null; stageId: string | null }> {
  const { data: cfg } = await supabaseAdmin
    .from("tenant_config")
    .select("default_pipeline_id")
    .eq("tenant_id", tenantId)
    .maybeSingle()
  const pipelineId = (cfg?.default_pipeline_id as string | null) ?? null
  if (!pipelineId) return { pipelineId: null, stageId: null }

  const { data: stages } = await supabaseAdmin
    .from("pipeline_stages")
    .select("id, is_triage, position")
    .eq("pipeline_id", pipelineId)
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true })
  const list = (stages ?? []) as { id: string; is_triage: boolean | null; position: number }[]
  const initial = list.find((s) => s.is_triage) ?? list[0] ?? null
  return { pipelineId, stageId: initial?.id ?? null }
}

function toResult(c: { id: string; status: string; unread_count?: unknown }, reopened: boolean): InboundConversationResult {
  return { id: c.id, status: c.status, unread_count: (c.unread_count as number) ?? 0, isNew: false, reopened }
}

export async function createInboundConversation(
  input: InboundConversationInput,
): Promise<InboundConversationResult> {
  const { tenantId, contactId, instanceId, channel, assignTo } = input

  // 1. Dedup/reopen — porta única (webhook já validou o contato upstream).
  // Escopo por (instância, canal): 1 fio ativo por número/canal. WhatsApp = default.
  const dedup = await findOrReopenConversation({ tenantId, contactId, instanceId, channel: channel ?? "whatsapp", skipOwnershipCheck: true })
  if (dedup.found !== "none") {
    return toResult(dedup.conversation as unknown as { id: string; status: string; unread_count?: unknown }, dedup.found === "reopened")
  }

  // 2. Etapa inicial consistente.
  const { pipelineId, stageId } = await resolveInitialStage(tenantId)

  // 2b. Seed do controle da IA (decouple) — DERIVADO, sem toggle: inbound SEM dono,
  // num canal que despacha IA (verdade do motor) e tenant com IA ativa → nasce
  // ai_handling=true (a IA é a linha de frente do turno 1; se nada do Studio casar,
  // o hand-back devolve pro humano). Manual (assignTo) / canal sem IA / IA-off → false.
  const aiSeed = !assignTo && channelDispatchesAI(channel) && (await tenantAiActive(tenantId))

  // 3. Cria. department_id null (Triagem); assigned_to = manual ou null.
  const insert: Record<string, unknown> = {
    tenant_id:     tenantId,
    contact_id:    contactId,
    instance_id:   instanceId,
    status:        "open",
    unread_count:  0,
    pipeline_id:   pipelineId,
    stage_id:      stageId,
    assigned_to:   assignTo ?? null,
    ai_handling:   aiSeed,
    card_position: 0,
  }
  if (channel) insert.channel = channel

  const { data: nc, error } = await supabaseAdmin
    .from("chat_conversations")
    .insert(insert)
    .select("id, status, unread_count")
    .single()

  // Race (unique constraint): outra request criou — refaz o dedup.
  if (error?.code === "23505") {
    const retry = await findOrReopenConversation({ tenantId, contactId, instanceId, channel: channel ?? "whatsapp", skipOwnershipCheck: true })
    if (retry.conversation) {
      return toResult(retry.conversation as unknown as { id: string; status: string; unread_count?: unknown }, retry.found === "reopened")
    }
  }
  if (error || !nc) throw new Error(`createInboundConversation: ${error?.message}`)
  return { id: nc.id as string, status: nc.status as string, unread_count: nc.unread_count as number, isNew: true, reopened: false }
}
