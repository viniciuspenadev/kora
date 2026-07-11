"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { requireModule } from "@/lib/modules"
import { lineSubtotal, DEFAULT_TERM_MONTHS } from "@/lib/crm/value"

// ─────────────────────────────────────────────────────────────────
// Dashboard do pipeline (docs/crm-vision-capture.md, tela 5 da referência).
// UMA busca lean → o CLIENT deriva tudo (KPI-lente, funil velocity, donuts,
// produto-mix, waterfall) — troca de lente é instantânea, sem refetch.
// Gated: owner/admin + crm (painel = gestão). Período = negócios CRIADOS nele.
// ─────────────────────────────────────────────────────────────────

export interface DashDeal {
  id:               string
  name:             string | null
  contact_name:     string | null
  contact_pic:      string | null
  value:            number
  status:           "open" | "won" | "lost" | "canceled"
  stage_id:         string | null
  created_at:       string
  won_at:           string | null
  lost_at:          string | null
  stage_entered_at: string | null
  responsible:      string | null
  responsible_id:   string | null
  lost_reason:      string | null
  /** Itens da composição (nome + contribuição no valor total + SKU se houver). */
  items:            { name: string; total: number; sku: string | null }[]
  /** Entradas de etapa em ordem cronológica (created + stage_changed + reopened). */
  path:             { stage: string; at: string }[]
}

export interface DashStage {
  id: string; name: string; color: string; position: number
  is_won: boolean; is_lost: boolean; show_in_kanban: boolean
}

export interface PipelineDashboardData {
  pipeline:  { id: string; name: string }
  pipelines: { id: string; name: string; is_default: boolean }[]
  stages:    DashStage[]
  deals:     DashDeal[]
  /** Perfis dos responsáveis (nome + email) — foto via /api/user-avatar/[id]. */
  agentProfiles: { id: string; name: string; email: string | null }[]
}

export async function getPipelineDashboard(opts: { pipelineId?: string | null; from: string; to: string }): Promise<PipelineDashboardData | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  if (!["owner", "admin"].includes(session.user.role)) return { error: "Sem permissão" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  const t = session.user.tenantId

  // Funis do tenant → resolve o alvo (param válido > padrão > primeiro).
  const { data: pipes } = await supabaseAdmin.from("deal_pipelines")
    .select("id, name, is_default").eq("tenant_id", t).eq("active", true).order("position")
  const pipelines = ((pipes ?? []) as { id: string; name: string; is_default: boolean }[])
  if (!pipelines.length) return { error: "Nenhum funil de vendas configurado" }
  const pipeline = pipelines.find((p) => p.id === opts.pipelineId) ?? pipelines.find((p) => p.is_default) ?? pipelines[0]

  const [{ data: stageRows }, { data: dealRows }] = await Promise.all([
    supabaseAdmin.from("deal_pipeline_stages")
      .select("id, name, color, position, is_won, is_lost, show_in_kanban")
      .eq("tenant_id", t).eq("pipeline_id", pipeline.id).order("position"),
    supabaseAdmin.from("tenant_deals")
      .select("id, name, status, estimated_value, stage_id, created_at, won_at, lost_at, lost_reason, stage_entered_at, assigned_to, chat_contacts ( push_name, custom_name, profile_pic_url )")
      .eq("tenant_id", t).eq("pipeline_id", pipeline.id)
      .gte("created_at", opts.from).lte("created_at", opts.to)
      .order("created_at", { ascending: false }).limit(1000),
  ])

  const rows    = (dealRows ?? []) as Record<string, unknown>[]
  const dealIds = rows.map((r) => r.id as string)

  // Eventos (path de etapas), itens e nomes de responsável — em lote.
  const [{ data: evRows }, { data: itemRows }, { data: profRows }] = await Promise.all([
    dealIds.length
      ? supabaseAdmin.from("tenant_deal_events")
          .select("deal_id, type, at, to_stage").eq("tenant_id", t).in("deal_id", dealIds)
          .in("type", ["created", "stage_changed", "reopened"]).order("at", { ascending: true })
      : Promise.resolve({ data: [] as unknown[] }),
    dealIds.length
      ? supabaseAdmin.from("tenant_deal_items")
          .select("deal_id, name, billing, unit_price, quantity, discount, term_months, catalog_item_id")
          .eq("tenant_id", t).in("deal_id", dealIds)
      : Promise.resolve({ data: [] as unknown[] }),
    (() => {
      const ids = Array.from(new Set(rows.map((r) => r.assigned_to).filter(Boolean))) as string[]
      return ids.length
        ? supabaseAdmin.from("profiles").select("id, full_name, email").in("id", ids)
        : Promise.resolve({ data: [] as unknown[] })
    })(),
  ])

  // SKU dos itens (subtítulo do produto-mix, como a referência: "SKU:tbronze").
  const catIds = Array.from(new Set(((itemRows ?? []) as { catalog_item_id: string | null }[]).map((i) => i.catalog_item_id).filter(Boolean))) as string[]
  const skuMap = new Map<string, string | null>()
  if (catIds.length) {
    const { data: cats } = await supabaseAdmin.from("catalog_items").select("id, sku").eq("tenant_id", t).in("id", catIds)
    for (const c of (cats ?? []) as { id: string; sku: string | null }[]) skuMap.set(c.id, c.sku)
  }

  const pathMap = new Map<string, { stage: string; at: string }[]>()
  for (const e of (evRows ?? []) as { deal_id: string; to_stage: string | null; at: string }[]) {
    if (!e.to_stage) continue
    const arr = pathMap.get(e.deal_id) ?? []
    if (arr[arr.length - 1]?.stage !== e.to_stage) arr.push({ stage: e.to_stage, at: e.at })
    pathMap.set(e.deal_id, arr)
  }

  const itemMap = new Map<string, { name: string; total: number; sku: string | null }[]>()
  for (const i of (itemRows ?? []) as Record<string, unknown>[]) {
    const line = {
      billing: i.billing as "one_time" | "monthly" | "yearly",
      unit_price: Number(i.unit_price ?? 0), quantity: Number(i.quantity ?? 1),
      discount: Number(i.discount ?? 0), term_months: (i.term_months as number | null) ?? null,
    }
    const sub  = lineSubtotal(line)
    const term = line.term_months ?? DEFAULT_TERM_MONTHS
    const total = line.billing === "one_time" ? sub : line.billing === "monthly" ? sub * term : sub * (term / 12)
    const arr = itemMap.get(i.deal_id as string) ?? []
    arr.push({ name: i.name as string, total: Math.round(total * 100) / 100, sku: i.catalog_item_id ? (skuMap.get(i.catalog_item_id as string) ?? null) : null })
    itemMap.set(i.deal_id as string, arr)
  }

  const profs = ((profRows ?? []) as { id: string; full_name: string | null; email: string | null }[])
  const profMap = new Map(profs.map((p) => [p.id, p.full_name ?? "—"]))
  const agentProfiles = profs.map((p) => ({ id: p.id, name: p.full_name ?? "—", email: p.email }))

  const deals: DashDeal[] = rows.map((r) => {
    const c = r.chat_contacts as { push_name: string | null; custom_name: string | null; profile_pic_url: string | null } | null
    const path = pathMap.get(r.id as string) ?? []
    // Garantia: garante que a etapa atual do negócio esteja sempre na trilha (essencial se faltar evento de transição).
    if (r.stage_id && (path.length === 0 || path[path.length - 1].stage !== r.stage_id)) {
      path.push({ stage: r.stage_id as string, at: (r.stage_entered_at as string | null) ?? (r.created_at as string) })
    }
    return {
      id: r.id as string, name: (r.name as string | null) ?? null,
      contact_name: c ? (c.custom_name?.trim() || c.push_name?.trim() || null) : null,
      contact_pic: c?.profile_pic_url ?? null,
      value: Number(r.estimated_value ?? 0),
      status: r.status as DashDeal["status"],
      stage_id: (r.stage_id as string | null) ?? null,
      created_at: r.created_at as string,
      won_at: (r.won_at as string | null) ?? null,
      lost_at: (r.lost_at as string | null) ?? null,
      stage_entered_at: (r.stage_entered_at as string | null) ?? null,
      responsible: r.assigned_to ? (profMap.get(r.assigned_to as string) ?? null) : null,
      responsible_id: (r.assigned_to as string | null) ?? null,
      lost_reason: (r.lost_reason as string | null) ?? null,
      items: itemMap.get(r.id as string) ?? [],
      path,
    }
  })

  return {
    pipeline: { id: pipeline.id, name: pipeline.name },
    pipelines,
    stages: ((stageRows ?? []) as DashStage[]),
    deals,
    agentProfiles,
  }
}
