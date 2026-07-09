"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { requireModule, hasModule } from "@/lib/modules"
import { getViewerScope, canViewConversation } from "@/lib/visibility"
import { createDeal, syncContactLifecycleFromDeal, recordDealEvent, openDealOf, type DealFieldChange, type DealEventExtras } from "@/lib/crm/deals"
import { computeDealValue } from "@/lib/crm/value"
import { resolveDealPricing } from "@/lib/crm/pricing"

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
  stages:     { id: string; name: string; color: string | null; position: number; is_won: boolean; is_lost: boolean; show_in_kanban: boolean; probability_pct?: number | null }[]
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

/**
 * Cria um negócio direto do BOARD (footer "Adicionar negócio" de uma coluna).
 * Diferente de `openDeal` (que parte de uma conversa), aqui o gestor escolhe o
 * CONTATO — a conversa mais recente dele (se houver) é vinculada pro botão de
 * WhatsApp funcionar. Gated: módulo crm + owner/admin (centro de gestão).
 */
export async function createDealFromBoard(input: {
  contactId: string; pipelineId: string; stageId: string; name?: string | null; estimatedValue?: number | null
  /** Tabela de preço explícita (T2). Undefined/null = herda do cliente. */
  priceTableId?: string | null
}): Promise<{ id: string } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  if (!["owner", "admin"].includes(session.user.role)) return { error: "Sem permissão" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  const t = session.user.tenantId

  // Ownership do contato + resolve conversa mais recente (não-arquivada) pra vincular.
  const { data: contact } = await supabaseAdmin.from("chat_contacts").select("id").eq("id", input.contactId).eq("tenant_id", t).maybeSingle()
  if (!contact) return { error: "Contato inválido" }
  const { data: conv } = await supabaseAdmin.from("chat_conversations")
    .select("id").eq("tenant_id", t).eq("contact_id", input.contactId).is("archived_at", null)
    .order("last_message_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle()

  return createDeal({
    tenantId: t, contactId: input.contactId, conversationId: (conv as { id: string } | null)?.id ?? null,
    pipelineId: input.pipelineId, stageId: input.stageId,
    name: input.name?.trim() || null, estimatedValue: input.estimatedValue ?? null, by: session.user.id,
    priceTableId: input.priceTableId ?? null,
  })
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
  /** Conversa mais recente do contato — pro botão "abrir no WhatsApp" do card. */
  conversation_id:  string | null
  /** Foto do contato (CDN); ContactPic cai pra inicial se 403/vazio. */
  contact_pic:      string | null
  /** Cliente chamou e ninguém leu → bolinha pulsando no card. */
  conversation_unread: boolean
  /** Tags do CONTATO (tags de negócio virão depois). */
  tags:             { id: string; name: string; color: string }[]
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
  /** Todas as tags do tenant — pro menu "adicionar tag" do card. */
  allTags:   { id: string; name: string; color: string }[]
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
      chat_contacts ( push_name, custom_name, profile_pic_url ),
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
    const c = r.chat_contacts as { push_name: string | null; custom_name: string | null; profile_pic_url: string | null } | null
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
      conversation_id:  null,
      contact_pic:      c?.profile_pic_url ?? null,
      conversation_unread: false,
      tags:             [],
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

  // Catálogo de tags do tenant (pro menu "adicionar" + join em memória — mesmo
  // padrão do inbox, que evita embed PostgREST via taggings).
  const { data: allTagRows } = await supabaseAdmin.from("tags").select("id, name, color").eq("tenant_id", t).order("name")
  const allTags = (allTagRows ?? []) as { id: string; name: string; color: string }[]
  const tagById = new Map(allTags.map((tg) => [tg.id, tg]))

  // Conversa (mais recente, não-arquivada) de cada contato → botão "abrir no
  // WhatsApp" + bolinha de não-lida (cliente chamou). E tags do contato.
  const contactIds = Array.from(new Set(deals.map((d) => d.contact_id).filter(Boolean))) as string[]
  if (contactIds.length) {
    const [{ data: convs }, { data: tgs }] = await Promise.all([
      supabaseAdmin.from("chat_conversations")
        .select("id, contact_id, last_message_at, unread_count").eq("tenant_id", t)
        .in("contact_id", contactIds).is("archived_at", null)
        .order("last_message_at", { ascending: false }),
      supabaseAdmin.from("taggings")
        .select("tag_id, taggable_id").eq("tenant_id", t).eq("taggable_type", "contact").in("taggable_id", contactIds),
    ])

    const convMap = new Map<string, { id: string; unread: boolean }>()
    for (const c of (convs ?? []) as { id: string; contact_id: string | null; unread_count: number | null }[])
      if (c.contact_id && !convMap.has(c.contact_id)) convMap.set(c.contact_id, { id: c.id, unread: (c.unread_count ?? 0) > 0 })

    const tagMap = new Map<string, { id: string; name: string; color: string }[]>()
    for (const row of (tgs ?? []) as { tag_id: string; taggable_id: string }[]) {
      const tg = tagById.get(row.tag_id)
      if (!tg) continue
      const arr = tagMap.get(row.taggable_id) ?? []
      arr.push(tg); tagMap.set(row.taggable_id, arr)
    }

    for (const d of deals) {
      const cv = d.contact_id ? convMap.get(d.contact_id) : undefined
      d.conversation_id = cv?.id ?? null
      d.conversation_unread = cv?.unread ?? false
      d.tags = d.contact_id ? (tagMap.get(d.contact_id) ?? []) : []
    }
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

  return { kpis, deals, pipelines, agents, allTags, period: { from, to } }
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
  contact: { id: string; name: string | null; push_name?: string | null; profile_pic_url?: string | null; phone_number?: string | null; lifecycle_stage?: string | null; source?: string | null; tags?: { name: string; color: string }[] } | null
  responsible: string | null
  responsible_id: string | null
  conversationId: string | null
  lastMessageAt: string | null
  /** Canal da conversa mais recente (rótulo da "última interação"). */
  lastChannel: string | null
  pipelines: DealPipeline[]
  events: DealEventView[]
  otherDeals: { id: string; name: string | null; status: string; estimated_value: number | null; won_at?: string | null; lost_at?: string | null }[]
  nextTask: { id: string; title: string; due_at: string | null } | null
  /** Composição de valor (tenant_deal_items). Vazio = valor manual (legado). */
  items: DealItemView[]
  /** Motivos de perda GOVERNADOS (catálogo do tenant; fallback = lista padrão). */
  lostReasons: { label: string; requireNote: boolean }[]
  /** Termos da proposta (N2). Null = não definidos / migration pendente. */
  paymentMethod: string | null
  installments: number | null
  proposalExpiresAt: string | null
  /** Tabela de preço do negócio (T2). Null = tabela padrão. */
  priceTable: { id: string; name: string } | null
  /** Tabelas disponíveis pro switcher (>1 = multi-tabela em uso; senão UI esconde). */
  priceTables: { id: string; name: string; is_default: boolean; active: boolean }[]
  /** Valores dos campos personalizados do negócio (tenant_custom_fields entity='deal'). */
  custom_fields: Record<string, string>
}

/** Fallback pré-catálogo — mesma lista que era hardcoded na página do negócio. */
const FALLBACK_LOST_REASONS = ["Preço", "Sem resposta", "Comprou concorrente", "Fora do perfil", "Sem orçamento", "Outro"]

/**
 * Motivos de perda GOVERNADOS pro fluxo unificado (board/sidebar/página) —
 * qualquer membro com CRM (vendedor também perde negócio). Fallback = padrão.
 */
export async function getLostReasons(): Promise<{ label: string; requireNote: boolean }[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  try { await requireModule("crm") } catch { return [] }
  const { data } = await supabaseAdmin.from("deal_outcome_reasons")
    .select("label, require_note").eq("tenant_id", session.user.tenantId).eq("kind", "lost").eq("active", true)
    .order("created_at", { ascending: false })
  return data?.length
    ? (data as { label: string; require_note: boolean }[]).map((r) => ({ label: r.label, requireNote: r.require_note }))
    : FALLBACK_LOST_REASONS.map((label) => ({ label, requireNote: false }))
}

/**
 * Política do motivo de perda (fail-closed no SERVER — UI é manipulável): se o
 * motivo está no catálogo com `require_note`, a justificativa é obrigatória.
 * Motivo fora do catálogo / tabela ausente (migration pendente) = sem política (legado).
 */
async function enforceLostReasonPolicy(tenantId: string, reason: string | null, note: string | null | undefined): Promise<string | null> {
  // Perder SEM motivo não passa (fail-closed) — senão o donut de motivos fica cego.
  // Todo caminho de UI (página, board, sidebar) coleta o motivo pela lista governada.
  if (!reason?.trim()) return "Escolha o motivo da perda antes de confirmar."
  const { data } = await supabaseAdmin.from("deal_outcome_reasons")
    .select("require_note").eq("tenant_id", tenantId).eq("kind", "lost").eq("active", true)
    .ilike("label", reason.trim()).maybeSingle()
  if (data && (data as { require_note: boolean }).require_note && !note?.trim()) {
    return "Este motivo exige justificativa — escreva o contexto antes de confirmar."
  }
  return null
}

/** Linha de item do negócio — SNAPSHOT (nome/preço/teto congelados na adição).
 *  `cost` NÃO sai por aqui (interno — margem de gestor é payload à parte). */
export interface DealItemView {
  id:          string
  name:        string
  type:        "product" | "service"
  billing:     "one_time" | "monthly" | "yearly"
  unit_price:  number
  quantity:    number
  discount:    number
  term_months: number | null
  category:    string | null
  /** Preço de TABELA no dia (piso do desconto). */
  list_price:  number | null
  /** Teto de desconto snapshotado (0–100). */
  max_discount_pct: number
  /** Rótulo da tabela que preçou a linha (snapshot T2). Null = padrão/pré-T2. */
  price_table_label?: string | null
  /** Custo snapshotado — SÓ presente pra owner/admin (margem); vendedor recebe undefined. */
  cost?: number | null
}

export async function getDeal(dealId: string): Promise<DealDetail | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  const t = session.user.tenantId

  // Select ÚNICO: termos (N2) e tabela (T2) fundidos — as queries "graciosas"
  // separadas eram transição pré-migration; migrations aplicadas = round-trips a menos.
  const { data: d } = await supabaseAdmin.from("tenant_deals").select(`
    id, name, status, estimated_value, expected_close_date, won_at, lost_at, lost_reason, canceled_at, stage_entered_at, created_at, created_by, contact_id, pipeline_id,
    payment_method, installments, proposal_expires_at, price_table_id, custom_fields,
    chat_contacts ( id, push_name, custom_name, profile_pic_url, phone_number, lifecycle_stage, source ),
    deal_pipelines ( name ),
    deal_pipeline_stages ( id, name, color, is_won, is_lost )
  `).eq("id", dealId).eq("tenant_id", t).maybeSingle()
  if (!d) return { error: "Negócio não encontrado" }
  const deal = d as Record<string, unknown>
  if (!(await canAccessDeal(t, deal.contact_id as string | null))) return { error: "Sem acesso a este negócio" }
  const contactId = deal.contact_id as string | null

  const [{ data: evs }, { data: convs }, { data: pipes }, { data: others }, { data: tasks }, { data: itemRows }, { data: ptAll }] = await Promise.all([
    supabaseAdmin.from("tenant_deal_events").select("id, type, at, by, from_stage, to_stage, meta").eq("tenant_id", t).eq("deal_id", dealId).order("at", { ascending: true }),
    // Conversa do CONTATO (não só a do negócio ativo): a que tem este negócio como ativo,
    // senão a mais recente — pra a página poder mover/anotar mesmo em negócio secundário.
    contactId
      ? supabaseAdmin.from("chat_conversations").select("id, active_deal_id, last_message_at, channel").eq("tenant_id", t).eq("contact_id", contactId).order("last_message_at", { ascending: false, nullsFirst: false }).limit(20)
      : Promise.resolve({ data: [] as unknown[] }),
    supabaseAdmin.from("deal_pipelines").select("id, name, is_default, deal_pipeline_stages ( id, name, color, position, is_won, is_lost, show_in_kanban, probability_pct )").eq("tenant_id", t).eq("active", true).order("position"),
    contactId
      ? supabaseAdmin.from("tenant_deals").select("id, name, status, estimated_value, won_at, lost_at").eq("tenant_id", t).eq("contact_id", contactId).neq("id", dealId).order("created_at", { ascending: false }).limit(20)
      : Promise.resolve({ data: [] as unknown[] }),
    supabaseAdmin.from("tenant_tasks").select("id, title, due_at").eq("tenant_id", t).eq("deal_id", dealId).eq("status", "pending").order("due_at", { ascending: true, nullsFirst: false }).limit(1),
    supabaseAdmin.from("tenant_deal_items").select("id, name, type, billing, unit_price, quantity, discount, term_months, category, list_price, max_discount_pct, cost, price_table_label").eq("tenant_id", t).eq("deal_id", dealId).order("position", { ascending: true }).order("created_at", { ascending: true }),
    // Tabelas do tenant (T2) pro switcher.
    supabaseAdmin.from("price_tables").select("id, name, is_default, active").eq("tenant_id", t).order("is_default", { ascending: false }).order("name"),
  ])
  const termsD = deal as { payment_method?: string | null; installments?: number | null; proposal_expires_at?: string | null }
  const priceTables = ((ptAll ?? []) as { id: string; name: string; is_default: boolean; active: boolean }[])
  const dealTableId = (deal.price_table_id as string | null) ?? null
  const priceTable = dealTableId ? (priceTables.find((p) => p.id === dealTableId) ?? null) : null
  const isManager = ["owner", "admin"].includes(session.user.role)
  // Motivos de perda governados (fallback = lista padrão; gracioso sem migration).
  const { data: reasonRows } = await supabaseAdmin.from("deal_outcome_reasons")
    .select("label, require_note").eq("tenant_id", t).eq("kind", "lost").eq("active", true)
    .order("created_at", { ascending: false })
  const lostReasons = (reasonRows?.length ? (reasonRows as { label: string; require_note: boolean }[]).map((r) => ({ label: r.label, requireNote: r.require_note })) : FALLBACK_LOST_REASONS.map((label) => ({ label, requireNote: false })))

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

  const c = deal.chat_contacts as { id: string; push_name: string | null; custom_name: string | null; profile_pic_url: string | null; phone_number: string | null; lifecycle_stage: string | null; source: string | null } | null

  // Tags do contato (chips no header — referência).
  let contactTags: { name: string; color: string }[] = []
  if (contactId) {
    const { data: tgs } = await supabaseAdmin.from("taggings").select("tag_id").eq("tenant_id", t).eq("taggable_type", "contact").eq("taggable_id", contactId)
    const ids = ((tgs ?? []) as { tag_id: string }[]).map((x) => x.tag_id)
    if (ids.length) {
      const { data: tagRows } = await supabaseAdmin.from("tags").select("name, color").eq("tenant_id", t).in("id", ids).order("name").limit(4)
      contactTags = ((tagRows ?? []) as { name: string; color: string }[])
    }
  }
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
    contact: c ? { id: c.id, name: c.custom_name?.trim() || c.push_name?.trim() || null, push_name: c.push_name, profile_pic_url: c.profile_pic_url, phone_number: c.phone_number, lifecycle_stage: c.lifecycle_stage, source: c.source, tags: contactTags } : null,
    responsible: deal.created_by ? (pMap.get(deal.created_by as string) ?? null) : null,
    responsible_id: (deal.created_by as string | null) ?? null,
    conversationId: (() => {
      const rows = (convs ?? []) as { id: string; active_deal_id: string | null }[]
      return rows.find((r) => r.active_deal_id === dealId)?.id ?? rows[0]?.id ?? null
    })(),
    lastMessageAt: (() => {
      const rows = (convs ?? []) as { last_message_at: string | null }[]
      return rows.map((r) => r.last_message_at).filter(Boolean).sort().reverse()[0] ?? null
    })(),
    lastChannel: (() => {
      const rows = ((convs ?? []) as { last_message_at: string | null; channel: string | null }[])
        .filter((r) => r.last_message_at).sort((a, b) => (a.last_message_at! < b.last_message_at! ? 1 : -1))
      return rows[0]?.channel ?? null
    })(),
    pipelines, events,
    otherDeals: ((others ?? []) as Record<string, unknown>[]).map((o) => ({ id: o.id as string, name: (o.name as string | null) ?? null, status: o.status as string, estimated_value: (o.estimated_value as number | null) ?? null, won_at: (o.won_at as string | null) ?? null, lost_at: (o.lost_at as string | null) ?? null })),
    nextTask: (tasks && (tasks as unknown[])[0]) ? (() => { const tk = (tasks as Record<string, unknown>[])[0]; return { id: tk.id as string, title: tk.title as string, due_at: (tk.due_at as string | null) ?? null } })() : null,
    items: ((itemRows ?? []) as Record<string, unknown>[]).map((i) => ({
      id: i.id as string, name: i.name as string,
      type: i.type as DealItemView["type"], billing: i.billing as DealItemView["billing"],
      unit_price: Number(i.unit_price ?? 0), quantity: Number(i.quantity ?? 1),
      discount: Number(i.discount ?? 0), term_months: (i.term_months as number | null) ?? null,
      category: (i.category as string | null) ?? null,
      list_price: i.list_price != null ? Number(i.list_price) : null,
      max_discount_pct: Number(i.max_discount_pct ?? 0),
      price_table_label: (i.price_table_label as string | null) ?? null,
      // Custo é INTERNO: só gestor recebe (margem). Vendedor: campo ausente.
      ...(isManager ? { cost: i.cost != null ? Number(i.cost) : null } : {}),
    })),
    lostReasons,
    paymentMethod: termsD.payment_method ?? null,
    installments: termsD.installments ?? null,
    proposalExpiresAt: termsD.proposal_expires_at ?? null,
    priceTable: priceTable ? { id: priceTable.id, name: priceTable.name } : null,
    priceTables,
    custom_fields: (deal.custom_fields as Record<string, string> | null) ?? {},
  }
}

/** Formas de pagamento fixas do v1 (configurável por tenant = futuro, nas Políticas). */
const PAYMENT_METHODS = ["Pix", "Cartão de crédito", "Cartão de débito", "Boleto", "Dinheiro", "Transferência", "Outro"]

/** Edita nome, valor, previsão e/ou termos da proposta. Gated + visibilidade herdada. */
export async function updateDeal(dealId: string, fields: { name?: string; estimatedValue?: number | null; expectedClose?: string | null; paymentMethod?: string | null; installments?: number | null; proposalExpiresAt?: string | null; priceTableId?: string | null }, opts?: { silentCard?: boolean }): Promise<{ ok: true } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  const t = session.user.tenantId
  const { data: deal } = await supabaseAdmin.from("tenant_deals")
    .select("contact_id, name, estimated_value, expected_close_date, payment_method, installments, proposal_expires_at, price_table_id")
    .eq("id", dealId).eq("tenant_id", t).maybeSingle()
  if (!deal) return { error: "Negócio não encontrado" }
  const d = deal as { contact_id: string | null; name: string | null; estimated_value: number | null; expected_close_date: string | null; price_table_id: string | null }
  if (!(await canAccessDeal(t, d.contact_id))) return { error: "Sem acesso" }
  const dt = deal as { payment_method?: string | null; installments?: number | null; proposal_expires_at?: string | null }

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
  if (fields.expectedClose !== undefined) {
    const next = fields.expectedClose || null
    if (next !== (d.expected_close_date ?? null)) {
      patch.expected_close_date = next
      const fmtD = (v: string | null) => v ? new Date(v + "T12:00:00").toLocaleDateString("pt-BR") : "—"
      changes.push({ label: "Previsão", from: fmtD(d.expected_close_date), to: fmtD(next) })
    }
  }
  if (fields.paymentMethod !== undefined) {
    const next = fields.paymentMethod || null
    if (next != null && !PAYMENT_METHODS.includes(next)) return { error: "Forma de pagamento inválida" }
    if (next !== (dt.payment_method ?? null)) {
      patch.payment_method = next
      changes.push({ label: "Pagamento", from: dt.payment_method ?? "—", to: next ?? "—" })
    }
  }
  if (fields.installments !== undefined) {
    const next = fields.installments ?? null
    if (next != null && (!Number.isInteger(next) || next < 1 || next > 60)) return { error: "Parcelamento inválido (1 a 60)" }
    if (next !== (dt.installments ?? null)) {
      patch.installments = next
      changes.push({ label: "Parcelas", from: dt.installments != null ? `${dt.installments}×` : "—", to: next != null ? `${next}×` : "—" })
    }
  }
  if (fields.proposalExpiresAt !== undefined) {
    // Validade é governança: só owner/admin altera (vendedor herda o default). Spec §5.
    if (!["owner", "admin"].includes(session.user.role)) return { error: "Só gestores alteram a validade da proposta" }
    const next = fields.proposalExpiresAt || null
    if (next !== (dt.proposal_expires_at ?? null)) {
      patch.proposal_expires_at = next
      const fmtD = (v: string | null) => v ? new Date(v + "T12:00:00").toLocaleDateString("pt-BR") : "—"
      changes.push({ label: "Validade da proposta", from: fmtD(dt.proposal_expires_at ?? null), to: fmtD(next) })
    }
  }
  if (fields.priceTableId !== undefined) {
    // Troca de tabela (T2): itens JÁ lançados não re-preçam (snapshot é lei);
    // só itens novos usam a tabela nova. Anti-IDOR: tabela tem que ser DO tenant.
    const cur = d.price_table_id ?? null
    const next = fields.priceTableId || null
    if (next !== cur) {
      const nameOf = async (id: string | null): Promise<string> => {
        if (!id) return "Padrão"
        const { data: tb } = await supabaseAdmin.from("price_tables").select("name").eq("id", id).eq("tenant_id", t).maybeSingle()
        return (tb as { name: string } | null)?.name ?? "?"
      }
      if (next) {
        // Anti-IDOR + só tabela ATIVA (desativada não recebe negócio).
        const { data: tb } = await supabaseAdmin.from("price_tables").select("id").eq("id", next).eq("tenant_id", t).eq("active", true).maybeSingle()
        if (!tb) return { error: "Tabela de preço inválida ou desativada" }
      }
      patch.price_table_id = next
      changes.push({ label: "Tabela de preço", from: await nameOf(cur), to: await nameOf(next) })
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

// ── Itens do negócio (composição de valor via catálogo) ─────────────────────
// Regra: com itens, `estimated_value` vira CACHE DERIVADO (recomputado a cada
// mutação) — board/painel/KPIs continuam lendo a mesma coluna sem mudança.
// Sem itens (removeu todos), o valor volta a NULL (edição manual reabre).

async function dealItemGate(dealId: string): Promise<{ t: string; userId: string; oldValue: number | null } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  const t = session.user.tenantId
  const { data: deal } = await supabaseAdmin.from("tenant_deals").select("contact_id, estimated_value").eq("id", dealId).eq("tenant_id", t).maybeSingle()
  if (!deal) return { error: "Negócio não encontrado" }
  const d = deal as { contact_id: string | null; estimated_value: number | null }
  if (!(await canAccessDeal(t, d.contact_id))) return { error: "Sem acesso" }
  return { t, userId: session.user.id, oldValue: d.estimated_value != null ? Number(d.estimated_value) : null }
}

/** Recalcula o valor a partir dos itens + audita no dossiê (sem cartão no chat). */
async function recomputeDealValueFromItems(t: string, dealId: string, by: string, note: string, oldValue: number | null): Promise<void> {
  const { data: rows } = await supabaseAdmin.from("tenant_deal_items")
    .select("billing, unit_price, quantity, discount, term_months").eq("tenant_id", t).eq("deal_id", dealId)
  const items = ((rows ?? []) as Record<string, unknown>[]).map((r) => ({
    billing: r.billing as "one_time" | "monthly" | "yearly",
    unit_price: Number(r.unit_price ?? 0), quantity: Number(r.quantity ?? 1),
    discount: Number(r.discount ?? 0), term_months: (r.term_months as number | null) ?? null,
  }))
  const total = items.length ? computeDealValue(items).total : null

  await supabaseAdmin.from("tenant_deals")
    .update({ estimated_value: total, updated_at: new Date().toISOString() })
    .eq("id", dealId).eq("tenant_id", t)

  const fmt = (v: number | null) => v != null ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) : "—"
  await recordDealEvent({
    tenantId: t, dealId, type: "field_changed", by, note,
    change: { label: "Valor", from: fmt(oldValue), to: fmt(total) }, postCard: false,
  })
}

/** Catálogo ativo pro picker de itens (qualquer membro com acesso ao negócio compõe valor).
 *  NUNCA envia `cost` — custo é informação interna (só gestor, no catálogo).
 *  T2: com `dealId`, os preços/tetos vêm da TABELA do negócio (Atacado…); sem
 *  linha na tabela, o item cai no preço da padrão (cache do catálogo). */
export interface CatalogPickerItem { id: string; name: string; sku: string | null; category: string | null; price: number; billing: "one_time" | "monthly" | "yearly"; type: "product" | "service"; max_discount_pct: number; image_path: string | null; table_label: string | null }
export async function getCatalogForPicker(dealId?: string): Promise<CatalogPickerItem[] | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  try { await requireModule("crm") } catch { return [] }
  const t = session.user.tenantId
  const { data } = await supabaseAdmin.from("catalog_items")
    .select("id, name, sku, category, price, billing, type, max_discount_pct, image_path")
    .eq("tenant_id", t).eq("active", true).order("name")

  // Tabela do negócio (query separada e graciosa — pré-migration cai na padrão).
  let overlay: Awaited<ReturnType<typeof resolveDealPricing>> = { usesDefault: true, table: null }
  if (dealId) {
    const { data: dRow } = await supabaseAdmin.from("tenant_deals").select("price_table_id").eq("id", dealId).eq("tenant_id", t).maybeSingle()
    overlay = await resolveDealPricing(t, (dRow as { price_table_id?: string | null } | null)?.price_table_id ?? null)
  }
  // Fail-closed: tabela do negócio sem grade → NÃO mostrar preço da padrão.
  if ("error" in overlay) return { error: overlay.error }
  const nonDefault = !overlay.usesDefault ? overlay : null

  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const row = nonDefault?.rows.get(r.id as string) ?? null
    return {
      id: r.id as string, name: r.name as string, sku: (r.sku as string | null) ?? null,
      category: (r.category as string | null) ?? null,
      price: row ? row.price : Number(r.price ?? 0),
      billing: r.billing as CatalogPickerItem["billing"], type: r.type as CatalogPickerItem["type"],
      max_discount_pct: row ? row.max_discount_pct : Number(r.max_discount_pct ?? 0),
      image_path: (r.image_path as string | null) ?? null,
      table_label: row ? nonDefault!.table.name : null,
    }
  })
}

/**
 * Piso da linha (anti-burla): unitário negociado × qtd − desconto NUNCA abaixo de
 * `list_price × qtd × (1 − teto)`. O teto/tabela são SNAPSHOTS do dia da adição.
 * Vale pra desconto E pra preço negociado (senão baixar o unitário burlaria o teto).
 */
function lineFloorError(listPrice: number, maxPct: number, unitPrice: number, qty: number, discount: number): string | null {
  const floor = listPrice * qty * (1 - maxPct / 100)
  const line  = unitPrice * qty - discount
  if (line >= floor - 0.01) return null
  return maxPct > 0
    ? `Desconto acima do permitido — este item aceita no máximo ${maxPct}% (valor mínimo da linha: ${floor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}).`
    : "Este item não aceita desconto (teto 0% no catálogo)."
}

export async function addDealItem(dealId: string, input: { catalogItemId: string; quantity: number; unitPrice?: number | null; discount?: number | null; termMonths?: number | null }): Promise<{ ok: true } | { error: string }> {
  const gate = await dealItemGate(dealId)
  if ("error" in gate) return gate
  const qty = Number(input.quantity)
  if (!Number.isFinite(qty) || qty <= 0) return { error: "Quantidade inválida" }
  const discount = input.discount != null ? Number(input.discount) : 0
  if (!Number.isFinite(discount) || discount < 0) return { error: "Desconto inválido" }
  const term = input.termMonths != null ? Math.floor(Number(input.termMonths)) : null
  if (term != null && term <= 0) return { error: "Prazo inválido" }
  // Preço NEGOCIADO (verticais de orçamento): o do catálogo é sugestão; a linha manda.
  const unitPrice = input.unitPrice != null ? Number(input.unitPrice) : null
  if (unitPrice != null && (!Number.isFinite(unitPrice) || unitPrice < 0)) return { error: "Preço inválido" }

  // Item do catálogo (do tenant, ativo) → SNAPSHOT congelado na linha.
  const { data: cat } = await supabaseAdmin.from("catalog_items")
    .select("id, name, type, billing, price, category, cost, max_discount_pct")
    .eq("id", input.catalogItemId).eq("tenant_id", gate.t).eq("active", true).maybeSingle()
  if (!cat) return { error: "Item do catálogo não encontrado" }
  const ci = cat as { id: string; name: string; type: string; billing: string; price: number; category: string | null; cost: number | null; max_discount_pct: number | null }

  // T2: precificação pela TABELA do negócio (query separada e graciosa; padrão =
  // cache do catálogo). Tabela sem grade → bloqueia (fail-closed).
  const { data: dRow } = await supabaseAdmin.from("tenant_deals").select("price_table_id").eq("id", dealId).eq("tenant_id", gate.t).maybeSingle()
  const pricing = await resolveDealPricing(gate.t, (dRow as { price_table_id?: string | null } | null)?.price_table_id ?? null)
  if ("error" in pricing) return { error: pricing.error }
  const tableRow = !pricing.usesDefault ? (pricing.rows.get(ci.id) ?? null) : null

  // Teto de desconto (snapshot do dia) — piso vale pro desconto E pro preço negociado.
  const listPrice = tableRow ? tableRow.price : Number(ci.price ?? 0)
  const maxPct    = tableRow ? tableRow.max_discount_pct : Number(ci.max_discount_pct ?? 0)
  const lineCost  = tableRow ? tableRow.cost : ci.cost
  const floorErr  = lineFloorError(listPrice, maxPct, unitPrice ?? listPrice, qty, discount)
  if (floorErr) return { error: floorErr }

  const { count } = await supabaseAdmin.from("tenant_deal_items")
    .select("id", { count: "exact", head: true }).eq("tenant_id", gate.t).eq("deal_id", dealId)
  const { data: inserted, error } = await supabaseAdmin.from("tenant_deal_items").insert({
    tenant_id: gate.t, deal_id: dealId, catalog_item_id: ci.id,
    name: ci.name, type: ci.type, billing: ci.billing,
    unit_price: unitPrice ?? listPrice, quantity: qty, discount,
    term_months: ci.billing === "one_time" ? null : term,
    list_price: listPrice, category: ci.category, cost: lineCost,
    max_discount_pct: maxPct,
    position: count ?? 0,
  }).select("id").single()
  if (error) return { error: error.message }

  // Proveniência (T2): versão exata + rótulo da tabela — best-effort (pré-migration só loga).
  if (tableRow && !pricing.usesDefault && inserted) {
    const { error: provErr } = await supabaseAdmin.from("tenant_deal_items")
      .update({ price_list_id: pricing.version.id, price_table_label: pricing.table.name })
      .eq("id", (inserted as { id: string }).id).eq("tenant_id", gate.t)
    if (provErr) console.error("[deals.addDealItem] proveniência (migration pendente?):", provErr.message)
  }

  await recomputeDealValueFromItems(gate.t, dealId, gate.userId, `Item adicionado: ${qty !== 1 ? `${qty}× ` : ""}${ci.name}`, gate.oldValue)
  return { ok: true }
}

export async function updateDealItem(dealId: string, itemId: string, input: { quantity: number; unitPrice?: number | null; discount?: number | null; termMonths?: number | null }): Promise<{ ok: true } | { error: string }> {
  const gate = await dealItemGate(dealId)
  if ("error" in gate) return gate
  const qty = Number(input.quantity)
  if (!Number.isFinite(qty) || qty <= 0) return { error: "Quantidade inválida" }
  const discount = input.discount != null ? Number(input.discount) : 0
  if (!Number.isFinite(discount) || discount < 0) return { error: "Desconto inválido" }
  const term = input.termMonths != null ? Math.floor(Number(input.termMonths)) : null
  if (term != null && term <= 0) return { error: "Prazo inválido" }
  const unitPrice = input.unitPrice != null ? Number(input.unitPrice) : null
  if (unitPrice != null && (!Number.isFinite(unitPrice) || unitPrice < 0)) return { error: "Preço inválido" }

  const { data: it } = await supabaseAdmin.from("tenant_deal_items")
    .select("id, name, billing, unit_price, list_price, max_discount_pct").eq("id", itemId).eq("tenant_id", gate.t).eq("deal_id", dealId).maybeSingle()
  if (!it) return { error: "Item não encontrado" }
  const item = it as { id: string; name: string; billing: string; unit_price: number; list_price: number | null; max_discount_pct: number | null }

  // Piso pelo SNAPSHOT da linha (teto e tabela do dia em que o item entrou).
  const listPrice = Number(item.list_price ?? item.unit_price ?? 0)
  const maxPct    = Number(item.max_discount_pct ?? 0)
  const effUnit   = unitPrice != null ? unitPrice : Number(item.unit_price ?? 0)
  const floorErr  = lineFloorError(listPrice, maxPct, effUnit, qty, discount)
  if (floorErr) return { error: floorErr }

  const patch: Record<string, unknown> = { quantity: qty, discount, term_months: item.billing === "one_time" ? null : term }
  if (unitPrice != null) patch.unit_price = unitPrice
  const { error } = await supabaseAdmin.from("tenant_deal_items")
    .update(patch)
    .eq("id", itemId).eq("tenant_id", gate.t)
  if (error) return { error: error.message }

  await recomputeDealValueFromItems(gate.t, dealId, gate.userId, `Item ajustado: ${qty !== 1 ? `${qty}× ` : ""}${item.name}`, gate.oldValue)
  return { ok: true }
}

export async function removeDealItem(dealId: string, itemId: string): Promise<{ ok: true } | { error: string }> {
  const gate = await dealItemGate(dealId)
  if ("error" in gate) return gate
  const { data: it } = await supabaseAdmin.from("tenant_deal_items")
    .select("name").eq("id", itemId).eq("tenant_id", gate.t).eq("deal_id", dealId).maybeSingle()
  if (!it) return { error: "Item não encontrado" }

  const { error } = await supabaseAdmin.from("tenant_deal_items")
    .delete().eq("id", itemId).eq("tenant_id", gate.t)
  if (error) return { error: error.message }

  await recomputeDealValueFromItems(gate.t, dealId, gate.userId, `Item removido: ${(it as { name: string }).name}`, gate.oldValue)
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

  // Perda: política do motivo (justificativa obrigatória — fail-closed no server).
  if (st.is_lost) {
    const policyErr = await enforceLostReasonPolicy(t, reason, opts?.note)
    if (policyErr) return { error: policyErr }
  }

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
  /** Tabela de preço do cliente (T2 — negócios herdam). Null = padrão. */
  price_table_id: string | null
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
  /** Autor do evento (rodapé do cartão — referência): nome humano ou "Automação"/"IA". */
  by?:     string | null
  byKind?: "human" | "automation" | "ia" | null
  /** Mudança de campo (texto rico: "de X para Y" em destaque). */
  change?: { label: string; from: string | null; to: string | null } | null
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
      .select("id, deal_id, type, at, by, to_stage, meta").eq("tenant_id", t).in("deal_id", Array.from(dealMap.keys()))
      .order("at", { ascending: false }).limit(120)
    const evRows = (evs ?? []) as Record<string, unknown>[]
    const stageIds = Array.from(new Set(evRows.map((e) => e.to_stage).filter(Boolean))) as string[]
    const byIds    = Array.from(new Set(evRows.map((e) => e.by).filter(Boolean))) as string[]
    const [sRes, pRes] = await Promise.all([
      stageIds.length ? supabaseAdmin.from("deal_pipeline_stages").select("id, name").in("id", stageIds) : Promise.resolve({ data: [] as unknown[] }),
      byIds.length    ? supabaseAdmin.from("profiles").select("id, full_name").in("id", byIds)          : Promise.resolve({ data: [] as unknown[] }),
    ])
    const sMap = new Map(((sRes.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]))
    const pMap = new Map(((pRes.data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? "—"]))

    for (const e of evRows) {
      const dealName = dealMap.get(e.deal_id as string) || "Negócio"
      const to = e.to_stage ? sMap.get(e.to_stage as string) : null
      const type = e.type as string
      // task_* já entram pelo bloco de tarefas — evita duplicar na timeline.
      if (type === "task_created" || type === "task_done") continue

      const meta   = (e.meta ?? {}) as { note?: string | null; reason?: string | null; actor?: { kind?: string; label?: string | null } | null; change?: { label: string; from: string | null; to: string | null } | null }
      const actor  = meta.actor ?? null
      const byKind = (actor?.kind === "automation" || actor?.kind === "ia") ? (actor.kind as "automation" | "ia") : e.by ? "human" : null
      const by     = actor?.label ?? (e.by ? (pMap.get(e.by as string) ?? null) : null)

      let title = ""
      let sub: string | null = null
      let change: ActivityItem["change"] = null
      if (type === "created")        title = `Negócio aberto: ${dealName}`
      else if (type === "won")       title = `Negócio ganho: ${dealName}`
      else if (type === "lost")    { title = `Negócio perdido: ${dealName}`; sub = meta.reason ?? null }
      else if (type === "canceled"){ title = `Negócio cancelado: ${dealName}`; sub = meta.reason ?? null }
      else if (type === "reopened")  title = `Negócio reaberto: ${dealName}`
      else if (type === "note")    { title = `Observação em ${dealName}`; sub = meta.note ? (meta.note.length > 90 ? meta.note.slice(0, 90) + "…" : meta.note) : null }
      else if (type === "field_changed" && meta.change) { title = `${meta.change.label} do negócio alterado`; sub = meta.note ?? null; change = meta.change }
      else if (type === "field_changed") title = `Negócio atualizado: ${dealName}`
      else title = `${dealName} movido${to ? ` → ${to}` : ""}`

      items.push({ id: `deal-${e.id}`, kind: type === "won" ? "deal_won" : type === "lost" ? "deal_lost" : "deal", at: e.at as string, title, sub, by, byKind, change })
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
    .select("id, push_name, custom_name, phone_number, email, company, doc_id, birth_date, profile_pic_url, source, lifecycle_stage, qualified_at, notes, is_blocked, created_at, bsuid, username, wp_username, ig_username, phone_secondary, phone_secondary_label, address_cep, address_street, address_number, address_complement, address_district, address_city, address_state, address_country, consent_opt_in, consent_at, consent_source, marketing_opt_in, custom_fields, price_table_id")
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

  // Perda: política do motivo (justificativa obrigatória — fail-closed no server).
  if (st.is_lost) {
    const policyErr = await enforceLostReasonPolicy(tenantId, reason ?? null, note)
    if (policyErr) return { error: policyErr }
  }

  await supabaseAdmin.from("tenant_deals").update({
    pipeline_id: st.pipeline_id, stage_id: st.id, status,
    won_at: st.is_won ? now : null, lost_at: st.is_lost ? now : null,
    // Snapshot do motivo na COLUNA (alimenta o donut de vazamento do painel) — antes
    // só ia pro evento e a coluna ficava órfã neste caminho.
    lost_reason: st.is_lost ? (reason?.trim() || null) : null,
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
 *
 * REGRAS (fail-closed — decisão owner 2026-07-04):
 *  • GANHO só gestor reabre, e com justificativa OBRIGATÓRIA — desfaz receita já
 *    reportada (painel/KPIs mudam); vendedor não desfaz venda.
 *  • Perdido/cancelado: qualquer um com acesso reabre (recuperar é desejável); nota opcional.
 *  • O evento guarda o DESFECHO ANTERIOR ("Estava Perdido · Preço") — a trilha não se perde
 *    mesmo com as colunas limpas.
 *  • Trava "um aberto por vez" continua valendo.
 */
export async function reopenDeal(conversationId: string, dealId: string, opts?: { note?: string | null }): Promise<{ ok: true } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  const tenantId = session.user.tenantId

  const conv = await loadVisibleConversation(conversationId, tenantId)
  if (!conv || !conv.contact_id) return { error: "Sem acesso a esta conversa" }

  const { data: deal } = await supabaseAdmin.from("tenant_deals")
    .select("contact_id, stage_id, pipeline_id, status, won_at, lost_at, lost_reason, canceled_at").eq("id", dealId).eq("tenant_id", tenantId).maybeSingle()
  const d = deal as { contact_id: string; stage_id: string | null; pipeline_id: string | null; status: string; won_at: string | null; lost_at: string | null; lost_reason: string | null; canceled_at: string | null } | null
  if (!d || d.contact_id !== conv.contact_id) return { error: "Negócio inválido para esta conversa" }
  if (d.status === "open") return { error: "Negócio já está aberto" }

  const note = opts?.note?.trim() || null
  if (d.status === "won") {
    if (!["owner", "admin"].includes(session.user.role)) return { error: "Reabrir um negócio GANHO desfaz receita já reportada — só gestores podem." }
    if (!note) return { error: "Explique por que está desfazendo o ganho (justificativa obrigatória)." }
  }
  // Desfecho anterior vira parte do evento (a trilha sobrevive à limpeza das colunas).
  const fmtBr = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("pt-BR") : null
  const previousOutcome = d.status === "won"
    ? `Estava Ganho${fmtBr(d.won_at) ? ` desde ${fmtBr(d.won_at)}` : ""}`
    : d.status === "lost"
      ? `Estava Perdido${d.lost_reason ? ` · ${d.lost_reason}` : ""}${fmtBr(d.lost_at) ? ` desde ${fmtBr(d.lost_at)}` : ""}`
      : `Estava Cancelado${fmtBr(d.canceled_at) ? ` desde ${fmtBr(d.canceled_at)}` : ""}`

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

  await recordDealEvent({ tenantId, dealId, type: "reopened", conversationId, toStageId: targetStage, by: session.user.id, reason: previousOutcome, note })
  return { ok: true }
}
