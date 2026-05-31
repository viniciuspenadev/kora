"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { SOURCE_META } from "@/lib/lifecycle"

/**
 * Dashboards do menu Relatórios. Todas as queries são leituras agregadas
 * (server-side) com filtro explícito por tenant_id.
 *
 * Convenção de período: [from, to) — `from` inclusivo, `to` exclusivo.
 * Comparativo: período espelhado anterior (mesma duração imediatamente antes).
 *
 * Filtros opcionais (agentId, channel) afetam todas as métricas relevantes
 * de cada relatório. Filtros são pre-resolvidos em listas de IDs no início
 * da request e reusados pelos helpers (evita JOINs caros via PostgREST).
 */

export interface ReportFilters {
  from:      string
  to:        string
  agentId?:  string | null
  channel?:  string | null  // source em chat_contacts
}

export type DailyPoint = { date: string; conversas: number; contatos: number }
export type ChannelSlice = { source: string; count: number }
export type AgentLoad   = { agent_id: string; name: string; assigned: number; messages: number }

export interface DeltaNumber {
  current:  number
  previous: number
}

export interface OverviewMetrics {
  range: { from: string; to: string }
  conversations:       DeltaNumber
  totalMessages:       DeltaNumber
  newContacts:         DeltaNumber
  resolutionRatePct:   DeltaNumber
  avgFirstResponseSec: DeltaNumber
  pipelineValueCents:  DeltaNumber
  resolvedCount:       DeltaNumber
  daily:               DailyPoint[]
  channels:            ChannelSlice[]
}

export interface AtendimentoMetrics {
  range: { from: string; to: string }
  avgFirstResponseSec: DeltaNumber
  avgResolutionSec:    DeltaNumber
  withinSLA5min:       DeltaNumber
  resolvedCount:       DeltaNumber
  firstResponseDaily:  { date: string; avgSec: number }[]
  resolutionDaily:     { date: string; avgSec: number }[]
  heatmap:             { dow: number; hour: number; count: number }[]
  agentLoad:           AgentLoad[]
}

// ─── Funil ──────────────────────────────────────────────────
export interface FunilMetrics {
  range: { from: string; to: string }
  pipelineId: string | null     // pipeline efetivamente usado (após fallbacks)
  stages: {
    id:          string
    name:        string
    color:       string
    position:    number
    is_won:      boolean
    is_lost:     boolean
    is_triage:   boolean
    count:       number
    valueCents:  number
  }[]
  conversionRatePct: DeltaNumber  // % de convs que chegaram a is_won
  wonValueCents:     DeltaNumber
  avgWinDays:        DeltaNumber  // tempo médio até is_won (dias)
  topLostReasons:    { reason: string; count: number }[]
}

// ─── Origem ─────────────────────────────────────────────────
export interface OrigemMetrics {
  range: { from: string; to: string }
  // Tabela por canal
  byChannel: {
    source:           string
    label:            string
    color:            string
    contacts:         number
    conversations:    number
    avgEstimateCents: number
    conversionPct:    number  // % com lifecycle != 'contact'
  }[]
  // CTWA (Click-to-WhatsApp Ads)
  ctwaCount:    DeltaNumber
  ctwaContacts: number  // # de contatos com first_ad_reply
  topCampaigns: { headline: string; count: number }[]
  // Stacked area de contatos por canal por dia
  dailyByChannel: { date: string; [source: string]: number | string }[]
}

// ─── Utilitários ────────────────────────────────────────────

interface RangeOpts { from: Date; to: Date }
interface HelperFilters {
  contactIds?:      string[] | null
  conversationIds?: string[] | null
  agentId?:         string | null
}

function shiftRange(range: RangeOpts): RangeOpts {
  const diff = range.to.getTime() - range.from.getTime()
  return { from: new Date(range.from.getTime() - diff), to: range.from }
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 10) }

async function tenantId(): Promise<string> {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  return session.user.tenantId
}

/**
 * Pre-resolve filtros (channel → contactIds; agent+channel → conversationIds).
 * Retorna nulls quando o filtro não está aplicado.
 */
async function resolveFilters(t: string, f: ReportFilters): Promise<HelperFilters> {
  let contactIds: string[] | null = null
  if (f.channel) {
    const { data } = await supabaseAdmin
      .from("chat_contacts")
      .select("id").eq("tenant_id", t).eq("source", f.channel)
    contactIds = (data ?? []).map((r) => (r as { id: string }).id)
  }

  let conversationIds: string[] | null = null
  if (f.agentId || contactIds !== null) {
    let q = supabaseAdmin.from("chat_conversations").select("id").eq("tenant_id", t)
    if (f.agentId)             q = q.eq("assigned_to", f.agentId)
    if (contactIds !== null)   q = q.in("contact_id", contactIds)
    const { data } = await q
    conversationIds = (data ?? []).map((r) => (r as { id: string }).id)
  }

  return { contactIds, conversationIds, agentId: f.agentId ?? null }
}

// ─── Sub-queries ────────────────────────────────────────────

async function countConversations(t: string, r: RangeOpts, f: HelperFilters): Promise<number> {
  let q = supabaseAdmin.from("chat_conversations")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", t)
    .gte("created_at", r.from.toISOString()).lt("created_at", r.to.toISOString())
  if (f.agentId)              q = q.eq("assigned_to", f.agentId)
  if (f.contactIds !== null && f.contactIds !== undefined) q = q.in("contact_id", f.contactIds)
  const { count } = await q
  return count ?? 0
}

// "Conversas" (volume): conversas com ATIVIDADE no período (última msg no range).
// Diferente de countConversations (que conta criadas) — como a conversa reabre
// quando o cliente volta, este conta o retorno; aquele só a 1ª vez.
async function countActiveConversations(t: string, r: RangeOpts, f: HelperFilters): Promise<number> {
  let q = supabaseAdmin.from("chat_conversations")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", t)
    .gte("last_message_at", r.from.toISOString()).lt("last_message_at", r.to.toISOString())
  if (f.agentId)              q = q.eq("assigned_to", f.agentId)
  if (f.contactIds !== null && f.contactIds !== undefined) q = q.in("contact_id", f.contactIds)
  const { count } = await q
  return count ?? 0
}

async function countResolvedConversations(t: string, r: RangeOpts, f: HelperFilters): Promise<number> {
  let q = supabaseAdmin.from("chat_conversations")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", t).eq("status", "resolved")
    .gte("resolved_at", r.from.toISOString()).lt("resolved_at", r.to.toISOString())
  if (f.agentId)              q = q.eq("assigned_to", f.agentId)
  if (f.contactIds !== null && f.contactIds !== undefined) q = q.in("contact_id", f.contactIds)
  const { count } = await q
  return count ?? 0
}

async function countMessages(t: string, r: RangeOpts, f: HelperFilters): Promise<number> {
  let q = supabaseAdmin.from("chat_messages")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", t).eq("is_private_note", false)
    .gte("created_at", r.from.toISOString()).lt("created_at", r.to.toISOString())
  if (f.conversationIds !== null && f.conversationIds !== undefined) q = q.in("conversation_id", f.conversationIds)
  if (f.agentId)              q = q.eq("sender_id", f.agentId)
  const { count } = await q
  return count ?? 0
}

async function countContacts(t: string, r: RangeOpts, f: HelperFilters): Promise<number> {
  // Agent filter não se aplica (atendente não cria contato).
  let q = supabaseAdmin.from("chat_contacts")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", t)
    .gte("created_at", r.from.toISOString()).lt("created_at", r.to.toISOString())
  if (f.contactIds !== null && f.contactIds !== undefined) q = q.in("id", f.contactIds)
  const { count } = await q
  return count ?? 0
}

async function pipelineValueCents(t: string, f: HelperFilters): Promise<number> {
  let q = supabaseAdmin.from("chat_conversations")
    .select("estimated_value").eq("tenant_id", t).neq("status", "resolved")
  if (f.agentId)              q = q.eq("assigned_to", f.agentId)
  if (f.contactIds !== null && f.contactIds !== undefined) q = q.in("contact_id", f.contactIds)
  const { data } = await q
  const sum = (data ?? []).reduce((acc, row) => acc + Number((row as { estimated_value: number | null }).estimated_value ?? 0), 0)
  return Math.round(sum * 100)
}

async function avgFirstResponseSec(t: string, r: RangeOpts, f: HelperFilters): Promise<number> {
  let q = supabaseAdmin.from("chat_conversations").select("id")
    .eq("tenant_id", t)
    .gte("created_at", r.from.toISOString()).lt("created_at", r.to.toISOString())
  if (f.agentId)              q = q.eq("assigned_to", f.agentId)
  if (f.contactIds !== null && f.contactIds !== undefined) q = q.in("contact_id", f.contactIds)
  const { data: convs } = await q
  const convIds = (convs ?? []).map((c) => (c as { id: string }).id)
  if (convIds.length === 0) return 0

  const { data: msgs } = await supabaseAdmin
    .from("chat_messages")
    .select("conversation_id, sender_type, created_at")
    .in("conversation_id", convIds).eq("tenant_id", t).eq("is_private_note", false)
    .in("sender_type", ["contact", "agent"])

  type Row = { conversation_id: string; sender_type: string; created_at: string }
  const byConv = new Map<string, { firstContact?: number; firstAgent?: number }>()
  for (const m of (msgs ?? []) as Row[]) {
    const ts = new Date(m.created_at).getTime()
    const e = byConv.get(m.conversation_id) ?? {}
    if (m.sender_type === "contact") { if (e.firstContact === undefined || ts < e.firstContact) e.firstContact = ts }
    else if (m.sender_type === "agent") { if (e.firstAgent === undefined || ts < e.firstAgent) e.firstAgent = ts }
    byConv.set(m.conversation_id, e)
  }

  const diffs: number[] = []
  for (const e of byConv.values()) {
    if (e.firstContact === undefined || e.firstAgent === undefined) continue
    if (e.firstAgent < e.firstContact) continue
    diffs.push((e.firstAgent - e.firstContact) / 1000)
  }
  if (diffs.length === 0) return 0
  return Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length)
}

async function dailySeries(t: string, r: RangeOpts, f: HelperFilters): Promise<DailyPoint[]> {
  // "conversas" do gráfico = ativas por dia (bucket por last_message_at) → soma bate com o card.
  let qConv = supabaseAdmin.from("chat_conversations")
    .select("last_message_at").eq("tenant_id", t)
    .gte("last_message_at", r.from.toISOString()).lt("last_message_at", r.to.toISOString())
  if (f.agentId)              qConv = qConv.eq("assigned_to", f.agentId)
  if (f.contactIds !== null && f.contactIds !== undefined) qConv = qConv.in("contact_id", f.contactIds)

  // "contatos" do gráfico = contatos novos por dia (created_at). Sem filtro de
  // atendente (atendente não cria contato); canal entra via contactIds.
  let qContacts = supabaseAdmin.from("chat_contacts")
    .select("created_at").eq("tenant_id", t)
    .gte("created_at", r.from.toISOString()).lt("created_at", r.to.toISOString())
  if (f.contactIds !== null && f.contactIds !== undefined) qContacts = qContacts.in("id", f.contactIds)

  const [{ data: convsActive }, { data: contactsCreated }] = await Promise.all([qConv, qContacts])

  const buckets = new Map<string, DailyPoint>()
  const cur = new Date(r.from)
  while (cur < r.to) {
    const k = isoDate(cur)
    buckets.set(k, { date: k, conversas: 0, contatos: 0 })
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  for (const row of (convsActive ?? []) as { last_message_at: string | null }[]) { if (!row.last_message_at) continue; const b = buckets.get(isoDate(new Date(row.last_message_at))); if (b) b.conversas++ }
  for (const row of (contactsCreated ?? []) as { created_at: string }[]) { const b = buckets.get(isoDate(new Date(row.created_at))); if (b) b.contatos++ }
  return Array.from(buckets.values())
}

async function channelDistribution(t: string, r: RangeOpts, f: HelperFilters): Promise<ChannelSlice[]> {
  let q = supabaseAdmin.from("chat_contacts")
    .select("source").eq("tenant_id", t)
    .gte("created_at", r.from.toISOString()).lt("created_at", r.to.toISOString())
  if (f.contactIds !== null && f.contactIds !== undefined) q = q.in("id", f.contactIds)
  const { data } = await q
  const counts = new Map<string, number>()
  for (const row of (data ?? []) as { source: string }[]) {
    counts.set(row.source ?? "unknown", (counts.get(row.source ?? "unknown") ?? 0) + 1)
  }
  return Array.from(counts.entries()).map(([source, count]) => ({ source, count }))
}

// ── Public actions ──────────────────────────────────────────

export async function getOverviewMetrics(filters: ReportFilters): Promise<OverviewMetrics> {
  const t = await tenantId()
  const range: RangeOpts = { from: new Date(filters.from), to: new Date(filters.to) }
  const prev: RangeOpts  = shiftRange(range)
  const hf = await resolveFilters(t, filters)

  const [
    nConvCur, nConvPrev,
    nMsgCur, nMsgPrev,
    nCtCur, nCtPrev,
    resCur, resPrev,
    convsTotalCur, convsTotalPrev,
    frtCur, frtPrev,
    pvCur, pvPrev,
    daily,
    channels,
  ] = await Promise.all([
    countActiveConversations(t, range, hf), countActiveConversations(t, prev, hf),
    countMessages(t, range, hf),            countMessages(t, prev, hf),
    countContacts(t, range, hf),            countContacts(t, prev, hf),
    countResolvedConversations(t, range, hf), countResolvedConversations(t, prev, hf),
    countConversations(t, range, hf),       countConversations(t, prev, hf),
    avgFirstResponseSec(t, range, hf),      avgFirstResponseSec(t, prev, hf),
    pipelineValueCents(t, hf),              pipelineValueCents(t, hf),
    dailySeries(t, range, hf),
    channelDistribution(t, range, hf),
  ])

  const ratePct = (resolved: number, total: number) => total === 0 ? 0 : Math.round((resolved / total) * 1000) / 10

  return {
    range:               { from: filters.from, to: filters.to },
    conversations:       { current: nConvCur, previous: nConvPrev },
    totalMessages:       { current: nMsgCur,  previous: nMsgPrev },
    newContacts:         { current: nCtCur,   previous: nCtPrev },
    resolvedCount:       { current: resCur,   previous: resPrev },
    resolutionRatePct:   { current: ratePct(resCur, convsTotalCur), previous: ratePct(resPrev, convsTotalPrev) },
    avgFirstResponseSec: { current: frtCur,   previous: frtPrev },
    pipelineValueCents:  { current: pvCur,    previous: pvPrev },
    daily,
    channels,
  }
}

// ── Atendimento ────────────────────────────────────────────────

async function avgResolutionSec(t: string, r: RangeOpts, f: HelperFilters): Promise<number> {
  let q = supabaseAdmin.from("chat_conversations")
    .select("created_at, resolved_at")
    .eq("tenant_id", t).eq("status", "resolved")
    .gte("resolved_at", r.from.toISOString()).lt("resolved_at", r.to.toISOString())
  if (f.agentId)              q = q.eq("assigned_to", f.agentId)
  if (f.contactIds !== null && f.contactIds !== undefined) q = q.in("contact_id", f.contactIds)
  const { data } = await q

  if (!data || data.length === 0) return 0
  const diffs = (data as { created_at: string; resolved_at: string }[])
    .map((c) => (new Date(c.resolved_at).getTime() - new Date(c.created_at).getTime()) / 1000)
    .filter((d) => d >= 0)
  if (diffs.length === 0) return 0
  return Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length)
}

async function withinSLA5min(t: string, r: RangeOpts, f: HelperFilters): Promise<{ rate: number }> {
  let q = supabaseAdmin.from("chat_conversations").select("id")
    .eq("tenant_id", t)
    .gte("created_at", r.from.toISOString()).lt("created_at", r.to.toISOString())
  if (f.agentId)              q = q.eq("assigned_to", f.agentId)
  if (f.contactIds !== null && f.contactIds !== undefined) q = q.in("contact_id", f.contactIds)
  const { data: convs } = await q
  const convIds = (convs ?? []).map((c) => (c as { id: string }).id)
  if (convIds.length === 0) return { rate: 0 }

  const { data: msgs } = await supabaseAdmin
    .from("chat_messages")
    .select("conversation_id, sender_type, created_at")
    .in("conversation_id", convIds).eq("tenant_id", t).eq("is_private_note", false)
    .in("sender_type", ["contact", "agent"])

  type Row = { conversation_id: string; sender_type: string; created_at: string }
  const byConv = new Map<string, { firstContact?: number; firstAgent?: number }>()
  for (const m of (msgs ?? []) as Row[]) {
    const ts = new Date(m.created_at).getTime()
    const e = byConv.get(m.conversation_id) ?? {}
    if (m.sender_type === "contact") { if (e.firstContact === undefined || ts < e.firstContact) e.firstContact = ts }
    else if (m.sender_type === "agent") { if (e.firstAgent === undefined || ts < e.firstAgent) e.firstAgent = ts }
    byConv.set(m.conversation_id, e)
  }
  let withSLA = 0, total = 0
  for (const e of byConv.values()) {
    if (e.firstContact === undefined || e.firstAgent === undefined) continue
    total++
    if ((e.firstAgent - e.firstContact) / 1000 <= 300) withSLA++
  }
  if (total === 0) return { rate: 0 }
  return { rate: Math.round((withSLA / total) * 1000) / 10 }
}

async function heatmapData(t: string, r: RangeOpts, f: HelperFilters): Promise<{ dow: number; hour: number; count: number }[]> {
  let q = supabaseAdmin.from("chat_messages")
    .select("created_at")
    .eq("tenant_id", t).eq("is_private_note", false).eq("sender_type", "contact")
    .gte("created_at", r.from.toISOString()).lt("created_at", r.to.toISOString())
  if (f.conversationIds !== null && f.conversationIds !== undefined) q = q.in("conversation_id", f.conversationIds)
  const { data } = await q

  const matrix = new Map<string, number>()
  for (const row of (data ?? []) as { created_at: string }[]) {
    const d = new Date(row.created_at)
    d.setUTCHours(d.getUTCHours() - 3)
    const key = `${d.getUTCDay()}:${d.getUTCHours()}`
    matrix.set(key, (matrix.get(key) ?? 0) + 1)
  }
  const out: { dow: number; hour: number; count: number }[] = []
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      out.push({ dow, hour, count: matrix.get(`${dow}:${hour}`) ?? 0 })
    }
  }
  return out
}

async function agentLoad(t: string, r: RangeOpts, f: HelperFilters): Promise<AgentLoad[]> {
  let qConvs = supabaseAdmin.from("chat_conversations")
    .select("assigned_to").eq("tenant_id", t).not("assigned_to", "is", null)
    .gte("created_at", r.from.toISOString()).lt("created_at", r.to.toISOString())
  if (f.agentId)              qConvs = qConvs.eq("assigned_to", f.agentId)
  if (f.contactIds !== null && f.contactIds !== undefined) qConvs = qConvs.in("contact_id", f.contactIds)
  const { data: convs } = await qConvs

  const assignedCount = new Map<string, number>()
  for (const c of (convs ?? []) as { assigned_to: string }[]) {
    assignedCount.set(c.assigned_to, (assignedCount.get(c.assigned_to) ?? 0) + 1)
  }

  let qMsgs = supabaseAdmin.from("chat_messages")
    .select("sender_id")
    .eq("tenant_id", t).eq("sender_type", "agent").eq("is_private_note", false)
    .not("sender_id", "is", null)
    .gte("created_at", r.from.toISOString()).lt("created_at", r.to.toISOString())
  if (f.conversationIds !== null && f.conversationIds !== undefined) qMsgs = qMsgs.in("conversation_id", f.conversationIds)
  if (f.agentId)              qMsgs = qMsgs.eq("sender_id", f.agentId)
  const { data: msgs } = await qMsgs

  const messageCount = new Map<string, number>()
  for (const m of (msgs ?? []) as { sender_id: string }[]) {
    messageCount.set(m.sender_id, (messageCount.get(m.sender_id) ?? 0) + 1)
  }

  const ids = Array.from(new Set([...assignedCount.keys(), ...messageCount.keys()]))
  if (ids.length === 0) return []
  const { data: profiles } = await supabaseAdmin
    .from("profiles").select("id, full_name").in("id", ids)
  const nameMap = new Map<string, string>()
  for (const p of (profiles ?? []) as { id: string; full_name: string | null }[]) {
    nameMap.set(p.id, p.full_name ?? "—")
  }

  return ids.map((id) => ({
    agent_id: id,
    name:     nameMap.get(id) ?? "—",
    assigned: assignedCount.get(id) ?? 0,
    messages: messageCount.get(id) ?? 0,
  })).sort((a, b) => b.messages - a.messages)
}

function buildEmptySeries(r: RangeOpts): { date: string; avgSec: number }[] {
  const out: { date: string; avgSec: number }[] = []
  const cur = new Date(r.from)
  while (cur < r.to) {
    out.push({ date: isoDate(cur), avgSec: 0 })
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

async function dailyAvgFirstResponse(t: string, r: RangeOpts, f: HelperFilters): Promise<{ date: string; avgSec: number }[]> {
  let qConvs = supabaseAdmin.from("chat_conversations").select("id, created_at")
    .eq("tenant_id", t)
    .gte("created_at", r.from.toISOString()).lt("created_at", r.to.toISOString())
  if (f.agentId)              qConvs = qConvs.eq("assigned_to", f.agentId)
  if (f.contactIds !== null && f.contactIds !== undefined) qConvs = qConvs.in("contact_id", f.contactIds)
  const { data: convs } = await qConvs

  const convDay = new Map<string, string>()
  for (const c of (convs ?? []) as { id: string; created_at: string }[]) {
    convDay.set(c.id, isoDate(new Date(c.created_at)))
  }
  if (convDay.size === 0) return buildEmptySeries(r)

  const { data: msgs } = await supabaseAdmin
    .from("chat_messages").select("conversation_id, sender_type, created_at")
    .in("conversation_id", Array.from(convDay.keys()))
    .eq("tenant_id", t).eq("is_private_note", false)
    .in("sender_type", ["contact", "agent"])

  type Row = { conversation_id: string; sender_type: string; created_at: string }
  const byConv = new Map<string, { firstContact?: number; firstAgent?: number }>()
  for (const m of (msgs ?? []) as Row[]) {
    const ts = new Date(m.created_at).getTime()
    const e = byConv.get(m.conversation_id) ?? {}
    if (m.sender_type === "contact") { if (e.firstContact === undefined || ts < e.firstContact) e.firstContact = ts }
    else if (m.sender_type === "agent") { if (e.firstAgent === undefined || ts < e.firstAgent) e.firstAgent = ts }
    byConv.set(m.conversation_id, e)
  }

  const dayBuckets = new Map<string, number[]>()
  for (const [convId, day] of convDay) {
    const e = byConv.get(convId)
    if (!e || e.firstContact === undefined || e.firstAgent === undefined) continue
    if (e.firstAgent < e.firstContact) continue
    const diff = (e.firstAgent - e.firstContact) / 1000
    if (!dayBuckets.has(day)) dayBuckets.set(day, [])
    dayBuckets.get(day)!.push(diff)
  }
  return buildEmptySeries(r).map((p) => {
    const arr = dayBuckets.get(p.date) ?? []
    const avg = arr.length === 0 ? 0 : Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
    return { date: p.date, avgSec: avg }
  })
}

async function dailyAvgResolution(t: string, r: RangeOpts, f: HelperFilters): Promise<{ date: string; avgSec: number }[]> {
  let q = supabaseAdmin.from("chat_conversations")
    .select("created_at, resolved_at")
    .eq("tenant_id", t).eq("status", "resolved")
    .gte("resolved_at", r.from.toISOString()).lt("resolved_at", r.to.toISOString())
  if (f.agentId)              q = q.eq("assigned_to", f.agentId)
  if (f.contactIds !== null && f.contactIds !== undefined) q = q.in("contact_id", f.contactIds)
  const { data } = await q

  const dayBuckets = new Map<string, number[]>()
  for (const row of (data ?? []) as { created_at: string; resolved_at: string }[]) {
    const day = isoDate(new Date(row.resolved_at))
    const diff = (new Date(row.resolved_at).getTime() - new Date(row.created_at).getTime()) / 1000
    if (diff < 0) continue
    if (!dayBuckets.has(day)) dayBuckets.set(day, [])
    dayBuckets.get(day)!.push(diff)
  }
  return buildEmptySeries(r).map((p) => {
    const arr = dayBuckets.get(p.date) ?? []
    const avg = arr.length === 0 ? 0 : Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
    return { date: p.date, avgSec: avg }
  })
}

export async function getAtendimentoMetrics(filters: ReportFilters): Promise<AtendimentoMetrics> {
  const t = await tenantId()
  const range: RangeOpts = { from: new Date(filters.from), to: new Date(filters.to) }
  const prev: RangeOpts  = shiftRange(range)
  const hf = await resolveFilters(t, filters)

  const [
    frtCur, frtPrev,
    resTimeCur, resTimePrev,
    slaCur, slaPrev,
    resCur, resPrev,
    frtDaily,
    resDaily,
    heat,
    agents,
  ] = await Promise.all([
    avgFirstResponseSec(t, range, hf),  avgFirstResponseSec(t, prev, hf),
    avgResolutionSec(t, range, hf),     avgResolutionSec(t, prev, hf),
    withinSLA5min(t, range, hf),        withinSLA5min(t, prev, hf),
    countResolvedConversations(t, range, hf), countResolvedConversations(t, prev, hf),
    dailyAvgFirstResponse(t, range, hf),
    dailyAvgResolution(t, range, hf),
    heatmapData(t, range, hf),
    agentLoad(t, range, hf),
  ])

  return {
    range:               { from: filters.from, to: filters.to },
    avgFirstResponseSec: { current: frtCur,     previous: frtPrev },
    avgResolutionSec:    { current: resTimeCur, previous: resTimePrev },
    withinSLA5min:       { current: slaCur.rate, previous: slaPrev.rate },
    resolvedCount:       { current: resCur,     previous: resPrev },
    firstResponseDaily:  frtDaily,
    resolutionDaily:     resDaily,
    heatmap:             heat,
    agentLoad:           agents,
  }
}

// ─── Funil ──────────────────────────────────────────────────

/**
 * Resolve qual pipeline usar:
 *  • pipelineIdParam (se passado e válido pro tenant)
 *  • senão: tenant_config.default_pipeline_id
 *  • senão: primeiro pipelines.is_default = true
 *  • senão: primeiro pipelines (qualquer)
 *  • senão: null (tenant sem pipeline algum)
 */
async function resolvePipelineId(t: string, pipelineIdParam?: string | null): Promise<string | null> {
  if (pipelineIdParam) {
    const { data: p } = await supabaseAdmin
      .from("pipelines").select("id").eq("tenant_id", t).eq("id", pipelineIdParam).maybeSingle()
    if (p) return (p as { id: string }).id
  }
  const { data: cfg } = await supabaseAdmin
    .from("tenant_config").select("default_pipeline_id").eq("tenant_id", t).maybeSingle()
  const fromCfg = (cfg as { default_pipeline_id: string | null } | null)?.default_pipeline_id ?? null
  if (fromCfg) return fromCfg
  const { data: pls } = await supabaseAdmin
    .from("pipelines").select("id, is_default")
    .eq("tenant_id", t).order("is_default", { ascending: false }).order("position", { ascending: true }).limit(1)
  const first = ((pls ?? []) as { id: string }[])[0]
  return first?.id ?? null
}

export async function getFunilMetrics(filters: ReportFilters, pipelineIdParam?: string | null): Promise<FunilMetrics> {
  const t = await tenantId()
  const range: RangeOpts = { from: new Date(filters.from), to: new Date(filters.to) }
  const prev: RangeOpts  = shiftRange(range)
  const hf = await resolveFilters(t, filters)

  const pipelineId = await resolvePipelineId(t, pipelineIdParam)
  if (!pipelineId) {
    return {
      range: { from: filters.from, to: filters.to },
      pipelineId: null,
      stages: [],
      conversionRatePct: { current: 0, previous: 0 },
      wonValueCents:     { current: 0, previous: 0 },
      avgWinDays:        { current: 0, previous: 0 },
      topLostReasons:    [],
    }
  }

  const { data: rawStages } = await supabaseAdmin
    .from("pipeline_stages")
    .select("id, name, color, position, is_won, is_lost, is_triage")
    .eq("tenant_id", t).eq("pipeline_id", pipelineId)
    .order("position", { ascending: true })

  type StageRow = { id: string; name: string; color: string; position: number; is_won: boolean; is_lost: boolean; is_triage: boolean }
  const stagesData = (rawStages ?? []) as StageRow[]

  // Counts + sum por stage (todas as convs ATIVAS — snapshot atual)
  let qConvs = supabaseAdmin.from("chat_conversations")
    .select("stage_id, estimated_value, won_at, lost_at, lost_reason, status, created_at")
    .eq("tenant_id", t).eq("pipeline_id", pipelineId)
  if (f_agent(hf))   qConvs = qConvs.eq("assigned_to", hf.agentId!)
  if (f_chan(hf))    qConvs = qConvs.in("contact_id", hf.contactIds!)
  const { data: allConvs } = await qConvs

  const stageBuckets = new Map<string, { count: number; sum: number }>()
  for (const s of stagesData) stageBuckets.set(s.id, { count: 0, sum: 0 })
  for (const c of (allConvs ?? []) as { stage_id: string | null; estimated_value: number | null }[]) {
    if (!c.stage_id) continue
    const b = stageBuckets.get(c.stage_id)
    if (!b) continue
    b.count++
    b.sum += Number(c.estimated_value ?? 0)
  }

  const stages = stagesData.map((s) => {
    const b = stageBuckets.get(s.id) ?? { count: 0, sum: 0 }
    return {
      id: s.id, name: s.name, color: s.color,
      position: s.position,
      is_won: s.is_won, is_lost: s.is_lost, is_triage: s.is_triage,
      count: b.count,
      valueCents: Math.round(b.sum * 100),
    }
  })

  // KPIs: convs criadas no período + quantas viraram won
  const wonStageIds = new Set(stagesData.filter((s) => s.is_won).map((s) => s.id))

  const periodConvs = (allConvs ?? []).filter((c) => {
    const ca = new Date((c as { created_at: string }).created_at)
    return ca >= range.from && ca < range.to
  }) as { stage_id: string | null; estimated_value: number | null; won_at: string | null; lost_reason: string | null; created_at: string }[]

  const wonCurrent = periodConvs.filter((c) => c.stage_id && wonStageIds.has(c.stage_id))
  const conversionRateCur = periodConvs.length === 0 ? 0 :
    Math.round((wonCurrent.length / periodConvs.length) * 1000) / 10

  const wonValueCur = Math.round(wonCurrent.reduce((acc, c) => acc + Number(c.estimated_value ?? 0), 0) * 100)

  const winDaysArr = wonCurrent
    .filter((c) => c.won_at)
    .map((c) => (new Date(c.won_at!).getTime() - new Date(c.created_at).getTime()) / (1000 * 86400))
  const avgWinDaysCur = winDaysArr.length === 0 ? 0 : Math.round((winDaysArr.reduce((a, b) => a + b, 0) / winDaysArr.length) * 10) / 10

  // Período anterior (mesmas queries)
  const prevConvs = (allConvs ?? []).filter((c) => {
    const ca = new Date((c as { created_at: string }).created_at)
    return ca >= prev.from && ca < prev.to
  }) as { stage_id: string | null; estimated_value: number | null; won_at: string | null; created_at: string }[]
  const wonPrev = prevConvs.filter((c) => c.stage_id && wonStageIds.has(c.stage_id))
  const conversionRatePrev = prevConvs.length === 0 ? 0 :
    Math.round((wonPrev.length / prevConvs.length) * 1000) / 10
  const wonValuePrev = Math.round(wonPrev.reduce((acc, c) => acc + Number(c.estimated_value ?? 0), 0) * 100)
  const winDaysArrPrev = wonPrev
    .filter((c) => c.won_at)
    .map((c) => (new Date(c.won_at!).getTime() - new Date(c.created_at).getTime()) / (1000 * 86400))
  const avgWinDaysPrev = winDaysArrPrev.length === 0 ? 0 : Math.round((winDaysArrPrev.reduce((a, b) => a + b, 0) / winDaysArrPrev.length) * 10) / 10

  // Top motivos de perda (no período corrente)
  const lostCounts = new Map<string, number>()
  for (const c of periodConvs) {
    if (!c.lost_reason) continue
    lostCounts.set(c.lost_reason, (lostCounts.get(c.lost_reason) ?? 0) + 1)
  }
  const topLost = Array.from(lostCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count).slice(0, 5)

  return {
    range: { from: filters.from, to: filters.to },
    pipelineId,
    stages,
    conversionRatePct: { current: conversionRateCur, previous: conversionRatePrev },
    wonValueCents:     { current: wonValueCur, previous: wonValuePrev },
    avgWinDays:        { current: avgWinDaysCur, previous: avgWinDaysPrev },
    topLostReasons:    topLost,
  }
}

// helpers locais (filter shortcuts)
function f_agent(f: HelperFilters): boolean { return !!f.agentId }
function f_chan(f: HelperFilters): boolean  { return f.contactIds !== null && f.contactIds !== undefined }

// ─── Funil: pipelines + config customizada ──────────────────

export interface PipelineOption {
  id:         string
  name:       string
  color:      string
  is_default: boolean
  active:     boolean
}

export async function listTenantPipelines(): Promise<PipelineOption[]> {
  const t = await tenantId()
  const { data } = await supabaseAdmin
    .from("pipelines")
    .select("id, name, color, is_default, active, position")
    .eq("tenant_id", t)
    .order("is_default", { ascending: false })
    .order("position", { ascending: true })
  return ((data ?? []) as Array<PipelineOption & { position: number }>).map((p) => ({
    id: p.id, name: p.name, color: p.color, is_default: p.is_default, active: p.active,
  }))
}

export interface FunnelConfig {
  pipeline_id: string
  stage_ids:   string[]  // ordem de exibição. Vazio = usar default (todas as stages por position).
}

export async function getFunnelConfig(pipelineId: string): Promise<FunnelConfig | null> {
  const t = await tenantId()
  const { data } = await supabaseAdmin
    .from("tenant_funnel_configs")
    .select("pipeline_id, stage_ids")
    .eq("tenant_id", t).eq("pipeline_id", pipelineId)
    .maybeSingle()
  if (!data) return null
  const row = data as { pipeline_id: string; stage_ids: string[] | null }
  return { pipeline_id: row.pipeline_id, stage_ids: row.stage_ids ?? [] }
}

export async function saveFunnelConfig(
  input: { pipelineId: string; stageIds: string[] }
): Promise<{ error?: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  if (!["owner", "admin"].includes(session.user.role)) {
    return { error: "Apenas owner/admin podem configurar o funil" }
  }
  const t = session.user.tenantId

  // Valida que pipeline pertence ao tenant
  const { data: pl } = await supabaseAdmin
    .from("pipelines").select("id").eq("tenant_id", t).eq("id", input.pipelineId).maybeSingle()
  if (!pl) return { error: "Pipeline não encontrado" }

  // Valida que stages pertencem a esse pipeline
  if (input.stageIds.length > 0) {
    const { data: sts } = await supabaseAdmin
      .from("pipeline_stages").select("id")
      .eq("tenant_id", t).eq("pipeline_id", input.pipelineId).in("id", input.stageIds)
    const validIds = new Set(((sts ?? []) as { id: string }[]).map((s) => s.id))
    const invalid = input.stageIds.filter((id) => !validIds.has(id))
    if (invalid.length > 0) return { error: "Stages inválidas pra este pipeline" }
  }

  const { error } = await supabaseAdmin
    .from("tenant_funnel_configs")
    .upsert(
      { tenant_id: t, pipeline_id: input.pipelineId, stage_ids: input.stageIds, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,pipeline_id" }
    )
  if (error) return { error: error.message }
  return {}
}

// ─── Origem ─────────────────────────────────────────────────

export async function getOrigemMetrics(filters: ReportFilters): Promise<OrigemMetrics> {
  const t = await tenantId()
  const range: RangeOpts = { from: new Date(filters.from), to: new Date(filters.to) }
  const prev: RangeOpts  = shiftRange(range)
  const hf = await resolveFilters(t, filters)

  // Contatos no período (com source + lifecycle + metadata pra CTWA)
  let qContacts = supabaseAdmin.from("chat_contacts")
    .select("id, source, lifecycle_stage, metadata, created_at")
    .eq("tenant_id", t)
    .gte("created_at", range.from.toISOString())
    .lt("created_at", range.to.toISOString())
  if (f_chan(hf)) qContacts = qContacts.in("id", hf.contactIds!)
  const { data: contacts } = await qContacts

  // Convs por contato (pra estimated_value médio)
  const contactIds = ((contacts ?? []) as { id: string }[]).map((c) => c.id)
  let qConvs = supabaseAdmin.from("chat_conversations")
    .select("contact_id, estimated_value")
    .eq("tenant_id", t)
  if (contactIds.length > 0) qConvs = qConvs.in("contact_id", contactIds)
  const { data: convs } = contactIds.length > 0 ? await qConvs : { data: [] }

  type ContactRow = { id: string; source: string; lifecycle_stage: string; metadata: Record<string, unknown> | null; created_at: string }
  type ConvRow    = { contact_id: string; estimated_value: number | null }

  const convsByContact = new Map<string, ConvRow[]>()
  for (const cv of (convs ?? []) as ConvRow[]) {
    if (!convsByContact.has(cv.contact_id)) convsByContact.set(cv.contact_id, [])
    convsByContact.get(cv.contact_id)!.push(cv)
  }

  // Agrupar por source
  type Acc = { contacts: number; conversations: number; valueSum: number; converted: number }
  const byChanMap = new Map<string, Acc>()
  for (const c of (contacts ?? []) as ContactRow[]) {
    const acc = byChanMap.get(c.source) ?? { contacts: 0, conversations: 0, valueSum: 0, converted: 0 }
    acc.contacts++
    const cvList = convsByContact.get(c.id) ?? []
    acc.conversations += cvList.length
    acc.valueSum += cvList.reduce((s, cv) => s + Number(cv.estimated_value ?? 0), 0)
    if (c.lifecycle_stage && c.lifecycle_stage !== "contact") acc.converted++
    byChanMap.set(c.source, acc)
  }

  const byChannel = Array.from(byChanMap.entries()).map(([source, acc]) => {
    const meta = SOURCE_META[source as keyof typeof SOURCE_META] ?? { label: source, color: "#64748b", icon: "?" }
    return {
      source,
      label:            meta.label,
      color:            meta.color,
      contacts:         acc.contacts,
      conversations:    acc.conversations,
      avgEstimateCents: acc.conversations === 0 ? 0 : Math.round((acc.valueSum / acc.conversations) * 100),
      conversionPct:    acc.contacts === 0 ? 0 : Math.round((acc.converted / acc.contacts) * 1000) / 10,
    }
  }).sort((a, b) => b.contacts - a.contacts)

  // CTWA — contatos com metadata.first_ad_reply
  const ctwaContactsList = ((contacts ?? []) as ContactRow[])
    .filter((c) => (c.metadata as { first_ad_reply?: unknown } | null)?.first_ad_reply)

  // CTWA no período espelhado (compara)
  let qContactsPrev = supabaseAdmin.from("chat_contacts")
    .select("metadata, created_at")
    .eq("tenant_id", t)
    .gte("created_at", prev.from.toISOString())
    .lt("created_at", prev.to.toISOString())
  if (f_chan(hf)) qContactsPrev = qContactsPrev.in("id", hf.contactIds!)
  const { data: contactsPrev } = await qContactsPrev
  const ctwaPrev = ((contactsPrev ?? []) as { metadata: Record<string, unknown> | null }[])
    .filter((c) => (c.metadata as { first_ad_reply?: unknown } | null)?.first_ad_reply).length

  // Top campanhas
  const campaignMap = new Map<string, number>()
  for (const c of ctwaContactsList) {
    const ad = (c.metadata as { first_ad_reply?: { headline?: string; sourceId?: string } } | null)?.first_ad_reply
    if (!ad) continue
    const key = ad.headline ?? ad.sourceId ?? "—"
    campaignMap.set(key, (campaignMap.get(key) ?? 0) + 1)
  }
  const topCampaigns = Array.from(campaignMap.entries())
    .map(([headline, count]) => ({ headline, count }))
    .sort((a, b) => b.count - a.count).slice(0, 5)

  // Daily stacked area
  const dayMap = new Map<string, Map<string, number>>()
  const cur = new Date(range.from)
  while (cur < range.to) {
    dayMap.set(isoDate(cur), new Map())
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  for (const c of (contacts ?? []) as ContactRow[]) {
    const k = isoDate(new Date(c.created_at))
    const sub = dayMap.get(k)
    if (!sub) continue
    sub.set(c.source, (sub.get(c.source) ?? 0) + 1)
  }
  const allSources = Array.from(byChanMap.keys())
  const dailyByChannel = Array.from(dayMap.entries()).map(([date, sub]) => {
    const row: { date: string; [k: string]: number | string } = { date }
    for (const s of allSources) row[s] = sub.get(s) ?? 0
    return row
  })

  return {
    range: { from: filters.from, to: filters.to },
    byChannel,
    ctwaCount:      { current: ctwaContactsList.length, previous: ctwaPrev },
    ctwaContacts:   ctwaContactsList.length,
    topCampaigns,
    dailyByChannel,
  }
}

// reserva pra suprimir uso indireto (eslint do TS pode reclamar)
// ── Lista de agentes pro filtro ─────────────────────────────

export interface AgentOption { id: string; name: string }

export async function listAgentsForFilter(): Promise<AgentOption[]> {
  const t = await tenantId()
  const { data: links } = await supabaseAdmin
    .from("tenant_users").select("user_id").eq("tenant_id", t)
  const ids = (links ?? []).map((l) => (l as { user_id: string }).user_id)
  if (ids.length === 0) return []
  const { data: profiles } = await supabaseAdmin
    .from("profiles").select("id, full_name, email").in("id", ids)
  return ((profiles ?? []) as { id: string; full_name: string | null; email: string }[])
    .map((p) => ({ id: p.id, name: p.full_name ?? p.email }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
