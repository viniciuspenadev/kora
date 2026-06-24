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

// ── Linha do Tempo do Negócio (docs/crm-deal-timeline-design.md) ─────────────
export type DealEventType = "created" | "stage_changed" | "won" | "lost" | "canceled" | "reopened" | "note" | "field_changed" | "task_created" | "task_done"
export interface DealEventActor { kind: "human" | "ia" | "automation"; userId?: string | null; label?: string | null }
export interface DealFieldChange { label: string; from: string | null; to: string | null }
export interface DealEventExtras { valueChange?: { from: string; to: string } | null; followUp?: { title: string; due: string | null } | null }
interface RecordDealEventOpts {
  tenantId:        string
  dealId:          string
  type:            DealEventType
  conversationId?: string | null
  fromStageId?:    string | null
  toStageId?:      string | null
  by?:             string | null            // user humano que disparou (quando houver)
  actor?:          DealEventActor            // default = humano (by); IA/automação passam label
  note?:           string | null            // observação do atendente
  reason?:         string | null            // motivo estruturado (perdido/cancelado)
  change?:         DealFieldChange           // field_changed: rótulo + antes→depois (auditoria)
  postCard?:       boolean                   // false = só auditoria (não posta cartão no chat)
  extras?:         DealEventExtras           // cartão CONSOLIDADO: valor + follow-up na mesma movimentação
}

const DEAL_EVENT_ICON: Record<DealEventType, string> = {
  created: "💼", stage_changed: "💼", won: "🏆", lost: "💔", canceled: "🚫", reopened: "↩️", note: "📝", field_changed: "✏️", task_created: "📌", task_done: "✅",
}

async function resolveStageNames(tenantId: string, ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const want = [...new Set(ids.filter(Boolean) as string[])]
  if (want.length === 0) return {}
  const { data } = await supabaseAdmin.from("pipeline_stages").select("id, name").eq("tenant_id", tenantId).in("id", want)
  const map: Record<string, string> = {}
  for (const s of (data ?? []) as { id: string; name: string }[]) map[s.id] = s.name
  return map
}

/**
 * Fonte ÚNICA da narrativa do Negócio: grava o evento (audit em `tenant_deal_events`,
 * com nomes de etapa + ator + observação em `meta`) E posta um cartão INTERNO no chat
 * (`is_private_note` → o cliente NUNCA vê), com de→para, autor e observação. Render
 * especial do cartão lê `metadata.deal_event`. Best-effort no cartão (nunca derruba a ação).
 */
export async function recordDealEvent(opts: RecordDealEventOpts): Promise<void> {
  const { tenantId, dealId, type, conversationId, fromStageId, toStageId, by, note, reason, change, extras } = opts
  const actor: DealEventActor = opts.actor ?? { kind: "human", userId: by ?? null }

  const names    = await resolveStageNames(tenantId, [fromStageId, toStageId])
  const fromName = fromStageId ? names[fromStageId] ?? null : null
  const toName   = toStageId ? names[toStageId] ?? null : null

  // Rótulo do autor: humano → nome no profile; IA/automação → label; fallback genérico.
  let actorLabel = actor.label ?? null
  const humanId  = actor.userId ?? (actor.kind === "human" ? by : null)
  if (!actorLabel && actor.kind === "human" && humanId) {
    const { data: prof } = await supabaseAdmin.from("profiles").select("full_name").eq("id", humanId).maybeSingle()
    actorLabel = (prof as { full_name: string | null } | null)?.full_name ?? null
  }
  if (!actorLabel) actorLabel = actor.kind === "ia" ? "IA" : actor.kind === "automation" ? "Automação" : "Sistema"

  const actorMeta = { kind: actor.kind, label: actorLabel }

  // 1. Audit (sempre).
  await supabaseAdmin.from("tenant_deal_events").insert({
    tenant_id: tenantId, deal_id: dealId, type,
    from_stage: fromStageId ?? null, to_stage: toStageId ?? null, by: by ?? null,
    meta: { note: note ?? null, reason: reason ?? null, from_name: fromName, to_name: toName, actor: actorMeta, change: change ?? null, extras: extras ?? null },
  })

  // 2. Cartão interno no chat. Pulado quando: sem conversa, OU postCard=false (alteração
  //    de campo é só AUDITORIA no dossiê do negócio — não polui a conversa do cliente).
  if (!conversationId || opts.postCard === false) return
  try {
    const headline =
        type === "created"       ? `Negócio aberto${toName ? ` em ${toName}` : ""}`
      : type === "stage_changed" ? `${fromName ?? "—"} → ${toName ?? "—"}`
      : type === "won"           ? "Negócio ganho"
      : type === "lost"          ? `Negócio perdido${reason ? ` · ${reason}` : ""}`
      : type === "canceled"      ? `Negócio cancelado${reason ? ` · ${reason}` : ""}`
      : type === "reopened"      ? `Negócio reaberto${toName ? ` em ${toName}` : ""}`
      : type === "field_changed" ? `${change?.label ?? "Campo"} atualizado`
      : type === "task_created"  ? `Próxima ação: ${note ?? "tarefa"}`
      : type === "task_done"     ? `Tarefa concluída: ${note ?? ""}`
      :                            (note ?? "Observação")
    const lines = [`${DEAL_EVENT_ICON[type]} ${headline} — por ${actorLabel}`]
    if (note && type !== "note") lines.push(note)
    if (extras?.valueChange) lines.push(`Valor: ${extras.valueChange.from} → ${extras.valueChange.to}`)
    if (extras?.followUp)     lines.push(`Follow-up: ${extras.followUp.title}${extras.followUp.due ? ` · ${extras.followUp.due}` : ""}`)
    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: conversationId, tenant_id: tenantId,
      sender_type: "system", content_type: "text", content: lines.join("\n"),
      status: "delivered", is_private_note: true,
      metadata: { deal_event: { type, deal_id: dealId, from_stage: fromStageId ?? null, to_stage: toStageId ?? null, from_name: fromName, to_name: toName, note: note ?? null, reason: reason ?? null, actor: actorMeta, change: change ?? null, extras: extras ?? null } },
    })
  } catch (e) {
    console.error("[crm.recordDealEvent] cartão:", (e as Error).message)
  }
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

/**
 * Negócio ABERTO do contato (no máx. 1, pela trava "um por vez"). `exceptId` ignora um
 * negócio (usado na reabertura). Fonte única da regra — usado por createDeal + reopenDeal(ById).
 */
export async function openDealOf(tenantId: string, contactId: string, exceptId?: string): Promise<{ id: string; name: string | null } | null> {
  let q = supabaseAdmin.from("tenant_deals")
    .select("id, name").eq("tenant_id", tenantId).eq("contact_id", contactId).eq("status", "open")
  if (exceptId) q = q.neq("id", exceptId)
  const { data } = await q.limit(1).maybeSingle()
  return (data as { id: string; name: string | null } | null) ?? null
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
  parentDealId?:   string | null   // handoff: negócio anterior da jornada (carimbo + vínculo)
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

  // 3. Trava "um negócio aberto por vez" — evita o sequestro do active_deal_id em
  //    multi-negócio. Só barra se o NOVO nasce aberto E o contato já tem um aberto.
  const status = dealStatus(args.isWon, args.isLost)
  if (status === "open") {
    const open = await openDealOf(args.tenantId, args.contactId)
    if (open) return { error: `Este contato já tem um negócio aberto${open.name ? ` (“${open.name}”)` : ""}. Finalize, perca ou cancele antes de abrir outro.` }
  }

  const now = new Date().toISOString()

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
  // Handoff: carimbo no histórico ("Originado de…") + vínculo estruturado (best-effort —
  // roda OK mesmo antes da migration parent_deal_id ser aplicada; só não grava a coluna).
  let originNote: string | null = null
  if (args.parentDealId) {
    const { data: parent } = await supabaseAdmin.from("tenant_deals").select("name").eq("id", args.parentDealId).eq("tenant_id", args.tenantId).maybeSingle()
    originNote = `Originado de: ${(parent as { name: string | null } | null)?.name?.trim() || "negócio anterior"}`
    const { error: pErr } = await supabaseAdmin.from("tenant_deals").update({ parent_deal_id: args.parentDealId }).eq("id", dealId).eq("tenant_id", args.tenantId)
    if (pErr) console.error("[crm.createDeal] parent_deal_id (migration pendente?):", pErr.message)
  }
  await recordDealEvent({
    tenantId: args.tenantId, dealId, type: "created",
    conversationId: args.conversationId, toStageId: args.stageId, by: args.by, note: originNote,
  })
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
