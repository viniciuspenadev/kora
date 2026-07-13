"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope, canViewConversation, type ViewerScope } from "@/lib/visibility"
import { requireModule, hasModule } from "@/lib/modules"
import { createNotification } from "@/lib/notifications"
import { logAudit } from "@/lib/audit"
import { ensureAgendaConfirmTemplate, agendaConfirmStatus, type AgendaTemplateStatus } from "@/lib/agenda/official-template"
import type { WorkingHoursDay } from "@/lib/agenda/availability"
import { availabilitySlots, bookAppointment } from "@/lib/agenda/booking"
import { after } from "next/server"

// ═══════════════════════════════════════════════════════════════
// Server actions da Agenda (Fase 1) — doc: docs/agenda-design.md
// ═══════════════════════════════════════════════════════════════
// Padrão do projeto: supabaseAdmin (service-role) + tenant_id imposto na
// app; config (recursos/serviços/bloqueios) é território de owner/admin;
// agendamento qualquer membro autenticado cria. Mutações retornam
// { error?: string } / { id }.
//
// VISIBILIDADE POR-ATENDENTE (Fase 1 — segurança): a agenda NÃO é mais tenant-wide.
// Um membro vê/atua num compromisso se é admin/supervisor (view_all), OU é o host
// (agente do recurso), OU quem agendou (created_by), OU enxerga a conversa vinculada
// (herda a regra do inbox). `canSeeAppointment` é a fonte única — usada na listagem
// E nas mutações (fail-closed; o id sozinho não basta). Co-host (participantes do
// compromisso) e delegação de agenda (níveis livre/ocupado · detalhes · gerenciar)
// entram nas fases seguintes plugando aqui.

const ROUTE = "/agenda"

export interface ResourceRow {
  id: string; tenant_id: string; name: string; kind: string | null
  capacity: number; working_hours: WorkingHoursDay[]; slot_minutes: number
  timezone: string; assigned_agent_id: string | null
  min_lead_minutes: number; max_horizon_days: number; active: boolean
  share_everyone_level: ShareLevel | null   // "todos" — piso de acesso da equipe inteira
}
export interface ServiceRow {
  id: string; tenant_id: string; name: string; duration_minutes: number
  buffer_before_minutes: number; buffer_after_minutes: number
  resource_ids: string[]; price: number | null
  reminder_policy: Record<string, unknown>; active: boolean
}
export interface AppointmentRow {
  id: string; tenant_id: string; contact_id: string; conversation_id: string | null
  resource_id: string; service_id: string | null
  starts_at: string; ends_at: string; status: string; source: string
  blocks_overlap: boolean; notes: string | null; created_by: string | null
  busy_only?: boolean   // nível "livre/ocupado": só horário, PII removida no servidor
}

// ── helpers: escopo + gating de módulo (entitlement, fail-closed) ──
// requireModule lança se o tenant não tem `agenda` → toda ESCRITA passa por
// aqui (a página já barra a leitura; as actions são endpoints POST e
// precisam barrar sozinhas, senão um membro burla o gate de módulo).
async function agendaScope() {
  const s = await getViewerScope()
  await requireModule("agenda")
  return s
}
async function adminScope() {
  const s = await agendaScope()
  if (!s.isAdmin) throw new Error("Apenas owner/admin gerenciam a configuração da agenda")
  return s
}

/** Anti-IDOR: o agente atribuído a um recurso tem que ser membro do tenant. */
async function assertAgentInTenant(tenantId: string, agentId: string | null | undefined): Promise<boolean> {
  if (!agentId) return true
  const { data } = await supabaseAdmin.from("tenant_users")
    .select("user_id").eq("tenant_id", tenantId).eq("user_id", agentId).maybeSingle()
  return !!data
}

// ── Visibilidade de compromisso — "ESCADA" de níveis (fonte ÚNICA, leitura E escrita) ──
// none < free_busy < details < manage. "A maior permissão vence" (união de fontes:
// papel + host + criador + supervisor + co-host + conversa + delegação de agenda).
export type AccessLevel = "none" | "free_busy" | "details" | "manage"
const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, free_busy: 1, details: 2, manage: 3 }
export type ShareLevel = "free_busy" | "details" | "manage"

// Campos mínimos pra decidir acesso. Embeds via PostgREST nas queries.
type ApptVisibility = {
  created_by:         string | null
  tenant_resources:   { assigned_agent_id: string | null; share_everyone_level: ShareLevel | null } | null
  chat_conversations: { assigned_to: string | null; participants: string[] | null; department_id: string | null; instance_id: string | null } | null
}

/** Nível efetivo do viewer sobre um compromisso. Fail-closed = none. */
function appointmentLevel(s: ViewerScope, a: ApptVisibility, shareLevel: ShareLevel | undefined, isCoHost: boolean): AccessLevel {
  if (s.isAdmin) return "manage"
  let best: AccessLevel = "none"
  const bump = (l: AccessLevel) => { if (LEVEL_RANK[l] > LEVEL_RANK[best]) best = l }
  if (a.tenant_resources?.assigned_agent_id === s.userId) bump("manage")          // host (dono do recurso)
  if (a.created_by === s.userId) bump("manage")                                   // quem agendou
  if (s.viewAll) bump("details")                                                  // supervisor
  if (isCoHost) bump("details")                                                   // co-host
  if (a.chat_conversations && canViewConversation(s, a.chat_conversations)) bump("details")  // herda o inbox
  if (a.tenant_resources?.share_everyone_level) bump(a.tenant_resources.share_everyone_level) // "todos" (piso da equipe)
  if (shareLevel) bump(shareLevel)                                                // delegação específica
  return best
}

const APPT_VISIBILITY_SELECT = "created_by, tenant_resources(assigned_agent_id, share_everyone_level), chat_conversations(instance_id, assigned_to, participants, department_id)"

/** Co-host: o viewer é participante explícito deste compromisso? */
async function isAppointmentParticipant(s: ViewerScope, appointmentId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from("appointment_participants")
    .select("user_id").eq("tenant_id", s.tenantId).eq("appointment_id", appointmentId).eq("user_id", s.userId).maybeSingle()
  return !!data
}

/** Nível de delegação do viewer sobre UM recurso (defensivo: tabela pode não existir ainda). */
async function viewerShareLevel(s: ViewerScope, resourceId: string): Promise<ShareLevel | undefined> {
  try {
    const { data } = await supabaseAdmin.from("resource_shares")
      .select("level").eq("tenant_id", s.tenantId).eq("resource_id", resourceId).eq("grantee_user_id", s.userId).maybeSingle()
    return (data?.level as ShareLevel | undefined) ?? undefined
  } catch { return undefined }
}

/** Mapa recurso→nível de TODAS as agendas compartilhadas com o viewer (1 query; defensivo). */
async function viewerShareMap(s: ViewerScope): Promise<Map<string, ShareLevel>> {
  try {
    const { data } = await supabaseAdmin.from("resource_shares")
      .select("resource_id, level").eq("tenant_id", s.tenantId).eq("grantee_user_id", s.userId)
    return new Map((data ?? []).map((r) => [r.resource_id as string, r.level as ShareLevel]))
  } catch { return new Map() }
}

/**
 * Carrega um compromisso por id E gateia o ator pra MUTAÇÃO (exige nível ≥ details —
 * "livre/ocupado" é só leitura). O id sozinho nunca basta (defesa em profundidade vs IDOR).
 */
async function gateAppointment(s: ViewerScope, id: string): Promise<{ appt?: { starts_at: string; ends_at: string; resource_id: string }; error?: string }> {
  const { data } = await supabaseAdmin.from("appointments")
    .select(`starts_at, ends_at, resource_id, ${APPT_VISIBILITY_SELECT}`)
    .eq("tenant_id", s.tenantId).eq("id", id).maybeSingle()
  if (!data) return { error: "Agendamento não encontrado" }
  const resourceId = (data as { resource_id: string }).resource_id
  const [isCo, share] = await Promise.all([isAppointmentParticipant(s, id), viewerShareLevel(s, resourceId)])
  const level = appointmentLevel(s, data as unknown as ApptVisibility, share, isCo)
  if (LEVEL_RANK[level] < LEVEL_RANK.details) {
    return { error: level === "free_busy" ? "Você só tem acesso de leitura (livre/ocupado) a esta agenda" : "Você não tem acesso a este agendamento" }
  }
  return { appt: data as unknown as { starts_at: string; ends_at: string; resource_id: string } }
}

// ═══════════════════════════════════════════════════════════════
// AVISOS AUTOMÁTICOS — master switch por tenant (backend-enforced)
// ═══════════════════════════════════════════════════════════════
// O sender (reminders.ts) confere `tenant_config.agenda_reminders_enabled`
// antes de qualquer envio. Default false: nada sai sem o admin ligar aqui.
export async function getAgendaRemindersEnabled(): Promise<boolean> {
  const s = await getViewerScope()
  const { data } = await supabaseAdmin.from("tenant_config")
    .select("agenda_reminders_enabled").eq("tenant_id", s.tenantId).maybeSingle()
  return data?.agenda_reminders_enabled === true
}

export async function setAgendaRemindersEnabled(enabled: boolean): Promise<{ error?: string }> {
  const s = await adminScope()
  await requireModule("agenda_reminders")   // entitlement: add-on premium (god mode)
  const { error } = await supabaseAdmin.from("tenant_config")
    .upsert({ tenant_id: s.tenantId, agenda_reminders_enabled: enabled }, { onConflict: "tenant_id" })
  if (error) return { error: error.message }
  // Auto-semeia o template oficial de confirmação (§6.10) — idempotente, best-effort,
  // no-op em tenant só-Baileys. Em background pra não atrasar o toggle.
  if (enabled) after(() => ensureAgendaConfirmTemplate(s.tenantId))
  revalidatePath(ROUTE)
  return {}
}

/**
 * "Ativar modelo" do picker de lembrete (canal oficial): cria o template de
 * confirmação na WABA do tenant (idempotente) e devolve o status atual. A
 * aprovação é assíncrona na Meta — o cliente acompanha o status no picker.
 */
export async function activateAgendaConfirmTemplate(): Promise<{ status: AgendaTemplateStatus; error?: string }> {
  const s = await adminScope()
  await requireModule("agenda_reminders")
  await ensureAgendaConfirmTemplate(s.tenantId)
  return { status: await agendaConfirmStatus(s.tenantId) }
}

// ═══════════════════════════════════════════════════════════════
// RECURSOS (config — owner/admin)
// ═══════════════════════════════════════════════════════════════
export async function listResources(includeInactive = false): Promise<ResourceRow[]> {
  const s = await getViewerScope()
  let q = supabaseAdmin.from("tenant_resources").select("*").eq("tenant_id", s.tenantId).order("name")
  if (!includeInactive) q = q.eq("active", true)
  const { data } = await q
  return (data ?? []) as ResourceRow[]
}

export async function createResource(input: {
  name: string; kind?: string | null; capacity?: number; working_hours?: WorkingHoursDay[]
  slot_minutes?: number; timezone?: string; assigned_agent_id?: string | null
  min_lead_minutes?: number; max_horizon_days?: number
}): Promise<{ error?: string; id?: string }> {
  const s = await adminScope()
  if (!input.name?.trim()) return { error: "Dê um nome ao recurso" }
  if (!(await assertAgentInTenant(s.tenantId, input.assigned_agent_id))) return { error: "Atendente inválido" }
  const { data, error } = await supabaseAdmin.from("tenant_resources").insert({
    tenant_id: s.tenantId,
    name: input.name.trim(),
    kind: input.kind?.trim() || null,
    capacity: Math.max(1, input.capacity ?? 1),
    working_hours: input.working_hours ?? [],
    slot_minutes: input.slot_minutes ?? 30,
    timezone: input.timezone || "America/Sao_Paulo",
    assigned_agent_id: input.assigned_agent_id ?? null,
    min_lead_minutes: input.min_lead_minutes ?? 0,
    max_horizon_days: input.max_horizon_days ?? 60,
  }).select("id").single()
  if (error) return { error: error.message }
  revalidatePath(ROUTE)
  return { id: data.id }
}

export async function updateResource(id: string, patch: Partial<{
  name: string; kind: string | null; capacity: number; working_hours: WorkingHoursDay[]
  slot_minutes: number; timezone: string; assigned_agent_id: string | null
  min_lead_minutes: number; max_horizon_days: number; active: boolean
}>): Promise<{ error?: string }> {
  const s = await adminScope()
  if ("assigned_agent_id" in patch && !(await assertAgentInTenant(s.tenantId, patch.assigned_agent_id))) {
    return { error: "Atendente inválido" }
  }
  const { error } = await supabaseAdmin.from("tenant_resources")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("tenant_id", s.tenantId).eq("id", id)
  if (error) return { error: error.message }
  revalidatePath(ROUTE)
  return {}
}

// ═══════════════════════════════════════════════════════════════
// SERVIÇOS (config — owner/admin)
// ═══════════════════════════════════════════════════════════════
export async function listServices(includeInactive = false): Promise<ServiceRow[]> {
  const s = await getViewerScope()
  let q = supabaseAdmin.from("tenant_services").select("*").eq("tenant_id", s.tenantId).order("name")
  if (!includeInactive) q = q.eq("active", true)
  const { data } = await q
  return (data ?? []) as ServiceRow[]
}

export async function createService(input: {
  name: string; duration_minutes?: number; buffer_before_minutes?: number
  buffer_after_minutes?: number; resource_ids?: string[]; price?: number | null
  reminder_policy?: Record<string, unknown>
}): Promise<{ error?: string; id?: string }> {
  const s = await adminScope()
  if (!input.name?.trim()) return { error: "Dê um nome ao serviço" }
  const { data, error } = await supabaseAdmin.from("tenant_services").insert({
    tenant_id: s.tenantId,
    name: input.name.trim(),
    duration_minutes: Math.max(1, input.duration_minutes ?? 30),
    buffer_before_minutes: input.buffer_before_minutes ?? 0,
    buffer_after_minutes: input.buffer_after_minutes ?? 0,
    resource_ids: input.resource_ids ?? [],
    price: input.price ?? null,
    reminder_policy: input.reminder_policy ?? {},
  }).select("id").single()
  if (error) return { error: error.message }
  revalidatePath(ROUTE)
  return { id: data.id }
}

export async function updateService(id: string, patch: Partial<{
  name: string; duration_minutes: number; buffer_before_minutes: number
  buffer_after_minutes: number; resource_ids: string[]; price: number | null
  reminder_policy: Record<string, unknown>; active: boolean
}>): Promise<{ error?: string }> {
  const s = await adminScope()
  const { error } = await supabaseAdmin.from("tenant_services")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("tenant_id", s.tenantId).eq("id", id)
  if (error) return { error: error.message }
  revalidatePath(ROUTE)
  return {}
}

// ═══════════════════════════════════════════════════════════════
// BLOQUEIOS (config — owner/admin)
// ═══════════════════════════════════════════════════════════════
export async function listBlackouts(resourceId?: string): Promise<{ id: string; resource_id: string | null; starts_at: string; ends_at: string; reason: string | null }[]> {
  const s = await getViewerScope()
  let q = supabaseAdmin.from("tenant_blackouts").select("id, resource_id, starts_at, ends_at, reason").eq("tenant_id", s.tenantId)
  if (resourceId) q = q.or(`resource_id.eq.${resourceId},resource_id.is.null`)
  const { data } = await q.order("starts_at")
  return data ?? []
}

export async function createBlackout(input: { resource_id?: string | null; starts_at: string; ends_at: string; reason?: string }): Promise<{ error?: string }> {
  const s = await adminScope()
  if (new Date(input.ends_at) <= new Date(input.starts_at)) return { error: "Fim deve ser depois do início" }
  const { error } = await supabaseAdmin.from("tenant_blackouts").insert({
    tenant_id: s.tenantId, resource_id: input.resource_id ?? null,
    starts_at: input.starts_at, ends_at: input.ends_at, reason: input.reason?.trim() || null,
  })
  if (error) return { error: error.message }
  revalidatePath(ROUTE)
  return {}
}

export async function deleteBlackout(id: string): Promise<{ error?: string }> {
  const s = await adminScope()
  const { error } = await supabaseAdmin.from("tenant_blackouts").delete().eq("tenant_id", s.tenantId).eq("id", id)
  if (error) return { error: error.message }
  revalidatePath(ROUTE)
  return {}
}

// ═══════════════════════════════════════════════════════════════
// BUSCA DE CONTATO (picker do booking manual)
// ═══════════════════════════════════════════════════════════════
export async function searchAgendaContacts(term: string): Promise<{ id: string; name: string; phone: string | null }[]> {
  const s = await getViewerScope()
  const t = term.trim()
  if (t.length < 2) return []
  const like = `%${t.replace(/[%_\\]/g, (m) => "\\" + m)}%`
  const { data } = await supabaseAdmin.from("chat_contacts")
    .select("id, push_name, custom_name, phone_number")
    .eq("tenant_id", s.tenantId)
    .or(`push_name.ilike.${like},custom_name.ilike.${like},phone_number.ilike.${like}`)
    .limit(8)
  return (data ?? []).map((c) => ({
    id: c.id as string,
    name: (c.custom_name as string) || (c.push_name as string) || "Sem nome",
    phone: (c.phone_number as string) ?? null,
  }))
}

// ═══════════════════════════════════════════════════════════════
// DISPONIBILIDADE (alimenta UI de picking + IA na Fase 2)
// ═══════════════════════════════════════════════════════════════
export async function getAvailableSlots(input: {
  resourceId: string; serviceId?: string; rangeStart: string; rangeEnd: string; partySize?: number
}): Promise<{ error?: string; slots?: { start: string; end: string }[] }> {
  const s = await agendaScope()
  // Núcleo server-less (compartilhado com as capabilities do Studio — F2).
  const slots = await availabilitySlots(s.tenantId, input)
  return { slots }
}

// ═══════════════════════════════════════════════════════════════
// AGENDAMENTOS (qualquer membro autenticado)
// ═══════════════════════════════════════════════════════════════
export async function listAppointments(input: { rangeStart: string; rangeEnd: string; resourceId?: string }): Promise<AppointmentRow[]> {
  const s = await getViewerScope()
  let q = supabaseAdmin.from("appointments")
    .select(`*, chat_contacts(push_name, custom_name, phone_number, profile_pic_url), tenant_services(name), tenant_resources(name, assigned_agent_id, share_everyone_level), chat_conversations(instance_id, assigned_to, participants, department_id)`)
    .eq("tenant_id", s.tenantId)
    .lt("starts_at", input.rangeEnd).gt("ends_at", input.rangeStart)
    .order("starts_at")
  if (input.resourceId) q = q.eq("resource_id", input.resourceId)
  const { data } = await q
  const rows = (data ?? []) as unknown as (AppointmentRow & ApptVisibility)[]
  // Admin → manage tudo, sem strip (fast path).
  if (s.isAdmin) return rows as unknown as AppointmentRow[]

  // Co-host (range) + delegação de agenda (shares do viewer) — 1 query cada.
  const ids = rows.map((r) => r.id)
  let partSet = new Set<string>()
  if (ids.length) {
    const { data: parts } = await supabaseAdmin.from("appointment_participants")
      .select("appointment_id").eq("tenant_id", s.tenantId).eq("user_id", s.userId).in("appointment_id", ids)
    partSet = new Set((parts ?? []).map((p) => p.appointment_id as string))
  }
  const shareMap = await viewerShareMap(s)

  // Nível por compromisso: `none` cai fora; `free_busy` vira "Ocupado" (PII removida
  // AQUI, no servidor — não é esconder no front). Fecha o vazamento entre agentes.
  const out: AppointmentRow[] = []
  for (const a of rows) {
    const level = appointmentLevel(s, a, shareMap.get(a.resource_id), partSet.has(a.id))
    if (level === "none") continue
    out.push(level === "free_busy" ? redactBusy(a) : (a as unknown as AppointmentRow))
  }
  return out
}

/** Redige um compromisso pro nível "livre/ocupado": mantém só o horário, zera a PII. */
function redactBusy(a: AppointmentRow & ApptVisibility): AppointmentRow {
  const r = { ...(a as unknown as Record<string, unknown>) }
  r.contact_id = ""; r.conversation_id = null; r.service_id = null; r.notes = null
  r.chat_contacts = null; r.tenant_services = null
  r.busy_only = true
  return r as unknown as AppointmentRow
}

/**
 * Cria um agendamento. Anti-double-book: capacidade 1 é garantida HARD pelo
 * EXCLUDE no banco (insert sobreposto → 23P01, traduzido pra erro amigável);
 * capacidade N valida por contagem aqui (janela de corrida pequena; advisory
 * lock via RPC entra como hardening na Fase 3). Booking manual pode ser
 * off-grid (o atendente escolhe a hora); bloqueios sempre barram.
 */
export async function createAppointment(input: {
  contactId: string; conversationId?: string | null; resourceId: string; serviceId?: string | null
  startsAt: string; durationMinutes?: number; source?: "ai" | "agent" | "manual"; notes?: string; partySize?: number
  notifyCustomer?: boolean
}): Promise<{ error?: string; id?: string }> {
  const s = await agendaScope()
  // Delega ao núcleo server-less (DRY — mesmo motor que a capability do Studio usa).
  const r = await bookAppointment(s.tenantId, { ...input, createdBy: s.userId })
  if (r.error) return { error: r.error }
  revalidatePath(ROUTE)
  return { id: r.id }
}

export async function rescheduleAppointment(id: string, newStartsAt: string): Promise<{ error?: string }> {
  const s = await agendaScope()
  const start = new Date(newStartsAt)
  if (isNaN(start.getTime())) return { error: "Data/hora inválida" }
  const { appt, error: gErr } = await gateAppointment(s, id)
  if (gErr || !appt) return { error: gErr ?? "Agendamento não encontrado" }
  const duration = new Date(appt.ends_at).getTime() - new Date(appt.starts_at).getTime()
  const end = new Date(start.getTime() + duration)
  const { error } = await supabaseAdmin.from("appointments")
    .update({ starts_at: start.toISOString(), ends_at: end.toISOString(), updated_at: new Date().toISOString() })
    .eq("tenant_id", s.tenantId).eq("id", id)
  if (error) {
    if (error.code === "23P01" || /exclusion|overlap/i.test(error.message)) return { error: "Esse horário acabou de ser preenchido" }
    return { error: error.message }
  }
  revalidatePath(ROUTE)
  return {}
}

export async function setAppointmentStatus(id: string, status: "scheduled" | "confirmed" | "done" | "no_show" | "canceled"): Promise<{ error?: string }> {
  const s = await agendaScope()
  const { error: gErr } = await gateAppointment(s, id)
  if (gErr) return { error: gErr }
  const { error } = await supabaseAdmin.from("appointments")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("tenant_id", s.tenantId).eq("id", id)
  if (error) return { error: error.message }
  revalidatePath(ROUTE)
  return {}
}

export async function cancelAppointment(id: string, reason?: string): Promise<{ error?: string }> {
  const s = await agendaScope()
  const { error: gErr } = await gateAppointment(s, id)
  if (gErr) return { error: gErr }
  const { error } = await supabaseAdmin.from("appointments")
    .update({ status: "canceled", notes: reason?.trim() || undefined, updated_at: new Date().toISOString() })
    .eq("tenant_id", s.tenantId).eq("id", id)
  if (error) return { error: error.message }
  revalidatePath(ROUTE)
  return {}
}

// ═══════════════════════════════════════════════════════════════
// PARTICIPANTES DO COMPROMISSO (co-host) — Fase 1 do controle de acesso
// ═══════════════════════════════════════════════════════════════
export interface AppointmentParticipant { user_id: string; full_name: string | null; role: string }

/** Lista de membros ativos pro seletor de co-host (acessível a qualquer atendente). */
export async function listAppointmentAgents(): Promise<{ user_id: string; full_name: string | null }[]> {
  const s = await agendaScope()
  const { data } = await supabaseAdmin.from("tenant_users")
    .select("user_id, profiles!tenant_users_user_id_fkey ( full_name )")
    .eq("tenant_id", s.tenantId).eq("active", true)
  return (data ?? []).map((r) => ({
    user_id: r.user_id,
    full_name: (r.profiles as unknown as { full_name: string | null } | null)?.full_name ?? null,
  }))
}

/** Participantes de um compromisso (gated: o ator precisa enxergar o compromisso). */
export async function listAppointmentParticipants(appointmentId: string): Promise<AppointmentParticipant[]> {
  const s = await agendaScope()
  if ((await gateAppointment(s, appointmentId)).error) return []
  const { data } = await supabaseAdmin.from("appointment_participants")
    .select("user_id, role, profiles!appointment_participants_user_id_fkey ( full_name )")
    .eq("tenant_id", s.tenantId).eq("appointment_id", appointmentId)
  return (data ?? []).map((r) => ({
    user_id: r.user_id, role: r.role as string,
    full_name: (r.profiles as unknown as { full_name: string | null } | null)?.full_name ?? null,
  }))
}

/** Inclui um colega no compromisso. Notifica o incluído; ponte opt-in pra conversa. */
export async function addAppointmentParticipant(appointmentId: string, userId: string, alsoConversation?: boolean): Promise<{ error?: string }> {
  const s = await agendaScope()
  const { error: gErr } = await gateAppointment(s, appointmentId)
  if (gErr) return { error: gErr }
  if (!(await assertAgentInTenant(s.tenantId, userId))) return { error: "Atendente inválido" }

  const { error: insErr } = await supabaseAdmin.from("appointment_participants").upsert(
    { appointment_id: appointmentId, tenant_id: s.tenantId, user_id: userId, role: "cohost", added_by: s.userId },
    { onConflict: "appointment_id,user_id" },
  )
  if (insErr) return { error: insErr.message }

  // Contexto pra notificação + ponte.
  const { data: full } = await supabaseAdmin.from("appointments")
    .select("conversation_id, tenant_resources ( name ), chat_contacts ( custom_name, push_name )")
    .eq("id", appointmentId).maybeSingle()
  const resName = (full?.tenant_resources as unknown as { name: string } | null)?.name ?? "Recurso"
  const contact = full?.chat_contacts as unknown as { custom_name: string | null; push_name: string | null } | null
  const who = contact?.custom_name || contact?.push_name || "Contato"

  // Avisa o incluído (sininho + push, via createNotification).
  await createNotification({
    tenantId: s.tenantId, recipientId: userId, type: "appt_created",
    title: "Você foi incluído num compromisso",
    body: `${who} · ${resName}`,
    payload: { appointment_id: appointmentId, conversation_id: full?.conversation_id ?? undefined },
  })

  // Ponte opt-in: também dar acesso à conversa do cliente (participants do chat).
  if (alsoConversation && full?.conversation_id) {
    const { data: conv } = await supabaseAdmin.from("chat_conversations").select("participants").eq("id", full.conversation_id).maybeSingle()
    const cur = (conv?.participants ?? []) as string[]
    if (!cur.includes(userId)) {
      await supabaseAdmin.from("chat_conversations").update({ participants: [...cur, userId] }).eq("id", full.conversation_id)
    }
  }

  revalidatePath(ROUTE)
  return {}
}

/** Remove um participante. (Não mexe na conversa — desfazer a ponte é ação separada.) */
export async function removeAppointmentParticipant(appointmentId: string, userId: string): Promise<{ error?: string }> {
  const s = await agendaScope()
  const { error: gErr } = await gateAppointment(s, appointmentId)
  if (gErr) return { error: gErr }
  await supabaseAdmin.from("appointment_participants").delete()
    .eq("tenant_id", s.tenantId).eq("appointment_id", appointmentId).eq("user_id", userId)
  revalidatePath(ROUTE)
  return {}
}

// ═══════════════════════════════════════════════════════════════
// COMPARTILHAMENTO DE AGENDA (delegação) — Fase 2 do controle de acesso
// ═══════════════════════════════════════════════════════════════
export interface ResourceShareRow { grantee_user_id: string; full_name: string | null; level: ShareLevel }

/** Só o DONO da agenda (recurso) ou um admin pode compartilhá-la. */
async function assertCanShareResource(s: ViewerScope, resourceId: string): Promise<{ error?: string }> {
  if (s.isAdmin) return {}
  const { data } = await supabaseAdmin.from("tenant_resources")
    .select("assigned_agent_id").eq("tenant_id", s.tenantId).eq("id", resourceId).maybeSingle()
  if (!data) return { error: "Agenda não encontrada" }
  if (data.assigned_agent_id !== s.userId) return { error: "Só o dono da agenda (ou um admin) pode compartilhá-la" }
  return {}
}

export async function listResourceShares(resourceId: string): Promise<ResourceShareRow[]> {
  const s = await agendaScope()
  if ((await assertCanShareResource(s, resourceId)).error) return []
  const { data } = await supabaseAdmin.from("resource_shares")
    .select("grantee_user_id, level, profiles!resource_shares_grantee_user_id_fkey ( full_name )")
    .eq("tenant_id", s.tenantId).eq("resource_id", resourceId)
  return (data ?? []).map((r) => ({
    grantee_user_id: r.grantee_user_id, level: r.level as ShareLevel,
    full_name: (r.profiles as unknown as { full_name: string | null } | null)?.full_name ?? null,
  }))
}

/** Compartilha (ou muda o nível) da agenda com um colega. Gated pelo dono/admin. */
export async function upsertResourceShare(resourceId: string, userId: string, level: ShareLevel): Promise<{ error?: string }> {
  const s = await agendaScope()
  const g = await assertCanShareResource(s, resourceId); if (g.error) return g
  if (!(["free_busy", "details", "manage"] as ShareLevel[]).includes(level)) return { error: "Nível inválido" }
  if (!(await assertAgentInTenant(s.tenantId, userId))) return { error: "Atendente inválido" }
  const { error } = await supabaseAdmin.from("resource_shares").upsert(
    { resource_id: resourceId, tenant_id: s.tenantId, grantee_user_id: userId, level, granted_by: s.userId },
    { onConflict: "resource_id,grantee_user_id" },
  )
  if (error) return { error: error.message }
  await logAudit({ tenantId: s.tenantId, actorId: s.userId, action: "agenda.share.set", targetType: "tenant_resources", targetId: resourceId, metadata: { grantee_user_id: userId, level } })
  revalidatePath(ROUTE)
  return {}
}

export async function removeResourceShare(resourceId: string, userId: string): Promise<{ error?: string }> {
  const s = await agendaScope()
  const g = await assertCanShareResource(s, resourceId); if (g.error) return g
  await supabaseAdmin.from("resource_shares").delete()
    .eq("tenant_id", s.tenantId).eq("resource_id", resourceId).eq("grantee_user_id", userId)
  await logAudit({ tenantId: s.tenantId, actorId: s.userId, action: "agenda.share.remove", targetType: "tenant_resources", targetId: resourceId, metadata: { grantee_user_id: userId } })
  revalidatePath(ROUTE)
  return {}
}

/** Define (ou tira com "none") o nível de acesso da EQUIPE INTEIRA ("todos") a uma agenda. Dono/admin. */
export async function setResourceEveryoneLevel(resourceId: string, level: ShareLevel | "none"): Promise<{ error?: string }> {
  const s = await agendaScope()
  const g = await assertCanShareResource(s, resourceId); if (g.error) return g
  const value = level === "none" ? null : level
  const { error } = await supabaseAdmin.from("tenant_resources")
    .update({ share_everyone_level: value }).eq("tenant_id", s.tenantId).eq("id", resourceId)
  if (error) return { error: error.message }
  await logAudit({ tenantId: s.tenantId, actorId: s.userId, action: "agenda.share.everyone", targetType: "tenant_resources", targetId: resourceId, metadata: { level: value } })
  revalidatePath(ROUTE)
  return {}
}

// ── Auto-provisão: agenda pessoal de cada agente novo ────────
// Padrão: nome = nome do usuário · seg–sex 07–20 · capacidade 1 · horizonte 60 ·
// a equipe vê "Restrita" (livre/ocupado). Idempotente; só roda com o módulo agenda
// ligado; best-effort (não derruba o cadastro). NÃO faz backfill (só agentes novos).
const DEFAULT_AGENDA_HOURS: WorkingHoursDay[] = [1, 2, 3, 4, 5].map((day) => ({ day, intervals: [["07:00", "20:00"]] as [string, string][] }))

export async function provisionAgentAgenda(tenantId: string, userId: string): Promise<void> {
  try {
    if (!(await hasModule(tenantId, "agenda"))) return
    const { data: existing } = await supabaseAdmin.from("tenant_resources")
      .select("id").eq("tenant_id", tenantId).eq("assigned_agent_id", userId).maybeSingle()
    if (existing) return   // já tem agenda
    const { data: profile } = await supabaseAdmin.from("profiles").select("full_name").eq("id", userId).maybeSingle()
    await supabaseAdmin.from("tenant_resources").insert({
      tenant_id: tenantId, name: profile?.full_name?.trim() || "Minha agenda", kind: null, capacity: 1,
      working_hours: DEFAULT_AGENDA_HOURS, slot_minutes: 30, timezone: "America/Sao_Paulo",
      assigned_agent_id: userId, min_lead_minutes: 0, max_horizon_days: 60,
      share_everyone_level: "free_busy", active: true,
    })
  } catch (err) {
    console.error("[provisionAgentAgenda]", err)
  }
}

// ── Visão POR-PESSOA (pro Sheet de Equipe): "quais agendas esta pessoa acessa" ──
export interface MemberAgendaAccess { resource_id: string; name: string; level: ShareLevel | null }

/** Admin: agendas do tenant + o nível que ESTE membro tem em cada. Vazio se não-admin / sem agendas. */
export async function listMemberAgendaAccess(memberUserId: string): Promise<MemberAgendaAccess[]> {
  const s = await getViewerScope()   // leitura: não exige o módulo (tenant sem agenda → sem recursos → [])
  if (!s.isAdmin) return []
  const [resR, shR] = await Promise.all([
    supabaseAdmin.from("tenant_resources").select("id, name, assigned_agent_id").eq("tenant_id", s.tenantId).eq("active", true).order("name"),
    supabaseAdmin.from("resource_shares").select("resource_id, level").eq("tenant_id", s.tenantId).eq("grantee_user_id", memberUserId),
  ])
  const lvl = new Map((shR.data ?? []).map((r) => [r.resource_id as string, r.level as ShareLevel]))
  return (resR.data ?? [])
    .filter((r) => r.assigned_agent_id !== memberUserId)   // não lista a própria agenda do membro
    .map((r) => ({ resource_id: r.id as string, name: r.name as string, level: lvl.get(r.id as string) ?? null }))
}

/** Admin: define (ou remove com "none") o nível de acesso do membro a uma agenda. Reusa o CRUD gated. */
export async function setMemberAgendaAccess(memberUserId: string, resourceId: string, level: ShareLevel | "none"): Promise<{ error?: string }> {
  return level === "none"
    ? removeResourceShare(resourceId, memberUserId)
    : upsertResourceShare(resourceId, memberUserId, level)
}

// ── Agendamentos de um CONTATO (pra a sidebar do chat) ───────
export interface ContactAppt {
  id: string; starts_at: string; ends_at: string; status: string
  service_name: string | null; resource_name: string | null
}

/**
 * Compromissos de um contato (visíveis ao viewer, nível ≥ detalhes) + as agendas/
 * serviços ativos (pro modal de novo agendamento). `enabled=false` se o tenant não
 * tem o módulo agenda → a sidebar esconde o bloco.
 */
export async function getContactAppointments(contactId: string): Promise<{
  enabled: boolean; items: ContactAppt[]; resources: ResourceRow[]; services: ServiceRow[]
}> {
  const s = await getViewerScope()
  if (!(await hasModule(s.tenantId, "agenda"))) return { enabled: false, items: [], resources: [], services: [] }

  const { data: rows } = await supabaseAdmin.from("appointments")
    .select(`id, resource_id, starts_at, ends_at, status, tenant_services(name), tenant_resources(name, assigned_agent_id, share_everyone_level), created_by, chat_conversations(instance_id, assigned_to, participants, department_id)`)
    .eq("tenant_id", s.tenantId).eq("contact_id", contactId).order("starts_at", { ascending: false })

  type Row = ApptVisibility & { id: string; resource_id: string; starts_at: string; ends_at: string; status: string; tenant_services: { name: string | null } | null; tenant_resources: { name: string | null; assigned_agent_id: string | null; share_everyone_level: ShareLevel | null } | null }
  const all = (rows ?? []) as unknown as Row[]

  let visible = all
  if (!s.isAdmin) {
    const shareMap = await viewerShareMap(s)
    const ids = all.map((a) => a.id)
    let coSet = new Set<string>()
    if (ids.length) {
      const { data: parts } = await supabaseAdmin.from("appointment_participants")
        .select("appointment_id").eq("tenant_id", s.tenantId).eq("user_id", s.userId).in("appointment_id", ids)
      coSet = new Set((parts ?? []).map((p) => p.appointment_id as string))
    }
    visible = all.filter((a) => LEVEL_RANK[appointmentLevel(s, a, shareMap.get(a.resource_id), coSet.has(a.id))] >= LEVEL_RANK.details)
  }

  const items: ContactAppt[] = visible.map((a) => ({
    id: a.id, starts_at: a.starts_at, ends_at: a.ends_at, status: a.status,
    service_name: a.tenant_services?.name ?? null, resource_name: a.tenant_resources?.name ?? null,
  }))

  const [resR, svcR] = await Promise.all([
    supabaseAdmin.from("tenant_resources").select("*").eq("tenant_id", s.tenantId).eq("active", true).order("name"),
    supabaseAdmin.from("tenant_services").select("*").eq("tenant_id", s.tenantId).eq("active", true).order("name"),
  ])
  return {
    enabled: true, items,
    resources: (resR.data ?? []) as unknown as ResourceRow[],
    services: (svcR.data ?? []) as unknown as ServiceRow[],
  }
}
