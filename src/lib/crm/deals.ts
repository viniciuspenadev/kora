import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

// ═══════════════════════════════════════════════════════════════
// CRM Negócios — Fase 0 (fundação "shadow")
// ═══════════════════════════════════════════════════════════════
//
// O Negócio é um ESPELHO (shadow) do estado de pipeline da conversa. Os consumidores
// (kanban/reports/sidebar) NÃO leem o negócio ainda — seguem na conversa (Fase 1).
//
// ⚠️ REGRA (owner): Negócio NASCE **só por ação explícita** (`createDeal`). Mover card
//    NÃO cria — `syncActiveDeal` só sincroniza o ativo se existir; senão NO-OP. Sem backfill.
//
// 🔒 VISIBILIDADE (pendência travada p/ Fase 1): quando `createDeal` virar SERVER ACTION
//    e os consumidores LEREM o negócio, a visibilidade por-atendente precisa HERDAR a da
//    conversa/contato (getViewerScope + canViewConversation, igual mensagens/mídia em
//    @/lib/visibility). Isolamento de tenant aqui é garantido por: RLS (USING+WITH CHECK)
//    + validação de ownership abaixo + trigger de tenant-match no active_deal_id.

type DealStatus = "open" | "won" | "lost"
function dealStatus(isWon?: boolean, isLost?: boolean): DealStatus {
  return isWon ? "won" : isLost ? "lost" : "open"
}

async function logEvent(
  tenantId: string, dealId: string, type: string,
  fromStage: string | null, toStage: string | null, by: string | null,
) {
  await supabaseAdmin.from("tenant_deal_events").insert({
    tenant_id: tenantId, deal_id: dealId, type, from_stage: fromStage, to_stage: toStage, by,
  })
}

/**
 * Promove o lifecycle do CONTATO conforme o estado do negócio — NUNCA rebaixa (doc §5).
 *  • ganho   → customer (topo).
 *  • aberto/trabalho → lead, mas SÓ promovendo de 'contact' (não mexe em lead/customer/unfit).
 *  • perdido → não mexe (o desfecho é do negócio, não da pessoa).
 * Best-effort: nunca lança. Fonte única usada por createDeal + moveDeal(ById).
 */
export async function syncContactLifecycleFromDeal(
  tenantId: string, contactId: string, stage: { is_won?: boolean | null; is_lost?: boolean | null },
): Promise<void> {
  try {
    const now = new Date().toISOString()
    if (stage.is_won) {
      await supabaseAdmin.from("chat_contacts")
        .update({ lifecycle_stage: "customer", lifecycle_changed_at: now, updated_at: now })
        .eq("id", contactId).eq("tenant_id", tenantId).neq("lifecycle_stage", "customer")
    } else if (!stage.is_lost) {
      await supabaseAdmin.from("chat_contacts")
        .update({ lifecycle_stage: "lead", lifecycle_changed_at: now, updated_at: now })
        .eq("id", contactId).eq("tenant_id", tenantId).eq("lifecycle_stage", "contact")
    }
  } catch (e) {
    console.error("[crm.syncContactLifecycleFromDeal]", (e as Error).message)
  }
}

interface CreateDealArgs {
  tenantId:        string
  contactId:       string
  pipelineId:      string
  stageId:         string
  conversationId?: string | null   // se vier, este negócio vira o ATIVO da conversa
  name?:           string | null
  estimatedValue?: number | null
  expectedClose?:  string | null
  isWon?:          boolean
  isLost?:         boolean
  by:              string | null
}

/**
 * Cria um Negócio **explicitamente** — o ÚNICO caminho de nascimento de um negócio.
 * Anti-IDOR (defense-in-depth): valida que o contato é DO tenant e, se vier conversa,
 * que ela é do tenant E aponta pro mesmo contato — antes de qualquer escrita.
 */
export async function createDeal(args: CreateDealArgs): Promise<{ id: string } | { error: string }> {
  // 1. Ownership: contato pertence ao tenant?
  const { data: contact } = await supabaseAdmin
    .from("chat_contacts").select("id")
    .eq("id", args.contactId).eq("tenant_id", args.tenantId)
    .maybeSingle()
  if (!contact) return { error: "Contato inválido para este tenant" }

  // 2. Se a conversa veio, ela é do tenant E é deste contato?
  if (args.conversationId) {
    const { data: conv } = await supabaseAdmin
      .from("chat_conversations").select("contact_id")
      .eq("id", args.conversationId).eq("tenant_id", args.tenantId)
      .maybeSingle()
    if (!conv || (conv as { contact_id: string | null }).contact_id !== args.contactId) {
      return { error: "Conversa inválida para este contato" }
    }
  }

  const now    = new Date().toISOString()
  const status = dealStatus(args.isWon, args.isLost)

  const { data, error } = await supabaseAdmin
    .from("tenant_deals")
    .insert({
      tenant_id:           args.tenantId,
      contact_id:          args.contactId,
      name:                args.name ?? null,
      pipeline_id:         args.pipelineId,
      stage_id:            args.stageId,
      status,
      estimated_value:     args.estimatedValue ?? null,
      expected_close_date: args.expectedClose ?? null,
      won_at:              args.isWon  ? now : null,
      lost_at:             args.isLost ? now : null,
      stage_entered_at:    now,
      created_by:          args.by,
    })
    .select("id")
    .single()
  if (error || !data) return { error: error?.message ?? "Falha ao criar negócio" }
  const dealId = (data as { id: string }).id

  if (args.conversationId) {
    // Espelha a etapa inicial do negócio na conversa (mesmo motivo do moveDeal): o board
    // posiciona o card pela etapa da conversa e os relatórios leem as colunas dela.
    await supabaseAdmin.from("chat_conversations")
      .update({
        active_deal_id: dealId,
        pipeline_id: args.pipelineId, stage_id: args.stageId,
        won_at: args.isWon ? now : null, lost_at: args.isLost ? now : null,
        stage_entered_at: now, updated_at: now,
      })
      .eq("id", args.conversationId).eq("tenant_id", args.tenantId)
  }
  await logEvent(args.tenantId, dealId, "created", null, args.stageId, args.by)
  // Abrir negócio → contato vira Lead (ganho → Cliente). Nunca rebaixa. Doc §5.
  await syncContactLifecycleFromDeal(args.tenantId, args.contactId, { is_won: args.isWon, is_lost: args.isLost })
  return { id: dealId }
}

interface SyncArgs {
  tenantId:       string
  conversationId: string
  stage:          { id: string; pipeline_id: string; is_won: boolean; is_lost: boolean }
  movedStage:     boolean        // a etapa mudou de fato? (vs reordenar na mesma coluna)
  by:             string | null
}

/**
 * Sincroniza o Negócio ATIVO da conversa com o estado de pipeline (chamado no move).
 * **NÃO cria negócio** — se a conversa não tem negócio ativo, é NO-OP. Idempotente.
 * Best-effort (nunca lança — shadow não pode derrubar o move).
 */
export async function syncActiveDeal(args: SyncArgs): Promise<void> {
  try {
    const { tenantId, conversationId, stage, movedStage, by } = args

    const { data: conv } = await supabaseAdmin
      .from("chat_conversations").select("active_deal_id")
      .eq("id", conversationId).eq("tenant_id", tenantId)
      .maybeSingle()
    const dealId = (conv as { active_deal_id: string | null } | null)?.active_deal_id
    if (!dealId) return     // sem negócio ativo → NÃO cria. Nasce só se aberto.

    // Estágio anterior do negócio (pra audit from_stage). Escopo por tenant.
    const { data: prev } = await supabaseAdmin
      .from("tenant_deals").select("stage_id")
      .eq("id", dealId).eq("tenant_id", tenantId)
      .maybeSingle()
    const fromStage = (prev as { stage_id: string | null } | null)?.stage_id ?? null

    const now    = new Date().toISOString()
    const status = dealStatus(stage.is_won, stage.is_lost)
    await supabaseAdmin.from("tenant_deals")
      .update({
        pipeline_id: stage.pipeline_id,
        stage_id:    stage.id,
        status,
        won_at:      stage.is_won  ? now : null,
        lost_at:     stage.is_lost ? now : null,
        ...(movedStage ? { stage_entered_at: now } : {}),
        updated_at:  now,
      })
      .eq("id", dealId).eq("tenant_id", tenantId)

    if (movedStage) {
      const type = status === "open" ? "stage_changed" : status   // "won" | "lost" | "stage_changed"
      await logEvent(tenantId, dealId, type, fromStage, stage.id, by)
    }
  } catch (e) {
    console.error("[crm.syncActiveDeal]", (e as Error).message)   // shadow: nunca derruba o move
  }
}
