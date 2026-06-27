"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { requireModule, hasModule } from "@/lib/modules"
import { getViewerScope, canViewConversation } from "@/lib/visibility"
import { createDeal, syncContactLifecycleFromDeal, recordDealEvent, openDealOf, type DealFieldChange, type DealEventExtras } from "@/lib/crm/deals"

// ═══════════════════════════════════════════════════════════════
// CRM Negócios — Server actions (Fase 1)
// ═══════════════════════════════════════════════════════════════
// Gating: requireModule("crm"). Visibilidade do negócio HERDA a da conversa
// (getViewerScope + canViewConversation) — um atendente só abre/vê negócios de
// conversa que ele já pode ver. Isolamento de tenant em todo acesso.

const CONV_VIS_SELECT = "contact_id, assigned_to, participants, department_id, instance_id, active_deal_id"

type ConvVis = {
  contact_id:     string | null
  assigned_to:    string | null
  participants:   string[] | null
  department_id:  string | null
  instance_id:    string | null
  active_deal_id: string | null
}

/** Carrega a conversa SE o atendente puder vê-la (escopo tenant + regra única). */
async function loadVisibleConversation(conversationId: string, tenantId: string): Promise<ConvVis | null> {
  const { data } = await supabaseAdmin
    .from("chat_conversations").select(CONV_VIS_SELECT)
    .eq("id", conversationId).eq("tenant_id", tenantId)
    .maybeSingle()
  if (!data) return null
  const conv = data as ConvVis
  const scope = await getViewerScope()
  if (!canViewConversation(scope, conv)) return null
  return conv
}

export interface OpenDealInput {
  conversationId:  string
  pipelineId:      string
  stageId:         string
  name?:           string | null
  estimatedValue?: number | null
  expectedClose?:  string | null
  isWon?:          boolean
  isLost?:         boolean
  parentDealId?:   string | null   // handoff: negócio anterior da jornada
}

/**
 * Abre um Negócio explicitamente a partir de uma conversa (o "Novo negócio" da sidebar).
 * É o ÚNICO caminho de criação. Gated + visibilidade herdada.
 */
export async function openDeal(input: OpenDealInput): Promise<{ id: string } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado para este tenant" } }

  const conv = await loadVisibleConversation(input.conversationId, session.user.tenantId)
  if (!conv) return { error: "Sem acesso a esta conversa" }
  if (!conv.contact_id) return { error: "Conversa sem contato" }

  return createDeal({
    tenantId:       session.user.tenantId,
    contactId:      conv.contact_id,
    conversationId: input.conversationId,
    pipelineId:     input.pipelineId,
    stageId:        input.stageId,
    name:           input.name ?? null,
    estimatedValue: input.estimatedValue ?? null,
    expectedClose:  input.expectedClose ?? null,
    isWon:          input.isWon,
    isLost:         input.isLost,
    parentDealId:   input.parentDealId ?? null,
    by:             session.user.id,
  })
}

export interface DealStageMini { id: string; name: string; color: string | null; is_won: boolean; is_lost: boolean }
export interface PanelDeal {
  id:               string
  name:             string | null
  pipeline_id:      string | null
  status:           string                  // 'open' | 'won' | 'lost'
  estimated_value:  number | null
  won_at:           string | null
  lost_at:          string | null
  stage_entered_at: string | null
  created_at:       string
  is_active:        boolean
  pipeline_name:    string | null
  stage:            DealStageMini | null
  next_task:        { id: string; title: string; due_at: string | null } | null
}
export interface DealPipeline {
  id:         string
  name:       string
  is_default: boolean
  stages:     { id: string; name: string; color: string | null; position: number; is_won: boolean; is_lost: boolean; show_in_kanban: boolean }[]
}
export type Relationship = "cliente" | "negociacao" | "prospect"
export interface DealsPanel {
  enabled:      boolean
  activeDealId: string | null
  relationship: Relationship
  wonCount:     number
  deals:        PanelDeal[]
  pipelines:    DealPipeline[]
}

/** CRM ligado pro tenant da sessão? Pra a UI decidir o que mostrar (ex: esconder Pipeline duplicado). */
export async function crmEnabled(): Promise<boolean> {
  const session = await auth()
  if (!session?.user?.tenantId) return false
  try { await requireModule("crm"); return true } catch { return false }
}

/**
 * View-model único da seção "Negócios" da sidebar: negócios do contato (com etapa+cor
 * e nome da trilha), trilhas disponíveis (pro "Novo negócio") e o relacionamento
 * derivado. Gated + visibilidade herdada da conversa.
 */
export async function getDealsPanel(conversationId: string): Promise<DealsPanel> {
  const empty: DealsPanel = { enabled: false, activeDealId: null, relationship: "prospect", wonCount: 0, deals: [], pipelines: [] }
  const session = await auth()
  if (!session?.user?.tenantId) return empty
  try { await requireModule("crm") } catch { return empty }
  const tenantId = session.user.tenantId

  const conv = await loadVisibleConversation(conversationId, tenantId)
  if (!conv) return { ...empty, enabled: true }

  const [dealsRes, pipesRes] = await Promise.all([
    conv.contact_id
      ? supabaseAdmin.from("tenant_deals")
          .select(`
            id, name, pipeline_id, status, estimated_value, won_at, lost_at, stage_entered_at, created_at,
            deal_pipelines ( name ),
            deal_pipeline_stages ( id, name, color, is_won, is_lost )
          `)
          .eq("tenant_id", tenantId).eq("contact_id", conv.contact_id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as unknown[] }),
    supabaseAdmin.from("deal_pipelines")
      .select("id, name, is_default, deal_pipeline_stages ( id, name, color, position, is_won, is_lost, show_in_kanban )")
      .eq("tenant_id", tenantId).eq("active", true).order("position", { ascending: true }),
  ])

  const deals: PanelDeal[] = ((dealsRes.data ?? []) as Record<string, unknown>[]).map((d) => {
    const pipe  = d.deal_pipelines as { name: string | null } | null
    const stage = d.deal_pipeline_stages as DealStageMini | null
    return {
      id:               d.id as string,
      name:             (d.name as string | null) ?? null,
      pipeline_id:      (d.pipeline_id as string | null) ?? null,
      status:           d.status as string,
      estimated_value:  (d.estimated_value as number | null) ?? null,
      won_at:           (d.won_at as string | null) ?? null,
      lost_at:          (d.lost_at as string | null) ?? null,
      stage_entered_at: (d.stage_entered_at as string | null) ?? null,
      created_at:       d.created_at as string,
      is_active:        (d.id as string) === conv.active_deal_id,
      pipeline_name:    pipe?.name ?? null,
      stage:            stage ?? null,
      next_task:        null,
    }
  })

  // Próxima ação (tarefa pendente mais próxima) dos negócios abertos — pra a sidebar do chat.
  const openIds = deals.filter((d) => d.status === "open").map((d) => d.id)
  if (openIds.length) {
    const { data: tk } = await supabaseAdmin.from("tenant_tasks")
      .select("id, deal_id, title, due_at").eq("tenant_id", tenantId).eq("status", "pending").in("deal_id", openIds)
      .order("due_at", { ascending: true, nullsFirst: false })
    const m = new Map<string, { id: string; title: string; due_at: string | null }>()
    for (const r of (tk ?? []) as { id: string; deal_id: string; title: string; due_at: string | null }[])
      if (r.deal_id && !m.has(r.deal_id)) m.set(r.deal_id, { id: r.id, title: r.title, due_at: r.due_at })
    for (const d of deals) d.next_task = m.get(d.id) ?? null
  }

  const pipelines: DealPipeline[] = ((pipesRes.data ?? []) as Record<string, unknown>[]).map((p) => ({
    id:         p.id as string,
    name:       p.name as string,
    is_default: !!p.is_default,
    stages:     ((p.deal_pipeline_stages as DealPipeline["stages"] | null) ?? []).slice().sort((a, b) => a.position - b.position),
  }))

  const wonCount     = deals.filter((d) => d.status === "won").length
  const relationship: Relationship = wonCount > 0 ? "cliente" : deals.some((d) => d.status === "open") ? "negociacao" : "prospect"

  return { enabled: true, activeDealId: conv.active_deal_id, relationship, wonCount, deals, pipelines }
}

/** Funis de VENDA do tenant (deal_pipelines + etapas) — colunas do board de Negócios. */
export async function getDealPipelines(): Promise<DealPipeline[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  try { await requireModule("crm") } catch { return [] }
  const { data } = await supabaseAdmin.from("deal_pipelines")
    .select("id, name, is_default, deal_pipeline_stages ( id, name, color, position, is_won, is_lost, show_in_kanban )")
    .eq("tenant_id", session.user.tenantId).eq("active", true).order("position", { ascending: true })
  return ((data ?? []) as Record<string, unknown>[]).map((p) => ({
    id: p.id as string, name: p.name as string, is_default: !!p.is_default,
    stages: ((p.deal_pipeline_stages as DealPipeline["stages"] | null) ?? []).slice().sort((a, b) => a.position - b.position),
  }))
}

// ── Página de Negócios (centro de gestão do dono) ───────────────

export interface DealRow {
  id:               string
  name:             string | null
  contact_id:       string | null
  contact_name:     string | null
  pipeline_id:      string | null
  pipeline_name:    string | null
  created_by:       string | null
  stage:            DealStageMini | null
  status:           string
  estimated_value:  number | null
  won_at:           string | null
  lost_at:          string | null
  stage_entered_at: string | null
  updated_at:       string
  responsible:      string | null
  next_task:        { title: string; due_at: string | null } | null
}
export interface DealsKpis {
  openValue: number; openCount: number
  wonValue:  number; wonCount:  number
  conversionPct: number; avgTicket: number
}
export interface DealsPageData {
  kpis:      DealsKpis
  deals:     DealRow[]
  pipelines: { id: string; name: string }[]
  agents:    { id: string; name: string }[]
  period:    { from: string; to: string }
}

/**
 * Dados da página /negocios — visão de gestão (owner/admin). KPIs do período +
 * todos os negócios do tenant (filtro/busca client-side). Gated por módulo `crm`.
 */
export async function getDealsPage(opts?: { from?: string; to?: string }): Promise<DealsPageData | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  if (!["owner", "admin"].includes(session.user.role)) return { error: "Apenas owner/admin acessam a gestão de negócios" }
  const t = session.user.tenantId

  const to   = opts?.to   ?? new Date().toISOString().slice(0, 10)
  const from = opts?.from ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)

  const [{ data }, { data: pipes }, { data: members }] = await Promise.all([
    supabaseAdmin.from("tenant_deals").select(`
      id, name, contact_id, pipeline_id, status, estimated_value, won_at, lost_at, stage_entered_at, updated_at, created_by,
      chat_contacts ( push_name, custom_name ),
      deal_pipelines ( name ),
      deal_pipeline_stages ( id, name, color, is_won, is_lost )
    `).eq("tenant_id", t).order("updated_at", { ascending: false }).limit(2000),
    supabaseAdmin.from("deal_pipelines").select("id, name").eq("tenant_id", t).eq("active", true).order("position"),
    supabaseAdmin.from("tenant_users").select("user_id, profiles!tenant_users_user_id_fkey ( full_name )").eq("tenant_id", t).eq("active", true),
  ])

  const rows  = (data ?? []) as Record<string, unknown>[]
  const byIds = Array.from(new Set(rows.map((r) => r.created_by as string | null).filter(Boolean))) as string[]
  const nameMap = new Map<string, string>()
  if (byIds.length) {
    const { data: profs } = await supabaseAdmin.from("profiles").select("id, full_name").in("id", byIds)
    for (const p of (profs ?? []) as { id: string; full_name: string | null }[]) nameMap.set(p.id, p.full_name ?? "—")
  }

  const deals: DealRow[] = rows.map((r) => {
    const c = r.chat_contacts as { push_name: string | null; custom_name: string | null } | null
    return {
      id:               r.id as string,
      name:             (r.name as string | null) ?? null,
      contact_id:       (r.contact_id as string | null) ?? null,
      contact_name:     c?.custom_name?.trim() || c?.push_name?.trim() || null,
      pipeline_id:      (r.pipeline_id as string | null) ?? null,
      pipeline_name:    (r.deal_pipelines as { name: string | null } | null)?.name ?? null,
      created_by:       (r.created_by as string | null) ?? null,
      stage:            (r.deal_pipeline_stages as DealStageMini | null) ?? null,
      status:           r.status as string,
      estimated_value:  (r.estimated_value as number | null) ?? null,
      won_at:           (r.won_at as string | null) ?? null,
      lost_at:          (r.lost_at as string | null) ?? null,
      stage_entered_at: (r.stage_entered_at as string | null) ?? null,
      updated_at:       r.updated_at as string,
      responsible:      r.created_by ? (nameMap.get(r.created_by as string) ?? null) : null,
      next_task:        null,
    }
  })

  // Próxima ação = tarefa pendente mais próxima de cada negócio.
  const dealIds = deals.map((d) => d.id)
  if (dealIds.length) {
    const { data: tk } = await supabaseAdmin.from("tenant_tasks")
      .select("deal_id, title, due_at").eq("tenant_id", t).eq("status", "pending").in("deal_id", dealIds)
      .order("due_at", { ascending: true, nullsFirst: false })
    const nextMap = new Map<string, { title: string; due_at: string | null }>()
    for (const r of (tk ?? []) as { deal_id: string; title: string; due_at: string | null }[])
      if (r.deal_id && !nextMap.has(r.deal_id)) nextMap.set(r.deal_id, { title: r.title, due_at: r.due_at })
    for (const d of deals) d.next_task = nextMap.get(d.id) ?? null
  }

  const inPeriod = (ts: string | null) => ts != null && ts.slice(0, 10) >= from && ts.slice(0, 10) <= to
  const open    = deals.filter((d) => d.status === "open")
  const wonInP  = deals.filter((d) => d.status === "won"  && inPeriod(d.won_at))
  const lostInP = deals.filter((d) => d.status === "lost" && inPeriod(d.lost_at))
  const openValue = open.reduce((s, d) => s + Number(d.estimated_value ?? 0), 0)
  const wonValue  = wonInP.reduce((s, d) => s + Number(d.estimated_value ?? 0), 0)
  const closed    = wonInP.length + lostInP.length
  const kpis: DealsKpis = {
    openValue, openCount: open.length,
    wonValue,  wonCount:  wonInP.length,
    conversionPct: closed > 0 ? Math.round((wonInP.length / closed) * 100) : 0,
    avgTicket:     wonInP.length > 0 ? Math.round(wonValue / wonInP.length) : 0,
  }

  const pipelines = (pipes ?? []) as { id: string; name: string }[]
  const agents = ((members ?? []) as { user_id: string; profiles: { full_name: string | null } | { full_name: string | null }[] | null }[])
    .map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return { id: m.user_id, name: p?.full_name ?? "—" } })
    .filter((a) => a.name !== "—")

  return { kpis, deals, pipelines, agents, period: { from, to } }
}

// ── Ficha do Negócio (drawer) ───────────────────────────────────

/** Pode ver/agir no negócio? Manager (admin/view_all) OU vê alguma conversa do contato. */
export async function canAccessDeal(tenantId: string, contactId: string | null): Promise<boolean> {
  const scope = await getViewerScope()
  if (scope.isAdmin || scope.viewAll) return true
  if (!contactId) return false
  const { data } = await supabaseAdmin
    .from("chat_conversations").select("assigned_to, participants, department_id, instance_id")
    .eq("tenant_id", tenantId).eq("contact_id", contactId)
  return ((data ?? []) as ConvVis[]).some((c) => canViewConversation(scope, c))
}

export interface DealEventView { id: string; type: string; at: string; by: string | null; from_stage: string | null; to_stage: string | null; note: string | null; reason: string | null; change: DealFieldChange | null; extras: DealEventExtras | null }
export interface DealDetail {
  id: string; name: string | null; status: string
  estimated_value: number | null; expected_close_date: string | null
  won_at: string | null; lost_at: string | null; lost_reason: string | null
  canceled_at?: string | null
  stage_entered_at: string | null; created_at: string
  pipeline_id: string | null; pipeline_name: string | null
  stage: DealStageMini | null
  contact: { id: string; name: string | null; push_name?: string | null; profile_pic_url?: string | null; phone_number?: string | null; lifecycle_stage?: string | null } | null
  responsible: string | null
  conversationId: string | null
  lastMessageAt: string | null
  pipelines: DealPipeline[]
  events: DealEventView[]
  otherDeals: { id: string; name: string | null; status: string; estimated_value: number | null }[]
  nextTask: { id: string; title: string; due_at: string | null } | null
}

export async function getDeal(dealId: string): Promise<DealDetail | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  const t = session.user.tenantId

  const { data: d } = await supabaseAdmin.from("tenant_deals").select(`
    id, name, status, estimated_value, expected_close_date, won_at, lost_at, lost_reason, canceled_at, stage_entered_at, created_at, created_by, contact_id, pipeline_id,
    chat_contacts ( id, push_name, custom_name, profile_pic_url, phone_number, lifecycle_stage ),
    deal_pipelines ( name ),
    deal_pipeline_stages ( id, name, color, is_won, is_lost )
  `).eq("id", dealId).eq("tenant_id", t).maybeSingle()
  if (!d) return { error: "Negócio não encontrado" }
  const deal = d as Record<string, unknown>
  if (!(await canAccessDeal(t, deal.contact_id as string | null))) return { error: "Sem acesso a este negócio" }
  const contactId = deal.contact_id as string | null

  const [{ data: evs }, { data: convs }, { data: pipes }, { data: others }, { data: tasks }] = await Promise.all([
    supabaseAdmin.from("tenant_deal_events").select("id, type, at, by, from_stage, to_stage, meta").eq("tenant_id", t).eq("deal_id", dealId).order("at", { ascending: true }),
    // Conversa do CONTATO (não só a do negócio ativo): a que tem este negócio como ativo,
    // senão a mais recente — pra a página poder mover/anotar mesmo em negócio secundário.
    contactId
      ? supabaseAdmin.from("chat_conversations").select("id, active_deal_id, last_message_at").eq("tenant_id", t).eq("contact_id", contactId).order("last_message_at", { ascending: false, nullsFirst: false }).limit(20)
      : Promise.resolve({ data: [] as unknown[] }),
    supabaseAdmin.from("deal_pipelines").select("id, name, is_default, deal_pipeline_stages ( id, name, color, position, is_won, is_lost, show_in_kanban )").eq("tenant_id", t).eq("active", true).order("position"),
    contactId
      ? supabaseAdmin.from("tenant_deals").select("id, name, status, estimated_value").eq("tenant_id", t).eq("contact_id", contactId).neq("id", dealId).order("created_at", { ascending: false }).limit(20)
      : Promise.resolve({ data: [] as unknown[] }),
    supabaseAdmin.from("tenant_tasks").select("id, title, due_at").eq("tenant_id", t).eq("deal_id", dealId).eq("status", "pending").order("due_at", { ascending: true, nullsFirst: false }).limit(1),
  ])

  const evRows   = (evs ?? []) as Record<string, unknown>[]
  const stageIds = Array.from(new Set(evRows.flatMap((e) => [e.from_stage, e.to_stage]).filter(Boolean))) as string[]
  const byIds    = Array.from(new Set([...evRows.map((e) => e.by), deal.created_by].filter(Boolean))) as string[]
  const [stageNames, byNames] = await Promise.all([
    stageIds.length ? supabaseAdmin.from("deal_pipeline_stages").select("id, name").in("id", stageIds) : Promise.resolve({ data: [] as unknown[] }),
    byIds.length    ? supabaseAdmin.from("profiles").select("id, full_name").in("id", byIds)      : Promise.resolve({ data: [] as unknown[] }),
  ])
  const sMap = new Map(((stageNames.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]))
  const pMap = new Map(((byNames.data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? "—"]))

  const events: DealEventView[] = evRows.map((e) => {
    const meta = (e.meta ?? {}) as { note?: string | null; reason?: string | null; actor?: { label?: string | null } | null; change?: DealFieldChange | null; extras?: DealEventExtras | null }
    return {
      id: e.id as string, type: e.type as string, at: e.at as string,
      by:         meta.actor?.label ?? (e.by ? (pMap.get(e.by as string) ?? null) : null),
      from_stage: e.from_stage ? (sMap.get(e.from_stage as string) ?? null) : null,
      to_stage:   e.to_stage   ? (sMap.get(e.to_stage as string) ?? null) : null,
      note:       meta.note ?? null,
      reason:     meta.reason ?? null,
      change:     meta.change ?? null,
      extras:     meta.extras ?? null,
    }
  })

  const c = deal.chat_contacts as { id: string; push_name: string | null; custom_name: string | null; profile_pic_url: string | null; phone_number: string | null; lifecycle_stage: string | null } | null
  const pipelines: DealPipeline[] = ((pipes ?? []) as Record<string, unknown>[]).map((p) => ({
    id: p.id as string, name: p.name as string, is_default: !!p.is_default,
    stages: ((p.deal_pipeline_stages as DealPipeline["stages"] | null) ?? []).slice().sort((a, b) => a.position - b.position),
  }))

  return {
    id: deal.id as string, name: (deal.name as string | null) ?? null, status: deal.status as string,
    estimated_value: (deal.estimated_value as number | null) ?? null, expected_close_date: (deal.expected_close_date as string | null) ?? null,
    won_at: (deal.won_at as string | null) ?? null, lost_at: (deal.lost_at as string | null) ?? null, lost_reason: (deal.lost_reason as string | null) ?? null,
    stage_entered_at: (deal.stage_entered_at as string | null) ?? null, created_at: deal.created_at as string,
    pipeline_id: (deal.pipeline_id as string | null) ?? null, pipeline_name: (deal.deal_pipelines as { name: string | null } | null)?.name ?? null,
    stage: (deal.deal_pipeline_stages as DealStageMini | null) ?? null,
    canceled_at: (deal.canceled_at as string | null) ?? null,
    contact: c ? { id: c.id, name: c.custom_name?.trim() || c.push_name?.trim() || null, push_name: c.push_name, profile_pic_url: c.profile_pic_url, phone_number: c.phone_number, lifecycle_stage: c.lifecycle_stage } : null,
    responsible: deal.created_by ? (pMap.get(deal.created_by as string) ?? null) : null,
    conversationId: (() => {
      const rows = (convs ?? []) as { id: string; active_deal_id: string | null }[]
      return rows.find((r) => r.active_deal_id === dealId)?.id ?? rows[0]?.id ?? null
    })(),
    lastMessageAt: (() => {
      const rows = (convs ?? []) as { last_message_at: string | null }[]
      return rows.map((r) => r.last_message_at).filter(Boolean).sort().reverse()[0] ?? null
    })(),
    pipelines, events,
    otherDeals: ((others ?? []) as Record<string, unknown>[]).map((o) => ({ id: o.id as string, name: (o.name as string | null) ?? null, status: o.status as string, estimated_value: (o.estimated_value as number | null) ?? null })),
    nextTask: (tasks && (tasks as unknown[])[0]) ? (() => { const tk = (tasks as Record<string, unknown>[])[0]; return { id: tk.id as string, title: tk.title as string, due_at: (tk.due_at as string | null) ?? null } })() : null,
  }
}

/** Edita nome e/ou valor do negócio. Gated + visibilidade herdada. */
export async function updateDeal(dealId: string, fields: { name?: string; estimatedValue?: number | null }, opts?: { silentCard?: boolean }): Promise<{ ok: true } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  const t = session.user.tenantId
  const { data: deal } = await supabaseAdmin.from("tenant_deals").select("contact_id, name, estimated_value").eq("id", dealId).eq("tenant_id", t).maybeSingle()
  if (!deal) return { error: "Negócio não encontrado" }
  const d = deal as { contact_id: string | null; name: string | null; estimated_value: number | null }
  if (!(await canAccessDeal(t, d.contact_id))) return { error: "Sem acesso" }

  // Detecta o que MUDOU de fato (pra auditar antes→depois e não gravar evento à toa).
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const changes: DealFieldChange[] = []
  if (fields.name !== undefined) {
    const next = fields.name.trim() || null
    if (next !== (d.name ?? null)) { patch.name = next; changes.push({ label: "Nome", from: d.name ?? "—", to: next ?? "—" }) }
  }
  if (fields.estimatedValue !== undefined) {
    const next = fields.estimatedValue ?? null
    if (next !== (d.estimated_value ?? null)) {
      patch.estimated_value = next
      const fmt = (v: number | null) => v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) : "—"
      changes.push({ label: "Valor", from: fmt(d.estimated_value), to: fmt(next) })
    }
  }
  if (changes.length === 0) return { ok: true }   // nada mudou de fato

  await supabaseAdmin.from("tenant_deals").update(patch).eq("id", dealId).eq("tenant_id", t)
  // Conversa do contato (mais recente) → cartão ENXUTO sinaliza no chat e leva ao dossiê.
  const { data: conv } = await supabaseAdmin.from("chat_conversations")
    .select("id").eq("tenant_id", t).eq("contact_id", d.contact_id ?? "")
    .order("last_message_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
  const conversationId = (conv as { id: string } | null)?.id ?? null
  // Auditoria (antes→depois fica no dossiê via meta.change) + cartão compacto com link.
  for (const change of changes) {
    await recordDealEvent({ tenantId: t, dealId, type: "field_changed", conversationId, by: session.user.id, change, postCard: !opts?.silentCard })
  }
  return { ok: true }
}

/**
 * Move um negócio por dealId — o mover CANÔNICO (Kanban de Negócios + qualquer caminho
 * sem conversationId à mão). Resolve a conversa do negócio (pro espelho + card), atualiza
 * o deal, espelha na conversa e grava via `recordDealEvent` (evento rico + card no chat +
 * timeline) — mesma narrativa do `moveDeal`. Gated + visibilidade herdada + lifecycle.
 */
export async function moveDealById(dealId: string, stageId: string, opts?: { note?: string | null; lostReason?: string | null; extras?: DealEventExtras }): Promise<{ ok: true } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  const t = session.user.tenantId

  const { data: deal } = await supabaseAdmin.from("tenant_deals").select("contact_id, stage_id").eq("id", dealId).eq("tenant_id", t).maybeSingle()
  const d = deal as { contact_id: string | null; stage_id: string | null } | null
  if (!d) return { error: "Negócio não encontrado" }
  if (!(await canAccessDeal(t, d.contact_id))) return { error: "Sem acesso" }

  const { data: stage } = await supabaseAdmin.from("deal_pipeline_stages").select("id, pipeline_id, is_won, is_lost").eq("id", stageId).eq("tenant_id", t).maybeSingle()
  if (!stage) return { error: "Etapa inválida" }
  const st = stage as { id: string; pipeline_id: string; is_won: boolean; is_lost: boolean }
  if (st.id === d.stage_id) return { ok: true }   // já está lá

  // Conversa do negócio (pro card + espelho): a que aponta este deal como ativo, senão a + recente do contato.
  let conversationId: string | null = null
  if (d.contact_id) {
    const { data: convs } = await supabaseAdmin.from("chat_conversations")
      .select("id, active_deal_id").eq("tenant_id", t).eq("contact_id", d.contact_id)
      .order("last_message_at", { ascending: false, nullsFirst: false }).limit(20)
    const rows = (convs ?? []) as { id: string; active_deal_id: string | null }[]
    conversationId = rows.find((r) => r.active_deal_id === dealId)?.id ?? rows[0]?.id ?? null
  }

  const now    = new Date().toISOString()
  const status = st.is_won ? "won" : st.is_lost ? "lost" : "open"
  const reason = st.is_lost ? (opts?.lostReason?.trim() || null) : null

  await supabaseAdmin.from("tenant_deals").update({
    pipeline_id: st.pipeline_id, stage_id: st.id, status,
    won_at: st.is_won ? now : null, lost_at: st.is_lost ? now : null,
    lost_reason: reason, stage_entered_at: now, updated_at: now,
  }).eq("id", dealId).eq("tenant_id", t)

  // Liga o negócio à conversa como ativo — SEM espelhar etapa (funil de venda ≠ atendimento).
  if (conversationId) {
    await supabaseAdmin.from("chat_conversations")
      .update({ active_deal_id: dealId, updated_at: now })
      .eq("id", conversationId).eq("tenant_id", t)
  }

  // Fonte única da narrativa: evento rico + card interno no chat (quando há conversa).
  await recordDealEvent({
    tenantId: t, dealId, type: status === "open" ? "stage_changed" : status,
    conversationId, fromStageId: d.stage_id, toStageId: st.id, by: session.user.id,
    reason, note: opts?.note ?? null, extras: opts?.extras,
  })
  // Lifecycle do contato: ganho→Cliente · aberto/trabalho→Lead · perdido→não-mexe (nunca rebaixa). Doc §5.
  if (d.contact_id) await syncContactLifecycleFromDeal(t, d.contact_id, st)
  return { ok: true }
}

/** Reabre um negócio ganho/perdido (volta a 'open', mantém a etapa). */
export async function reopenDealById(dealId: string): Promise<{ ok: true } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  const t = session.user.tenantId
  const { data: deal } = await supabaseAdmin.from("tenant_deals").select("contact_id, stage_id").eq("id", dealId).eq("tenant_id", t).maybeSingle()
  if (!deal) return { error: "Negócio não encontrado" }
  const reopenContactId = (deal as { contact_id: string | null }).contact_id
  if (!(await canAccessDeal(t, reopenContactId))) return { error: "Sem acesso" }
  // Trava "um aberto por vez": não reabre se o contato já tem outro negócio aberto.
  if (reopenContactId) {
    const open = await openDealOf(t, reopenContactId, dealId)
    if (open) return { error: `Não é possível reabrir: este contato já tem outro negócio aberto${open.name ? ` (“${open.name}”)` : ""}. Finalize-o antes.` }
  }
  const now = new Date().toISOString()
  await supabaseAdmin.from("tenant_deals").update({ status: "open", won_at: null, lost_at: null, lost_reason: null, updated_at: now }).eq("id", dealId).eq("tenant_id", t)
  await supabaseAdmin.from("tenant_deal_events").insert({ tenant_id: t, deal_id: dealId, type: "reopened", to_stage: (deal as { stage_id: string | null }).stage_id, by: session.user.id })
  return { ok: true }
}

// ── Cliente 360 — prontuário do contato ─────────────────────────

export interface ContactRecordContact {
  id: string; push_name: string | null; custom_name: string | null; phone_number: string | null
  email: string | null; company: string | null; doc_id: string | null; birth_date: string | null
  profile_pic_url: string | null; source: string | null; lifecycle_stage: string | null
  qualified_at: string | null; notes: string | null; is_blocked: boolean; created_at: string; bsuid: string | null; username: string | null; wp_username: string | null; ig_username: string | null
  phone_secondary: string | null; phone_secondary_label: string | null
  address_cep: string | null; address_street: string | null; address_number: string | null
  address_complement: string | null; address_district: string | null; address_city: string | null
  address_state: string | null; address_country: string | null
  consent_opt_in: boolean | null; consent_at: string | null; consent_source: string | null; marketing_opt_in: boolean | null
  custom_fields: Record<string, unknown> | null
}
export interface ContactConversation {
  id: string; status: string; channel: string | null
  last_message_at: string | null; last_message_preview: string | null; unread_count: number
}
export interface ContactStats {
  relationship: Relationship
  generatedValue: number; wonCount: number; dealCount: number; openCount: number
  customerSince: string | null; lastInteraction: string | null
}
export interface ContactRecord {
  contact:       ContactRecordContact
  stats:         ContactStats
  deals:         PanelDeal[]
  conversations: ContactConversation[]
  pipelines:     DealPipeline[]
  crmEnabled:    boolean
}

export interface ActivityItem {
  id:    string
  kind:  "deal_won" | "deal_lost" | "deal" | "conversation" | "appointment" | "lifecycle" | "task"
  at:    string
  title: string
  sub:   string | null
}

/** Timeline unificada de atividade do contato (negócios + conversas + agenda + qualificação). */
export async function getContactActivity(contactId: string): Promise<ActivityItem[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  const t = session.user.tenantId

  const { data: c } = await supabaseAdmin.from("chat_contacts")
    .select("created_at, qualified_at").eq("id", contactId).eq("tenant_id", t).maybeSingle()
  if (!c) return []
  const crmOn = await hasModule(t, "crm")

  const [dealsRes, convRes, apptRes] = await Promise.all([
    crmOn ? supabaseAdmin.from("tenant_deals").select("id, name").eq("tenant_id", t).eq("contact_id", contactId) : Promise.resolve({ data: [] as unknown[] }),
    supabaseAdmin.from("chat_conversations").select("id, created_at, channel").eq("tenant_id", t).eq("contact_id", contactId).order("created_at", { ascending: false }).limit(50),
    supabaseAdmin.from("appointments").select("id, starts_at, status").eq("tenant_id", t).eq("contact_id", contactId).order("starts_at", { ascending: false }).limit(50),
  ])

  const dealMap = new Map(((dealsRes.data ?? []) as { id: string; name: string | null }[]).map((d) => [d.id, d.name]))
  const items: ActivityItem[] = []

  if (crmOn && dealMap.size) {
    const { data: evs } = await supabaseAdmin.from("tenant_deal_events")
      .select("id, deal_id, type, at, to_stage").eq("tenant_id", t).in("deal_id", Array.from(dealMap.keys()))
      .order("at", { ascending: false }).limit(120)
    const evRows = (evs ?? []) as Record<string, unknown>[]
    const stageIds = Array.from(new Set(evRows.map((e) => e.to_stage).filter(Boolean))) as string[]
    const sMap = new Map<string, string>()
    if (stageIds.length) { const { data: ss } = await supabaseAdmin.from("deal_pipeline_stages").select("id, name").in("id", stageIds); for (const s of (ss ?? []) as { id: string; name: string }[]) sMap.set(s.id, s.name) }
    for (const e of evRows) {
      const dealName = dealMap.get(e.deal_id as string) || "Negócio"
      const to = e.to_stage ? sMap.get(e.to_stage as string) : null
      const type = e.type as string
      const title =
          type === "created"  ? `Negócio aberto: ${dealName}`
        : type === "won"      ? `Negócio ganho: ${dealName}`
        : type === "lost"     ? `Negócio perdido: ${dealName}`
        : type === "reopened" ? `Negócio reaberto: ${dealName}`
        : `${dealName} movido${to ? ` → ${to}` : ""}`
      items.push({ id: `deal-${e.id}`, kind: type === "won" ? "deal_won" : type === "lost" ? "deal_lost" : "deal", at: e.at as string, title, sub: null })
    }
  }

  for (const cv of (convRes.data ?? []) as { id: string; created_at: string; channel: string | null }[])
    items.push({ id: `conv-${cv.id}`, kind: "conversation", at: cv.created_at, title: "Conversa iniciada", sub: cv.channel })

  for (const a of (apptRes.data ?? []) as { id: string; starts_at: string; status: string }[])
    items.push({ id: `appt-${a.id}`, kind: "appointment", at: a.starts_at, title: "Agendamento", sub: a.status })

  if (crmOn) {
    const { data: tk } = await supabaseAdmin.from("tenant_tasks")
      .select("id, title, created_at, done_at").eq("tenant_id", t).eq("contact_id", contactId)
      .order("created_at", { ascending: false }).limit(40)
    for (const a of (tk ?? []) as { id: string; title: string; created_at: string; done_at: string | null }[]) {
      items.push({ id: `task-c-${a.id}`, kind: "task", at: a.created_at, title: `Tarefa: ${a.title}`, sub: null })
      if (a.done_at) items.push({ id: `task-d-${a.id}`, kind: "task", at: a.done_at, title: `Tarefa concluída: ${a.title}`, sub: null })
    }
  }

  if (c.qualified_at) items.push({ id: "qualified", kind: "lifecycle", at: c.qualified_at as string, title: "Qualificado como lead", sub: null })
  items.push({ id: "created", kind: "lifecycle", at: c.created_at as string, title: "Contato criado", sub: null })

  return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 80)
}

/** Agrega TUDO de um contato pra a página /contatos/[id] (Cliente 360). */
export async function getContactRecord(contactId: string): Promise<ContactRecord | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  const t = session.user.tenantId

  const { data: c } = await supabaseAdmin.from("chat_contacts")
    .select("id, push_name, custom_name, phone_number, email, company, doc_id, birth_date, profile_pic_url, source, lifecycle_stage, qualified_at, notes, is_blocked, created_at, bsuid, username, wp_username, ig_username, phone_secondary, phone_secondary_label, address_cep, address_street, address_number, address_complement, address_district, address_city, address_state, address_country, consent_opt_in, consent_at, consent_source, marketing_opt_in, custom_fields")
    .eq("id", contactId).eq("tenant_id", t).maybeSingle()
  if (!c) return { error: "Contato não encontrado" }

  const crmEnabled = await hasModule(t, "crm")

  const [dealsRes, convRes, pipesRes] = await Promise.all([
    crmEnabled
      ? supabaseAdmin.from("tenant_deals").select(`
          id, name, pipeline_id, status, estimated_value, won_at, lost_at, stage_entered_at, created_at,
          deal_pipelines ( name ), deal_pipeline_stages ( id, name, color, is_won, is_lost )
        `).eq("tenant_id", t).eq("contact_id", contactId).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as unknown[] }),
    supabaseAdmin.from("chat_conversations")
      .select("id, status, channel, last_message_at, last_message_preview, unread_count")
      .eq("tenant_id", t).eq("contact_id", contactId).is("archived_at", null)
      .order("last_message_at", { ascending: false, nullsFirst: false }).limit(50),
    crmEnabled
      ? supabaseAdmin.from("deal_pipelines").select("id, name, is_default, deal_pipeline_stages ( id, name, color, position, is_won, is_lost, show_in_kanban )").eq("tenant_id", t).eq("active", true).order("position")
      : Promise.resolve({ data: [] as unknown[] }),
  ])

  const deals: PanelDeal[] = ((dealsRes.data ?? []) as Record<string, unknown>[]).map((d) => ({
    id:               d.id as string,
    name:             (d.name as string | null) ?? null,
    pipeline_id:      (d.pipeline_id as string | null) ?? null,
    status:           d.status as string,
    estimated_value:  (d.estimated_value as number | null) ?? null,
    won_at:           (d.won_at as string | null) ?? null,
    lost_at:          (d.lost_at as string | null) ?? null,
    stage_entered_at: (d.stage_entered_at as string | null) ?? null,
    created_at:       d.created_at as string,
    is_active:        false,
    pipeline_name:    (d.deal_pipelines as { name: string | null } | null)?.name ?? null,
    stage:            (d.deal_pipeline_stages as DealStageMini | null) ?? null,
    next_task:        null,
  }))
  const conversations = (convRes.data ?? []) as ContactConversation[]
  const pipelines: DealPipeline[] = ((pipesRes.data ?? []) as Record<string, unknown>[]).map((p) => ({
    id: p.id as string, name: p.name as string, is_default: !!p.is_default,
    stages: ((p.deal_pipeline_stages as DealPipeline["stages"] | null) ?? []).slice().sort((a, b) => a.position - b.position),
  }))

  const won = deals.filter((d) => d.status === "won")
  const wonAts = won.map((d) => d.won_at).filter(Boolean) as string[]
  const lastInteraction = [conversations[0]?.last_message_at ?? null, deals[0]?.created_at ?? null]
    .filter(Boolean).sort().reverse()[0] ?? null
  const stats: ContactStats = {
    relationship:   won.length > 0 ? "cliente" : deals.some((d) => d.status === "open") ? "negociacao" : "prospect",
    generatedValue: won.reduce((s, d) => s + Number(d.estimated_value ?? 0), 0),
    wonCount:       won.length,
    dealCount:      deals.length,
    openCount:      deals.filter((d) => d.status === "open").length,
    customerSince:  wonAts.length ? wonAts.slice().sort()[0] : null,
    lastInteraction,
  }

  return { contact: c as ContactRecordContact, stats, deals, conversations, pipelines, crmEnabled }
}

/**
 * Move um Negócio para outra etapa (avançar / ganhar / perder) a partir da sidebar.
 * Vira o negócio ativo da conversa. Gated + visibilidade + ownership (deal do contato).
 */
export async function moveDeal(conversationId: string, dealId: string, stageId: string, reason?: string | null, note?: string | null, extras?: DealEventExtras): Promise<{ ok: true } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  const tenantId = session.user.tenantId

  const conv = await loadVisibleConversation(conversationId, tenantId)
  if (!conv || !conv.contact_id) return { error: "Sem acesso a esta conversa" }

  const { data: deal } = await supabaseAdmin.from("tenant_deals")
    .select("contact_id, stage_id").eq("id", dealId).eq("tenant_id", tenantId).maybeSingle()
  if (!deal || (deal as { contact_id: string }).contact_id !== conv.contact_id) return { error: "Negócio inválido para esta conversa" }

  const { data: stage } = await supabaseAdmin.from("deal_pipeline_stages")
    .select("id, pipeline_id, is_won, is_lost").eq("id", stageId).eq("tenant_id", tenantId).maybeSingle()
  if (!stage) return { error: "Etapa inválida" }
  const st = stage as { id: string; pipeline_id: string; is_won: boolean; is_lost: boolean }

  const now    = new Date().toISOString()
  const status = st.is_won ? "won" : st.is_lost ? "lost" : "open"
  const fromStage = (deal as { stage_id: string | null }).stage_id

  await supabaseAdmin.from("tenant_deals").update({
    pipeline_id: st.pipeline_id, stage_id: st.id, status,
    won_at: st.is_won ? now : null, lost_at: st.is_lost ? now : null,
    stage_entered_at: now, updated_at: now,
  }).eq("id", dealId).eq("tenant_id", tenantId)

  // moveDeal torna este o negócio ATIVO da conversa — SEM espelhar etapa (o funil de venda
  // mora no negócio; o pipeline da conversa é só atendimento e é independente).
  await supabaseAdmin.from("chat_conversations")
    .update({ active_deal_id: dealId, updated_at: now })
    .eq("id", conversationId).eq("tenant_id", tenantId)

  // Evento + cartão interno no chat (de→para, autor, motivo se perder). Fonte única da narrativa.
  await recordDealEvent({
    tenantId, dealId, type: status === "open" ? "stage_changed" : status,
    conversationId, fromStageId: fromStage, toStageId: st.id, by: session.user.id, reason: reason ?? null, note: note ?? null, extras,
  })
  // Lifecycle do contato: ganho→Cliente · aberto/trabalho→Lead · perdido→não-mexe (nunca rebaixa). Doc §5.
  await syncContactLifecycleFromDeal(tenantId, conv.contact_id, st)
  return { ok: true }
}

// ── Feed "Movimentações" (sidebar) — mensagens internas da conversa ──────────
// Unifica os cartões de evento do negócio (deal_event) + as notas internas livres.
// Cada item carrega o id da mensagem → clicar rola até ela no chat (#msg-<id>).
export interface DealEventMeta {
  type: string; from_name?: string | null; to_name?: string | null
  note?: string | null; reason?: string | null; deal_id?: string | null
  change?: { label?: string | null } | null
  actor?: { kind?: string; label?: string | null } | null
}
export interface TimelineItem {
  id:         string
  createdAt:  string
  kind:       "deal_event" | "note"
  content:    string
  authorName: string | null
  dealEvent:  DealEventMeta | null
}

/** Timeline interna da conversa (eventos do negócio + notas livres), mais recente 1º. */
export async function getConversationTimeline(conversationId: string): Promise<TimelineItem[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  const tenantId = session.user.tenantId
  const conv = await loadVisibleConversation(conversationId, tenantId)   // visibilidade herdada
  if (!conv) return []

  const { data } = await supabaseAdmin.from("chat_messages")
    .select("id, content, created_at, sender_type, sender_id, metadata")
    .eq("conversation_id", conversationId).eq("tenant_id", tenantId)
    .eq("is_private_note", true)
    .order("created_at", { ascending: false }).limit(60)
  const rows = (data ?? []) as { id: string; content: string | null; created_at: string; sender_type: string; sender_id: string | null; metadata: unknown }[]

  // Resolve nomes dos autores das notas livres (agente) num único select.
  const ids = [...new Set(rows.filter((r) => r.sender_id).map((r) => r.sender_id as string))]
  const nameById: Record<string, string> = {}
  if (ids.length > 0) {
    const { data: profs } = await supabaseAdmin.from("profiles").select("id, full_name").in("id", ids)
    for (const p of (profs ?? []) as { id: string; full_name: string | null }[]) nameById[p.id] = p.full_name ?? ""
  }

  return rows.map((r) => {
    const de = (r.metadata as { deal_event?: DealEventMeta } | null)?.deal_event ?? null
    const author = de?.actor?.label ?? (r.sender_id ? nameById[r.sender_id] || null : (r.sender_type === "system" ? "Sistema" : null))
    return { id: r.id, createdAt: r.created_at, kind: de ? "deal_event" : "note", content: r.content ?? "", authorName: author, dealEvent: de }
  })
}

/**
 * CANCELA um negócio (≠ Perdido): anula. NÃO conta como perda, NÃO rebaixa o lifecycle.
 * O card volta a ser "sem negócio" na coluna atual (limpa só o `active_deal_id`, mantém a
 * etapa da conversa). Registra evento + cartão no chat. Gated + visibilidade + posse.
 * ⚠️ Requer a migration 20260622_deal_cancel.sql aplicada (status 'canceled').
 */
export async function cancelDeal(conversationId: string, dealId: string, reason?: string | null): Promise<{ ok: true } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  const tenantId = session.user.tenantId

  const conv = await loadVisibleConversation(conversationId, tenantId)
  if (!conv || !conv.contact_id) return { error: "Sem acesso a esta conversa" }

  const { data: deal } = await supabaseAdmin.from("tenant_deals")
    .select("contact_id, stage_id, status").eq("id", dealId).eq("tenant_id", tenantId).maybeSingle()
  const d = deal as { contact_id: string; stage_id: string | null; status: string } | null
  if (!d || d.contact_id !== conv.contact_id) return { error: "Negócio inválido para esta conversa" }
  if (d.status === "canceled") return { error: "Negócio já cancelado" }

  const now = new Date().toISOString()
  await supabaseAdmin.from("tenant_deals")
    .update({ status: "canceled", canceled_at: now, updated_at: now })
    .eq("id", dealId).eq("tenant_id", tenantId)

  // Volta a ser "sem negócio" na coluna atual: limpa só o ponteiro ativo (mantém stage_id
  // da conversa). Lifecycle NÃO rebaixa (cancelar = anular, não perder).
  if (conv.active_deal_id === dealId) {
    await supabaseAdmin.from("chat_conversations")
      .update({ active_deal_id: null, updated_at: now }).eq("id", conversationId).eq("tenant_id", tenantId)
  }

  await recordDealEvent({
    tenantId, dealId, type: "canceled",
    conversationId, fromStageId: d.stage_id, by: session.user.id, reason: reason ?? null,
  })
  return { ok: true }
}

/** Adiciona uma OBSERVAÇÃO (nota) ao negócio — vira evento `note` + cartão no chat. */
export async function addDealNote(conversationId: string, dealId: string, text: string): Promise<{ ok: true } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  const t = session.user.tenantId
  const note = text.trim()
  if (!note) return { error: "Escreva a observação." }

  const conv = await loadVisibleConversation(conversationId, t)
  if (!conv || !conv.contact_id) return { error: "Sem acesso a esta conversa" }
  const { data: deal } = await supabaseAdmin.from("tenant_deals").select("contact_id").eq("id", dealId).eq("tenant_id", t).maybeSingle()
  if (!deal || (deal as { contact_id: string }).contact_id !== conv.contact_id) return { error: "Negócio inválido para esta conversa" }

  await recordDealEvent({ tenantId: t, dealId, type: "note", conversationId, by: session.user.id, note })
  return { ok: true }
}

/**
 * REABRE um negócio fechado (perdido/cancelado/ganho) a partir da conversa. Volta pra
 * uma etapa de FUNIL (a atual se for de funil; senão a 1ª da trilha), reativa na conversa
 * + espelha (card volta ao board), limpa desfechos. Registra evento. Gated + visibilidade.
 */
export async function reopenDeal(conversationId: string, dealId: string): Promise<{ ok: true } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  const tenantId = session.user.tenantId

  const conv = await loadVisibleConversation(conversationId, tenantId)
  if (!conv || !conv.contact_id) return { error: "Sem acesso a esta conversa" }

  const { data: deal } = await supabaseAdmin.from("tenant_deals")
    .select("contact_id, stage_id, pipeline_id, status").eq("id", dealId).eq("tenant_id", tenantId).maybeSingle()
  const d = deal as { contact_id: string; stage_id: string | null; pipeline_id: string | null; status: string } | null
  if (!d || d.contact_id !== conv.contact_id) return { error: "Negócio inválido para esta conversa" }
  if (d.status === "open") return { error: "Negócio já está aberto" }
  // Trava "um aberto por vez": não reabre se o contato já tem outro negócio aberto.
  const blockingOpen = await openDealOf(tenantId, conv.contact_id, dealId)
  if (blockingOpen) return { error: `Não é possível reabrir: este contato já tem outro negócio aberto${blockingOpen.name ? ` (“${blockingOpen.name}”)` : ""}. Finalize-o antes.` }

  // Etapa de retorno: a atual se for de funil (show_in_kanban); senão a 1ª de funil da trilha.
  let targetStage = d.stage_id
  let targetPipeline = d.pipeline_id
  const { data: cur } = await supabaseAdmin.from("deal_pipeline_stages")
    .select("id, pipeline_id, is_won, is_lost, show_in_kanban")
    .eq("id", d.stage_id ?? "").eq("tenant_id", tenantId).maybeSingle()
  const c = cur as { pipeline_id: string; is_won: boolean; is_lost: boolean; show_in_kanban: boolean } | null
  if (!c || c.is_won || c.is_lost || !c.show_in_kanban) {
    const pid = c?.pipeline_id ?? d.pipeline_id
    const { data: first } = await supabaseAdmin.from("deal_pipeline_stages")
      .select("id, pipeline_id").eq("tenant_id", tenantId).eq("pipeline_id", pid ?? "")
      .eq("show_in_kanban", true).order("position").limit(1).maybeSingle()
    if (first) { targetStage = (first as { id: string }).id; targetPipeline = (first as { pipeline_id: string }).pipeline_id }
  }

  const now = new Date().toISOString()
  await supabaseAdmin.from("tenant_deals").update({
    status: "open", won_at: null, lost_at: null, lost_reason: null, canceled_at: null,
    pipeline_id: targetPipeline, stage_id: targetStage, stage_entered_at: now, updated_at: now,
  }).eq("id", dealId).eq("tenant_id", tenantId)

  // Reativa o negócio na conversa (ativo) — SEM espelhar etapa (funil de venda ≠ atendimento).
  await supabaseAdmin.from("chat_conversations")
    .update({ active_deal_id: dealId, updated_at: now })
    .eq("id", conversationId).eq("tenant_id", tenantId)

  await recordDealEvent({ tenantId, dealId, type: "reopened", conversationId, toStageId: targetStage, by: session.user.id })
  return { ok: true }
}
