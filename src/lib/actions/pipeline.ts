"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope } from "@/lib/visibility"
import { resolveLifecycle } from "@/lib/lifecycle-stage"
import { syncActiveDeal } from "@/lib/crm/deals"
import { getBlueprint } from "@/lib/templates/funnels"
import { revalidatePath } from "next/cache"

// Select dos cards do kanban (espelha o da página). Inclui department_id pro
// agrupamento da visão de gestão.
const KANBAN_CARD_SELECT = `
  id, status, priority, subject, channel,
  last_message_at, last_message_preview, last_message_dir, unread_count,
  pipeline_id, stage_id, card_position, department_id, stage_entered_at,
  estimated_value, expected_close_date, lost_reason, won_at, lost_at,
  assigned_to, instance_id, active_deal_id,
  chat_contacts ( id, push_name, custom_name, phone_number, profile_pic_url, source, lifecycle_stage ),
  profiles ( full_name, email ),
  whatsapp_instances!instance_id ( provider, display_name ),
  deal:tenant_deals!active_deal_id ( id, name, status, stage_id, pipeline_id, estimated_value, stage_entered_at, won_at, lost_at )
`

/**
 * Panorama de GESTÃO (read-only): TODAS as conversas ativas do tenant, pra
 * agrupar por atendente/departamento no kanban. Manager-only (owner/admin/
 * view_all) — gestor vê tudo, então não precisa filtro de visibilidade. Capado
 * pra não estourar em tenant grande. Não-gestor recebe [] (fail-closed).
 */
export async function getManagementCards(): Promise<unknown[]> {
  const scope = await getViewerScope()
  if (!scope.isAdmin && !scope.viewAll) return []   // só alto escalão

  const { data, error } = await supabaseAdmin
    .from("chat_conversations")
    .select(KANBAN_CARD_SELECT)
    .eq("tenant_id", scope.tenantId)
    .in("status", ["open", "pending", "snoozed"])
    .is("archived_at", null)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(500)

  if (error) throw new Error(`getManagementCards: ${error.message}`)
  return data ?? []
}

async function requireSession() {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  return session
}

async function requireAdmin() {
  const session = await requireSession()
  if (!["owner", "admin"].includes(session.user.role)) throw new Error("Sem permissão")
  return session
}

// ── Aparência do kanban (preferência do tenant) ─────────────────
export async function setKanbanTintedColumns(value: boolean): Promise<{ error?: string }> {
  const session = await requireAdmin()
  const { error } = await supabaseAdmin
    .from("tenant_config")
    .update({ kanban_tinted_columns: !!value })
    .eq("tenant_id", session.user.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/kanban")
  revalidatePath("/kanban/configuracao")
  return {}
}

// ═══════════════════════════════════════════════════════════════
// Bootstrap — cria pipeline padrão caso tenant ainda não tenha
// ═══════════════════════════════════════════════════════════════

const DEFAULT_PIPELINE_TEMPLATE = {
  name:        "Funil padrão",
  description: null as string | null,
  color:       "#3B82F6",
  stages: [
    { name: "Triagem",     color: "#94A3B8", is_triage: true,  probability_pct: 0   },
    { name: "Lead",        color: "#3B82F6",                   probability_pct: 20  },
    { name: "Qualificado", color: "#8B5CF6",                   probability_pct: 40  },
    { name: "Proposta",    color: "#F59E0B",                   probability_pct: 70  },
    { name: "Ganho",       color: "#10B981", is_won:  true,    probability_pct: 100 },
    { name: "Perdido",     color: "#EF4444", is_lost: true,    probability_pct: 0   },
  ],
}

export async function ensurePipelineBootstrap(tenantId: string, createdBy?: string) {
  const { count } = await supabaseAdmin
    .from("pipelines")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)

  if ((count ?? 0) > 0) return

  const { data: pipeline, error: pErr } = await supabaseAdmin
    .from("pipelines")
    .insert({
      tenant_id:   tenantId,
      name:        DEFAULT_PIPELINE_TEMPLATE.name,
      description: DEFAULT_PIPELINE_TEMPLATE.description,
      color:       DEFAULT_PIPELINE_TEMPLATE.color,
      is_default:  true,
      position:    0,
      active:      true,
      created_by:  createdBy ?? null,
    })
    .select("id")
    .single()

  if (pErr || !pipeline) throw new Error(pErr?.message ?? "Erro criando pipeline padrão")

  const stages = DEFAULT_PIPELINE_TEMPLATE.stages.map((s, i) => {
    const isTriage = "is_triage" in s ? s.is_triage : false
    return {
      pipeline_id:     pipeline.id,
      tenant_id:       tenantId,
      name:            s.name,
      color:           s.color,
      position:        isTriage ? -1 : i,
      probability_pct: s.probability_pct,
      is_won:          ("is_won"    in s && s.is_won)    ? true : false,
      is_lost:         ("is_lost"   in s && s.is_lost)   ? true : false,
      is_triage:       isTriage ? true : false,
      show_in_kanban:  !isTriage,  // Triagem oculta por padrão; tenant pode reverter
    }
  })

  await supabaseAdmin.from("pipeline_stages").insert(stages)

  await supabaseAdmin
    .from("tenant_config")
    .upsert({ tenant_id: tenantId, default_pipeline_id: pipeline.id }, { onConflict: "tenant_id" })
}

// ═══════════════════════════════════════════════════════════════
// CRUD Pipelines (funis)
// ═══════════════════════════════════════════════════════════════

export async function createPipeline(name: string, description?: string, color?: string) {
  const session = await requireAdmin()

  const { data: last } = await supabaseAdmin
    .from("pipelines")
    .select("position")
    .eq("tenant_id", session.user.tenantId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data, error } = await supabaseAdmin
    .from("pipelines")
    .insert({
      tenant_id:   session.user.tenantId,
      name:        name.trim(),
      description: description?.trim() || null,
      color:       color || "#3B82F6",
      position:    (last?.position ?? -1) + 1,
      created_by:  session.user.id,
    })
    .select("id")
    .single()

  if (error || !data) throw new Error(error?.message ?? "Erro ao criar")
  revalidatePath("/kanban")
  revalidatePath("/kanban/configuracao")
  return { id: data.id }
}

/**
 * Aplica um MODELO da biblioteca: cria o(s) funil(is) + etapas a partir do registry
 * (`src/lib/templates/funnels.ts`). Modelo simples cria 1 funil; kit cria N de uma vez.
 * blueprintId é validado server-side contra o catálogo. Retorna os ids criados.
 */
export async function applyFunnelTemplate(blueprintId: string): Promise<{ ids: string[] }> {
  const session = await requireAdmin()
  const t = session.user.tenantId
  const bp = getBlueprint(blueprintId)
  if (!bp) throw new Error("Modelo inválido")

  const { data: last } = await supabaseAdmin
    .from("pipelines").select("position").eq("tenant_id", t).order("position", { ascending: false }).limit(1).maybeSingle()
  let pos = (last?.position ?? -1) + 1
  const ids: string[] = []

  for (const f of bp.funnels) {
    const { data: pipe, error } = await supabaseAdmin.from("pipelines").insert({
      tenant_id: t, name: f.name, color: f.color, position: pos++, created_by: session.user.id,
    }).select("id").single()
    if (error || !pipe) throw new Error(error?.message ?? "Erro ao criar funil")
    const pid = (pipe as { id: string }).id
    ids.push(pid)

    const rows = f.stages.map((st, i) => ({
      pipeline_id: pid, tenant_id: t, name: st.name, color: st.color, position: i,
      probability_pct: st.probability_pct, is_won: st.is_won ?? false, is_lost: st.is_lost ?? false,
      is_triage: st.is_triage ?? false, show_in_kanban: st.show_in_kanban ?? true,
    }))
    if (rows.length) { const { error: se } = await supabaseAdmin.from("pipeline_stages").insert(rows); if (se) throw new Error(se.message) }
  }

  revalidatePath("/kanban")
  revalidatePath("/kanban/configuracao")
  return { ids }
}

export async function updatePipeline(id: string, data: Partial<{ name: string; description: string | null; color: string }>) {
  const session = await requireAdmin()

  const { error } = await supabaseAdmin
    .from("pipelines")
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)

  if (error) throw new Error(error.message)
  revalidatePath("/kanban")
  revalidatePath("/kanban/configuracao")
}

export async function deletePipeline(id: string) {
  const session = await requireAdmin()

  const { data: p } = await supabaseAdmin
    .from("pipelines")
    .select("is_default")
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)
    .single()

  if (p?.is_default) throw new Error("Não é possível excluir o funil padrão. Defina outro como padrão antes.")

  const { count } = await supabaseAdmin
    .from("chat_conversations")
    .select("id", { count: "exact", head: true })
    .eq("pipeline_id", id)

  if ((count ?? 0) > 0) {
    throw new Error(`Funil tem ${count} conversa(s) vinculada(s). Mova-as para outro funil antes.`)
  }

  await supabaseAdmin.from("pipelines").delete().eq("id", id).eq("tenant_id", session.user.tenantId)

  revalidatePath("/kanban")
  revalidatePath("/kanban/configuracao")
}

/**
 * Arquiva um funil (some do board e da gestão; histórico intacto) — NÃO exclui de verdade.
 * Usa `pipelines.active` (já existe no schema). Padrão não pode ser arquivado.
 */
export async function archivePipeline(id: string) {
  const session = await requireAdmin()

  const { data: p } = await supabaseAdmin
    .from("pipelines").select("is_default").eq("id", id).eq("tenant_id", session.user.tenantId).single()
  if (p?.is_default) throw new Error("Não é possível arquivar o funil padrão. Defina outro como padrão antes.")

  await supabaseAdmin
    .from("pipelines").update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", id).eq("tenant_id", session.user.tenantId)

  revalidatePath("/kanban")
  revalidatePath("/kanban/configuracao")
}

export async function setDefaultPipeline(id: string) {
  const session = await requireAdmin()

  await supabaseAdmin
    .from("pipelines")
    .update({ is_default: false })
    .eq("tenant_id", session.user.tenantId)

  await supabaseAdmin
    .from("pipelines")
    .update({ is_default: true })
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)

  await supabaseAdmin
    .from("tenant_config")
    .upsert({ tenant_id: session.user.tenantId, default_pipeline_id: id }, { onConflict: "tenant_id" })

  revalidatePath("/kanban")
  revalidatePath("/kanban/configuracao")
}

// ═══════════════════════════════════════════════════════════════
// CRUD Stages
// ═══════════════════════════════════════════════════════════════

export async function createStage(
  pipelineId: string,
  data: { name: string; color?: string; probability_pct?: number; is_won?: boolean; is_lost?: boolean; show_in_kanban?: boolean },
) {
  const session = await requireAdmin()

  const { data: last } = await supabaseAdmin
    .from("pipeline_stages")
    .select("position")
    .eq("pipeline_id", pipelineId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await supabaseAdmin.from("pipeline_stages").insert({
    pipeline_id:     pipelineId,
    tenant_id:       session.user.tenantId,
    name:            data.name.trim(),
    color:           data.color ?? "#94A3B8",
    position:        (last?.position ?? -1) + 1,
    probability_pct: data.probability_pct ?? 50,
    is_won:          data.is_won  ?? false,
    is_lost:         data.is_lost ?? false,
    show_in_kanban:  data.show_in_kanban ?? true,
  })

  if (error) throw new Error(error.message)
  revalidatePath("/kanban")
  revalidatePath("/kanban/configuracao")
}

export async function updateStage(
  id: string,
  data: Partial<{ name: string; color: string; probability_pct: number; position: number; is_won: boolean; is_lost: boolean; show_in_kanban: boolean }>,
) {
  const session = await requireAdmin()

  const { error } = await supabaseAdmin
    .from("pipeline_stages")
    .update(data)
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)

  if (error) throw new Error(error.message)
  revalidatePath("/kanban")
  revalidatePath("/kanban/configuracao")
}

export async function deleteStage(id: string) {
  const session = await requireAdmin()
  const t = session.user.tenantId

  const { data: stage } = await supabaseAdmin
    .from("pipeline_stages").select("pipeline_id, is_won, is_lost, is_triage")
    .eq("id", id).eq("tenant_id", t).maybeSingle()
  if (!stage) throw new Error("Etapa não encontrada")
  const s = stage as { pipeline_id: string; is_won: boolean; is_lost: boolean; is_triage: boolean }

  // Itens vivos: conversas E negócios. A FK é ON DELETE SET NULL — sem este guard, excluir
  // uma etapa com negócios zeraria o stage_id deles silenciosamente (órfãos, somem do board).
  const [{ count: convCount }, { count: dealCount }] = await Promise.all([
    supabaseAdmin.from("chat_conversations").select("id", { count: "exact", head: true }).eq("stage_id", id).eq("tenant_id", t),
    supabaseAdmin.from("tenant_deals").select("id", { count: "exact", head: true }).eq("stage_id", id).eq("tenant_id", t),
  ])
  if ((convCount ?? 0) > 0 || (dealCount ?? 0) > 0) {
    const parts: string[] = []
    if (convCount) parts.push(`${convCount} conversa(s)`)
    if (dealCount) parts.push(`${dealCount} negócio(s)`)
    throw new Error(`Esta etapa tem ${parts.join(" e ")}. Mova para outra etapa antes de excluir.`)
  }

  // Proteção estrutural: não excluir a ÚNICA etapa de Ganho/Perda/Triagem do funil
  // (senão "Ganhar"/"Perder"/roteamento de nova conversa ficam sem destino).
  if (s.is_won || s.is_lost || s.is_triage) {
    const flag = s.is_won ? "is_won" : s.is_lost ? "is_lost" : "is_triage"
    const { count: siblings } = await supabaseAdmin
      .from("pipeline_stages").select("id", { count: "exact", head: true })
      .eq("pipeline_id", s.pipeline_id).eq("tenant_id", t).eq(flag, true).neq("id", id)
    if ((siblings ?? 0) === 0) {
      const label = s.is_won ? "Ganho" : s.is_lost ? "Perda" : "Triagem"
      throw new Error(`Esta é a única etapa de ${label} do funil. Marque outra como ${label} antes de excluir.`)
    }
  }

  await supabaseAdmin.from("pipeline_stages").delete().eq("id", id).eq("tenant_id", t)
  revalidatePath("/kanban")
  revalidatePath("/kanban/configuracao")
}

export async function reorderStages(pipelineId: string, orderedIds: string[]) {
  const session = await requireAdmin()

  await Promise.all(
    orderedIds.map((id, position) =>
      supabaseAdmin
        .from("pipeline_stages")
        .update({ position })
        .eq("id", id)
        .eq("tenant_id", session.user.tenantId)
        .eq("pipeline_id", pipelineId)
    )
  )

  revalidatePath("/kanban")
  revalidatePath("/kanban/configuracao")
}

// ═══════════════════════════════════════════════════════════════
// Mover conversa entre estágios (drag-and-drop)
// ═══════════════════════════════════════════════════════════════

export async function moveConversation(
  conversationId: string,
  newStageId:     string,
  newPosition:    number,
) {
  const session = await requireSession()

  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("stage_id, pipeline_id")
    .eq("id", conversationId)
    .eq("tenant_id", session.user.tenantId)
    .single()

  if (!conv) throw new Error("Conversa não encontrada")

  const { data: newStage } = await supabaseAdmin
    .from("pipeline_stages")
    .select("id, pipeline_id, name, is_won, is_lost, is_triage")
    .eq("id", newStageId)
    .eq("tenant_id", session.user.tenantId)
    .maybeSingle()

  if (!newStage) throw new Error("Estágio inválido")

  const updates: Record<string, unknown> = {
    stage_id:      newStageId,
    pipeline_id:   newStage.pipeline_id,
    card_position: newPosition,
    updated_at:    new Date().toISOString(),
  }

  // Aging (Tier 0): marca quando entrou na etapa — só na troca REAL de etapa
  // (reordenar dentro da mesma coluna não reseta o relógio).
  if (conv.stage_id !== newStageId) {
    updates.stage_entered_at = new Date().toISOString()
  }

  if (newStage.is_won) {
    updates.won_at  = new Date().toISOString()
    updates.lost_at = null
  } else if (newStage.is_lost) {
    updates.lost_at = new Date().toISOString()
    updates.won_at  = null
  } else {
    updates.won_at  = null
    updates.lost_at = null
  }

  await supabaseAdmin
    .from("chat_conversations")
    .update(updates)
    .eq("id", conversationId)
    .eq("tenant_id", session.user.tenantId)

  // Acoplamento pipeline → lifecycle do contato (toda etapa, nunca rebaixa).
  const { data: convWithContact } = await supabaseAdmin
    .from("chat_conversations")
    .select("contact_id")
    .eq("id", conversationId)
    .eq("tenant_id", session.user.tenantId)
    .single()

  if (convWithContact?.contact_id) {
    const { data: ct } = await supabaseAdmin
      .from("chat_contacts")
      .select("lifecycle_stage")
      .eq("id", convWithContact.contact_id)
      .eq("tenant_id", session.user.tenantId)
      .maybeSingle()
    const next = resolveLifecycle(ct?.lifecycle_stage, newStage)
    if (next) {
      await supabaseAdmin
        .from("chat_contacts")
        .update({
          lifecycle_stage:      next,
          lifecycle_changed_at: new Date().toISOString(),
          updated_at:           new Date().toISOString(),
        })
        .eq("id", convWithContact.contact_id)
        .eq("tenant_id", session.user.tenantId)
    }

  }

  // CRM Negócios — Fase 0 (shadow): se a conversa TEM negócio ativo, sincroniza com a
  // nova etapa. NÃO cria negócio (nasce só por "abrir negócio"). Best-effort.
  await syncActiveDeal({
    tenantId:       session.user.tenantId,
    conversationId,
    stage:          { id: newStage.id, pipeline_id: newStage.pipeline_id, is_won: newStage.is_won, is_lost: newStage.is_lost },
    movedStage:     conv.stage_id !== newStageId,
    by:             session.user.id,
  })

  if (conv.stage_id !== newStageId) {
    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: conversationId,
      tenant_id:       session.user.tenantId,
      sender_type:     "system",
      content_type:    "text",
      content:         newStage.is_won
        ? `🏆 Negócio ganho! Conversa movida para "${newStage.name}"`
        : newStage.is_lost
        ? `❌ Negócio perdido. Conversa movida para "${newStage.name}"`
        : `Conversa movida para "${newStage.name}"`,
      status:          "delivered",
      is_private_note: false,
    })
  }

  revalidatePath("/kanban")
  revalidatePath("/inbox")
}

// ═══════════════════════════════════════════════════════════════
// Atualizar dados de "negócio" da conversa
// ═══════════════════════════════════════════════════════════════

export async function updateConversationDealInfo(
  conversationId: string,
  data: {
    pipeline_id?:         string | null
    estimated_value?:     number | null
    expected_close_date?: string | null
    lost_reason?:         string | null
  },
) {
  const session = await requireSession()

  // Whitelist de campos (impede mass assignment se o schema crescer)
  const allowed: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (data.pipeline_id !== undefined)         allowed.pipeline_id         = data.pipeline_id
  if (data.estimated_value !== undefined)     allowed.estimated_value     = data.estimated_value
  if (data.expected_close_date !== undefined) allowed.expected_close_date = data.expected_close_date
  if (data.lost_reason !== undefined)         allowed.lost_reason         = data.lost_reason

  // Valida pipeline_id pertence ao tenant (quando setado)
  if (data.pipeline_id) {
    const { data: pl } = await supabaseAdmin
      .from("pipelines")
      .select("id")
      .eq("id", data.pipeline_id)
      .eq("tenant_id", session.user.tenantId)
      .maybeSingle()
    if (!pl) throw new Error("Pipeline inválido")
  }

  await supabaseAdmin
    .from("chat_conversations")
    .update(allowed)
    .eq("id", conversationId)
    .eq("tenant_id", session.user.tenantId)

  revalidatePath("/kanban")
  revalidatePath("/inbox")
}

// ═══════════════════════════════════════════════════════════════
// Marcar conversa como Ganha/Perdida — move pro stage correspondente
// ═══════════════════════════════════════════════════════════════

export async function markConversationWonLost(
  conversationId: string,
  kind:           "won" | "lost",
  reason?:        string,
) {
  const session = await requireSession()

  const { data: conv } = await supabaseAdmin
    .from("chat_conversations")
    .select("pipeline_id")
    .eq("id", conversationId)
    .eq("tenant_id", session.user.tenantId)
    .single()

  if (!conv?.pipeline_id) throw new Error("Conversa sem funil. Atribua a um funil primeiro.")

  const { data: target } = await supabaseAdmin
    .from("pipeline_stages")
    .select("id")
    .eq("tenant_id", session.user.tenantId)
    .eq("pipeline_id", conv.pipeline_id)
    .eq(kind === "won" ? "is_won" : "is_lost", true)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!target) throw new Error(`Funil sem estágio marcado como ${kind === "won" ? "Ganho" : "Perdido"}.`)

  await moveConversation(conversationId, target.id, 0)

  if (kind === "lost" && reason) {
    await supabaseAdmin
      .from("chat_conversations")
      .update({ lost_reason: reason })
      .eq("id", conversationId)
      .eq("tenant_id", session.user.tenantId)
  }

  revalidatePath("/kanban")
  revalidatePath("/inbox")
}

// ═══════════════════════════════════════════════════════════════
// Atribuir conversa a um pipeline (se ainda não tem)
// ═══════════════════════════════════════════════════════════════

export async function assignConversationToPipeline(
  conversationId: string,
  pipelineId:     string,
) {
  const session = await requireSession()

  const { data: firstStage } = await supabaseAdmin
    .from("pipeline_stages")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .eq("tenant_id", session.user.tenantId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!firstStage) throw new Error("Funil sem estágios")

  await supabaseAdmin
    .from("chat_conversations")
    .update({
      pipeline_id:   pipelineId,
      stage_id:      firstStage.id,
      card_position: 0,
      updated_at:    new Date().toISOString(),
    })
    .eq("id", conversationId)
    .eq("tenant_id", session.user.tenantId)

  revalidatePath("/kanban")
  revalidatePath("/inbox")
}
