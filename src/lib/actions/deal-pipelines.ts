"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { requireModule } from "@/lib/modules"
import { revalidatePath } from "next/cache"

// ═══════════════════════════════════════════════════════════════
// CRUD dos FUNIS DE VENDA (deal_pipelines / deal_pipeline_stages)
// ═══════════════════════════════════════════════════════════════
// Espelha o motor de pipeline.ts, mas no schema PRÓPRIO do CRM. Separado de
// propósito: o funil de venda é independente do pipeline de ATENDIMENTO da
// conversa (docs/crm-separation-design.md). Gated owner/admin + módulo crm +
// RLS tenant_isolation nas duas tabelas.

async function requireCrmAdmin() {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  if (!["owner", "admin"].includes(session.user.role)) throw new Error("Sem permissão")
  await requireModule("crm")
  return session
}

const PATHS = ["/negocios", "/negocios/funis"]
function revalidate() { for (const p of PATHS) revalidatePath(p) }

// ── Tipos (view-models) ─────────────────────────────────────────
export interface DealFunnelSummary {
  id: string; name: string; color: string; is_default: boolean
  stageCount: number; stageColors: string[]; dealCount: number
}
export interface DealEditorPipeline { id: string; name: string; description: string | null; color: string; is_default: boolean }
export interface DealEditorStage {
  id: string; pipeline_id: string; name: string; color: string; position: number
  probability_pct: number; is_won: boolean; is_lost: boolean; is_triage: boolean; show_in_kanban: boolean
  dealCount: number
}

// ── Leitura ─────────────────────────────────────────────────────
export async function getDealFunnels(): Promise<DealFunnelSummary[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  try { await requireModule("crm") } catch { return [] }
  const t = session.user.tenantId

  const [{ data: pipes }, { data: deals }] = await Promise.all([
    supabaseAdmin.from("deal_pipelines")
      .select("id, name, color, is_default, deal_pipeline_stages ( id, color, position )")
      .eq("tenant_id", t).eq("active", true).order("position", { ascending: true }),
    supabaseAdmin.from("tenant_deals").select("pipeline_id").eq("tenant_id", t),
  ])

  const countByPipe = new Map<string, number>()
  for (const d of (deals ?? []) as { pipeline_id: string | null }[])
    if (d.pipeline_id) countByPipe.set(d.pipeline_id, (countByPipe.get(d.pipeline_id) ?? 0) + 1)

  return ((pipes ?? []) as Record<string, unknown>[]).map((p) => {
    const stages = ((p.deal_pipeline_stages as { id: string; color: string | null; position: number }[] | null) ?? [])
      .slice().sort((a, b) => a.position - b.position)
    return {
      id: p.id as string, name: p.name as string, color: (p.color as string | null) ?? "#3B82F6", is_default: !!p.is_default,
      stageCount: stages.length, stageColors: stages.map((s) => s.color ?? "#94A3B8"),
      dealCount: countByPipe.get(p.id as string) ?? 0,
    }
  })
}

export async function getDealFunnel(id: string): Promise<{ pipeline: DealEditorPipeline; stages: DealEditorStage[] } | null> {
  const session = await auth()
  if (!session?.user?.tenantId) return null
  try { await requireModule("crm") } catch { return null }
  const t = session.user.tenantId

  const { data: p } = await supabaseAdmin.from("deal_pipelines")
    .select("id, name, description, color, is_default").eq("id", id).eq("tenant_id", t).maybeSingle()
  if (!p) return null
  const pipe = p as { id: string; name: string; description: string | null; color: string | null; is_default: boolean }

  const [{ data: st }, { data: deals }] = await Promise.all([
    supabaseAdmin.from("deal_pipeline_stages")
      .select("id, pipeline_id, name, color, position, probability_pct, is_won, is_lost, is_triage, show_in_kanban")
      .eq("pipeline_id", id).eq("tenant_id", t).order("position", { ascending: true }),
    supabaseAdmin.from("tenant_deals").select("stage_id").eq("tenant_id", t).eq("pipeline_id", id),
  ])
  const countByStage = new Map<string, number>()
  for (const d of (deals ?? []) as { stage_id: string | null }[])
    if (d.stage_id) countByStage.set(d.stage_id, (countByStage.get(d.stage_id) ?? 0) + 1)

  const stages: DealEditorStage[] = ((st ?? []) as Record<string, unknown>[]).map((s) => ({
    id: s.id as string, pipeline_id: s.pipeline_id as string, name: s.name as string,
    color: (s.color as string | null) ?? "#94A3B8", position: s.position as number,
    probability_pct: (s.probability_pct as number | null) ?? 0,
    is_won: !!s.is_won, is_lost: !!s.is_lost, is_triage: !!s.is_triage, show_in_kanban: s.show_in_kanban !== false,
    dealCount: countByStage.get(s.id as string) ?? 0,
  }))

  return {
    pipeline: { id: pipe.id, name: pipe.name, description: pipe.description, color: pipe.color ?? "#3B82F6", is_default: pipe.is_default },
    stages,
  }
}

// ── Funil ───────────────────────────────────────────────────────
const SEED_STAGES = [
  { name: "Lead",        color: "#3B82F6", probability_pct: 20  },
  { name: "Qualificado", color: "#8B5CF6", probability_pct: 40  },
  { name: "Proposta",    color: "#F59E0B", probability_pct: 70  },
  { name: "Ganho",       color: "#10B981", probability_pct: 100, is_won: true },
  { name: "Perdido",     color: "#EF4444", probability_pct: 0,   is_lost: true },
]

/** Cria um funil de venda com etapas-semente prontas (editável depois). Retorna o id. */
export async function createDealPipeline(name: string, color?: string): Promise<{ id: string }> {
  const session = await requireCrmAdmin()
  const t = session.user.tenantId

  const { data: last } = await supabaseAdmin.from("deal_pipelines")
    .select("position").eq("tenant_id", t).order("position", { ascending: false }).limit(1).maybeSingle()

  const { data: pipe, error } = await supabaseAdmin.from("deal_pipelines").insert({
    tenant_id: t, name: name.trim() || "Novo funil", color: color || "#3B82F6",
    position: ((last?.position as number | undefined) ?? -1) + 1, created_by: session.user.id,
  }).select("id").single()
  if (error || !pipe) throw new Error(error?.message ?? "Erro ao criar funil")
  const pid = (pipe as { id: string }).id

  const rows = SEED_STAGES.map((s, i) => ({
    pipeline_id: pid, tenant_id: t, name: s.name, color: s.color, position: i,
    probability_pct: s.probability_pct, is_won: s.is_won ?? false, is_lost: s.is_lost ?? false, show_in_kanban: true,
  }))
  const { error: se } = await supabaseAdmin.from("deal_pipeline_stages").insert(rows)
  if (se) throw new Error(se.message)

  revalidate()
  return { id: pid }
}

export async function updateDealPipeline(id: string, data: Partial<{ name: string; description: string | null; color: string }>) {
  const session = await requireCrmAdmin()
  const { error } = await supabaseAdmin.from("deal_pipelines")
    .update({ ...data, updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", session.user.tenantId)
  if (error) throw new Error(error.message)
  revalidate()
}

/** Define o funil de venda PADRÃO (pré-selecionado ao abrir negócio). Só um por vez. */
export async function setDefaultDealPipeline(id: string) {
  const session = await requireCrmAdmin()
  const t = session.user.tenantId
  await supabaseAdmin.from("deal_pipelines").update({ is_default: false }).eq("tenant_id", t)
  await supabaseAdmin.from("deal_pipelines").update({ is_default: true }).eq("id", id).eq("tenant_id", t)
  revalidate()
}

export async function archiveDealPipeline(id: string) {
  const session = await requireCrmAdmin()
  const t = session.user.tenantId
  const { data: p } = await supabaseAdmin.from("deal_pipelines").select("is_default").eq("id", id).eq("tenant_id", t).single()
  if (p?.is_default) throw new Error("Não é possível arquivar o funil padrão. Defina outro como padrão antes.")
  await supabaseAdmin.from("deal_pipelines").update({ active: false, updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", t)
  revalidate()
}

// ── Etapas ──────────────────────────────────────────────────────
export async function createDealStage(
  pipelineId: string,
  data: { name: string; color?: string; probability_pct?: number; is_won?: boolean; is_lost?: boolean; show_in_kanban?: boolean },
) {
  const session = await requireCrmAdmin()
  const { data: last } = await supabaseAdmin.from("deal_pipeline_stages")
    .select("position").eq("pipeline_id", pipelineId).order("position", { ascending: false }).limit(1).maybeSingle()
  const { error } = await supabaseAdmin.from("deal_pipeline_stages").insert({
    pipeline_id: pipelineId, tenant_id: session.user.tenantId, name: data.name.trim(),
    color: data.color ?? "#94A3B8", position: ((last?.position as number | undefined) ?? -1) + 1,
    probability_pct: data.probability_pct ?? 50, is_won: data.is_won ?? false, is_lost: data.is_lost ?? false,
    show_in_kanban: data.show_in_kanban ?? true,
  })
  if (error) throw new Error(error.message)
  revalidate()
}

export async function updateDealStage(
  id: string,
  data: Partial<{ name: string; color: string; probability_pct: number; is_won: boolean; is_lost: boolean; show_in_kanban: boolean }>,
) {
  const session = await requireCrmAdmin()
  const { error } = await supabaseAdmin.from("deal_pipeline_stages").update(data).eq("id", id).eq("tenant_id", session.user.tenantId)
  if (error) throw new Error(error.message)
  revalidate()
}

export async function deleteDealStage(id: string) {
  const session = await requireCrmAdmin()
  const t = session.user.tenantId

  const { data: stage } = await supabaseAdmin.from("deal_pipeline_stages")
    .select("pipeline_id, is_won, is_lost").eq("id", id).eq("tenant_id", t).maybeSingle()
  if (!stage) throw new Error("Etapa não encontrada")
  const s = stage as { pipeline_id: string; is_won: boolean; is_lost: boolean }

  // FK ON DELETE SET NULL — sem guard, excluir uma etapa com negócios zeraria o
  // stage_id deles (somem do board). Bloqueia se houver negócio na etapa.
  const { count } = await supabaseAdmin.from("tenant_deals").select("id", { count: "exact", head: true }).eq("stage_id", id).eq("tenant_id", t)
  if ((count ?? 0) > 0) throw new Error(`Esta etapa tem ${count} negócio(s). Mova-os para outra etapa antes de excluir.`)

  // Não excluir a ÚNICA etapa de Ganho/Perda (senão Ganhar/Perder ficam sem destino).
  if (s.is_won || s.is_lost) {
    const flag = s.is_won ? "is_won" : "is_lost"
    const { count: siblings } = await supabaseAdmin.from("deal_pipeline_stages")
      .select("id", { count: "exact", head: true }).eq("pipeline_id", s.pipeline_id).eq("tenant_id", t).eq(flag, true).neq("id", id)
    if ((siblings ?? 0) === 0) throw new Error(`Esta é a única etapa de ${s.is_won ? "Ganho" : "Perda"} do funil. Marque outra antes de excluir.`)
  }

  await supabaseAdmin.from("deal_pipeline_stages").delete().eq("id", id).eq("tenant_id", t)
  revalidate()
}

export async function reorderDealStages(pipelineId: string, orderedIds: string[]) {
  const session = await requireCrmAdmin()
  await Promise.all(orderedIds.map((id, position) =>
    supabaseAdmin.from("deal_pipeline_stages").update({ position }).eq("id", id).eq("tenant_id", session.user.tenantId).eq("pipeline_id", pipelineId)))
  revalidate()
}
