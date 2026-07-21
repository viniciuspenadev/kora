"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope, type ViewerScope } from "@/lib/visibility"
import { requireModule, hasModule } from "@/lib/modules"
import { createNotification } from "@/lib/notifications"
import { logAudit } from "@/lib/audit"
import { ensureAgendaConfirmTemplate, agendaConfirmStatus, type AgendaTemplateStatus } from "@/lib/agenda/official-template"
import type { WorkingHoursDay } from "@/lib/agenda/availability"
import { availabilitySlots, bookAppointment, moveAppointment } from "@/lib/agenda/booking"
import { recordAppointmentEvent } from "@/lib/agenda/events"
import {
  LEVEL_RANK, APPT_VISIBILITY_SELECT,
  appointmentLevel, isAppointmentParticipant, viewerShareLevel, viewerShareMap, resourceLevel,
  type ApptVisibility,
} from "@/lib/agenda/access"
import type { AccessLevel as AccessLevelSrc, ShareLevel as ShareLevelSrc } from "@/lib/agenda/access"
import { after } from "next/server"

// Escada re-exportada pros consumidores existentes como ALIAS DECLARADO.
// ⚠️ NÃO trocar por `export type { X } from ...`: o coletor de server actions do
// Turbopack trata a cláusula como export de runtime num arquivo "use server" e
// o build quebra ("Export X doesn't exist"). Alias declarado é inequívoco.
export type AccessLevel = AccessLevelSrc
export type ShareLevel = ShareLevelSrc

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

/** Filtra um patch pra SÓ as chaves permitidas (defined) — barra mass-assignment
 *  (tenant_id/id/role viajando no spread). `Partial<>` some em runtime. */
function pickDefined<T extends object, K extends keyof T>(patch: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {}
  for (const k of keys) if (k in patch && patch[k] !== undefined) out[k] = patch[k]
  return out
}

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

// ── Visibilidade de compromisso — escada de níveis (fonte ÚNICA, leitura E escrita) ──
// EXTRAÍDA pra src/lib/agenda/access.ts (compartilhada com a extensão /api/ext).
// Este arquivo só consome: appointmentLevel/viewerShareMap/etc. vêm do import acima.

/**
 * Carrega um compromisso por id E gateia o ator pra MUTAÇÃO (exige nível ≥ details —
 * "livre/ocupado" é só leitura). O id sozinho nunca basta (defesa em profundidade vs IDOR).
 */
async function gateAppointment(s: ViewerScope, id: string): Promise<{ appt?: { starts_at: string; ends_at: string; resource_id: string; status: string }; error?: string }> {
  const { data } = await supabaseAdmin.from("appointments")
    .select(`starts_at, ends_at, resource_id, status, ${APPT_VISIBILITY_SELECT}`)
    .eq("tenant_id", s.tenantId).eq("id", id).maybeSingle()
  if (!data) return { error: "Agendamento não encontrado" }
  const resourceId = (data as { resource_id: string }).resource_id
  const [isCo, share] = await Promise.all([isAppointmentParticipant(s, id), viewerShareLevel(s, resourceId)])
  const level = appointmentLevel(s, data as unknown as ApptVisibility, share, isCo)
  if (LEVEL_RANK[level] < LEVEL_RANK.details) {
    return { error: level === "free_busy" ? "Você só tem acesso de leitura (livre/ocupado) a esta agenda" : "Você não tem acesso a este agendamento" }
  }
  return { appt: data as unknown as { starts_at: string; ends_at: string; resource_id: string; status: string } }
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

/**
 * Recursos que o viewer pode VER (nível ≥ livre/ocupado) — alimenta o board,
 * seletores de marcação/bloqueio e a Semana. Owner 2026-07-18: agenda restrita
 * não vira coluna (coluna vazia mentia "livre o dia todo" + vazava a existência).
 * Admin/view_all seguem vendo tudo pela própria escada.
 */
export async function listVisibleResources(): Promise<ResourceRow[]> {
  const s = await getViewerScope()
  const [all, shares] = await Promise.all([listResources(), viewerShareMap(s)])
  return all.filter((r) => LEVEL_RANK[resourceLevel(s, r, shares.get(r.id))] >= LEVEL_RANK.free_busy)
}

/** Gate de escrita em agenda-alvo: marcar/mover PARA uma agenda exige vê-la (≥ livre/ocupado). */
async function assertResourceVisible(s: ViewerScope, resourceId: string): Promise<string | null> {
  const { data: r } = await supabaseAdmin.from("tenant_resources")
    .select("assigned_agent_id, share_everyone_level").eq("tenant_id", s.tenantId).eq("id", resourceId).maybeSingle()
  if (!r) return "Agenda não encontrada"
  const share = await viewerShareLevel(s, resourceId)
  if (LEVEL_RANK[resourceLevel(s, r as { assigned_agent_id: string | null; share_everyone_level: ShareLevel | null }, share)] < LEVEL_RANK.free_busy) {
    return "Você não tem acesso a essa agenda"
  }
  return null
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
  // Allow-list explícita: `Partial<>` some em runtime — sem isso o cliente poderia
  // spread `tenant_id`/`id` e mover o recurso pro tenant de outro (auditoria M2).
  const fields = pickDefined(patch, [
    "name", "kind", "capacity", "working_hours", "slot_minutes", "timezone",
    "assigned_agent_id", "min_lead_minutes", "max_horizon_days", "active",
  ])
  const { error } = await supabaseAdmin.from("tenant_resources")
    .update({ ...fields, updated_at: new Date().toISOString() })
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
  // Allow-list explícita (mesma razão do updateResource — auditoria M2).
  const fields = pickDefined(patch, [
    "name", "duration_minutes", "buffer_before_minutes", "buffer_after_minutes",
    "resource_ids", "price", "reminder_policy", "active",
  ])
  const { error } = await supabaseAdmin.from("tenant_services")
    .update({ ...fields, updated_at: new Date().toISOString() })
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
  const rows = data ?? []
  if (s.isAdmin) return rows

  // Inspeção 2026-07-18: o MOTIVO do bloqueio é dado pessoal do colega — só sai
  // pra quem tem nível ≥ detalhes naquela agenda (o HORÁRIO bloqueado sai pra
  // todos: é exatamente o que "livre/ocupado" garante). Tenant-wide (feriado)
  // é público por natureza. A UI cai no rótulo "Bloqueio" quando reason=null.
  const [resR, shares] = await Promise.all([
    supabaseAdmin.from("tenant_resources").select("id, assigned_agent_id, share_everyone_level").eq("tenant_id", s.tenantId),
    viewerShareMap(s),
  ])
  const levelByRes = new Map((resR.data ?? []).map((r) => [
    r.id as string,
    resourceLevel(s, r as { assigned_agent_id: string | null; share_everyone_level: ShareLevel | null }, shares.get(r.id as string)),
  ]))
  return rows.map((b) => {
    if (!b.resource_id) return b
    const lvl = levelByRes.get(b.resource_id) ?? "none"
    return LEVEL_RANK[lvl] >= LEVEL_RANK.details ? b : { ...b, reason: null }
  })
}

/**
 * Quem pode gerenciar um bloqueio (Agenda 2.0 — pedido do owner 2026-07-17):
 * admin = qualquer um (inclusive tenant-wide) · atendente = SÓ da agenda ATRIBUÍDA
 * a ele (folga da própria agenda). Fail-closed: recurso inexistente/alheio barra.
 */
async function assertCanManageBlackout(s: ViewerScope, resourceId: string | null): Promise<string | null> {
  if (s.isAdmin) return null
  if (!resourceId) return "Só owner/admin bloqueiam a empresa inteira"
  const { data } = await supabaseAdmin.from("tenant_resources")
    .select("assigned_agent_id").eq("tenant_id", s.tenantId).eq("id", resourceId).maybeSingle()
  if (!data) return "Agenda não encontrada"
  if (data.assigned_agent_id !== s.userId) return "Você só pode bloquear a sua própria agenda"
  return null
}

export async function createBlackout(input: { resource_id?: string | null; starts_at: string; ends_at: string; reason?: string }): Promise<{ error?: string }> {
  const s = await agendaScope()
  const denied = await assertCanManageBlackout(s, input.resource_id ?? null)
  if (denied) return { error: denied }
  if (new Date(input.ends_at) <= new Date(input.starts_at)) return { error: "Fim deve ser depois do início" }
  const { error } = await supabaseAdmin.from("tenant_blackouts").insert({
    tenant_id: s.tenantId, resource_id: input.resource_id ?? null,
    starts_at: input.starts_at, ends_at: input.ends_at, reason: input.reason?.trim() || null,
  })
  if (error) return { error: error.message }
  await logAudit({ tenantId: s.tenantId, actorId: s.userId, action: "agenda.blackout.create", targetType: "tenant_blackouts", targetId: input.resource_id ?? "tenant", metadata: { starts_at: input.starts_at, ends_at: input.ends_at } })
  revalidatePath(ROUTE)
  return {}
}

export async function deleteBlackout(id: string): Promise<{ error?: string }> {
  const s = await agendaScope()
  const { data: blk } = await supabaseAdmin.from("tenant_blackouts")
    .select("resource_id").eq("tenant_id", s.tenantId).eq("id", id).maybeSingle()
  if (!blk) return { error: "Bloqueio não encontrado" }
  const denied = await assertCanManageBlackout(s, blk.resource_id as string | null)
  if (denied) return { error: denied }
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

/**
 * Redige um compromisso pro nível "livre/ocupado": SÓ horário + recurso.
 * Inspeção 2026-07-18: redigir também status/source/created_by/conversa —
 * a tela já era neutra, mas o PAYLOAD vazava (devtools). "Livre/ocupado"
 * vale no fio, não só no pixel.
 */
function redactBusy(a: AppointmentRow & ApptVisibility): AppointmentRow {
  const r = { ...(a as unknown as Record<string, unknown>) }
  r.contact_id = ""; r.conversation_id = null; r.service_id = null; r.notes = null
  r.chat_contacts = null; r.tenant_services = null; r.chat_conversations = null
  r.status = "scheduled"; r.source = "manual"; r.created_by = null
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
  // Política (owner 2026-07-18): marcar NUMA agenda exige vê-la (≥ livre/ocupado).
  const denied = await assertResourceVisible(s, input.resourceId)
  if (denied) return { error: denied }
  // Delega ao núcleo server-less (DRY — mesmo motor que a capability do Studio usa).
  const r = await bookAppointment(s.tenantId, { ...input, createdBy: s.userId })
  if (r.error) return { error: r.error }
  revalidatePath(ROUTE)
  return { id: r.id }
}

/**
 * Remarca (gesto de drag, select de horário ou troca de agenda no modal).
 * UNIFICADO na porta única (Agenda 2.0 F2): `moveAppointment` cuida de bloqueio,
 * EXCLUDE, status→scheduled, evento, rearme de lembretes e RE-CONFIRMAÇÃO
 * (resendConfirm — gates de módulo/switch fail-closed lá dentro).
 * `resourceId` opcional = mover também de agenda (drag entre colunas no Dia).
 */
export async function rescheduleAppointment(id: string, newStartsAt: string, resourceId?: string): Promise<{ error?: string }> {
  const s = await agendaScope()
  const { error: gErr } = await gateAppointment(s, id)
  if (gErr) return { error: gErr }
  if (resourceId) {   // mover PARA outra agenda exige vê-la (mesma política do criar)
    const denied = await assertResourceVisible(s, resourceId)
    if (denied) return { error: denied }
  }
  const r = await moveAppointment(s.tenantId, id, newStartsAt, {
    actorUserId: s.userId, resourceId: resourceId ?? null, resendConfirm: true,
  })
  if (r.error) return { error: r.error }
  revalidatePath(ROUTE)
  return {}
}

/**
 * Estica/encolhe a duração (gesto de resize, passos de 15min). NÃO muda o início →
 * lembretes continuam válidos (sem rearme, sem re-confirmação); só o evento `resized`.
 */
export async function resizeAppointment(id: string, durationMinutes: number): Promise<{ error?: string }> {
  const s = await agendaScope()
  const dur = Math.round(durationMinutes)
  if (!Number.isFinite(dur) || dur < 15 || dur > 12 * 60) return { error: "Duração inválida" }
  const { appt, error: gErr } = await gateAppointment(s, id)
  if (gErr || !appt) return { error: gErr ?? "Agendamento não encontrado" }
  const prevMin = Math.round((new Date(appt.ends_at).getTime() - new Date(appt.starts_at).getTime()) / 60_000)
  if (prevMin === dur) return {}
  const start = new Date(appt.starts_at)
  const end = new Date(start.getTime() + dur * 60_000)
  // Não estica por cima de bloqueio (folga/feriado) — o EXCLUDE não cobre blackout;
  // o moveAppointment já checa, o resize não checava (auditoria B2).
  if (dur > prevMin) {
    const { count: blocked } = await supabaseAdmin.from("tenant_blackouts")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", s.tenantId)
      .or(`resource_id.eq.${appt.resource_id},resource_id.is.null`)
      .lt("starts_at", end.toISOString()).gt("ends_at", start.toISOString())
    if (blocked && blocked > 0) return { error: "Não dá pra esticar por cima de um bloqueio (folga/feriado)" }
  }
  const { error } = await supabaseAdmin.from("appointments")
    .update({ ends_at: end.toISOString(), updated_at: new Date().toISOString() })
    .eq("tenant_id", s.tenantId).eq("id", id)
  if (error) {
    if (error.code === "23P01" || /exclusion|overlap/i.test(error.message)) return { error: "Não dá pra esticar por cima do próximo horário" }
    return { error: error.message }
  }
  await recordAppointmentEvent({
    tenantId: s.tenantId, appointmentId: id, type: "resized",
    actorUserId: s.userId, payload: { from_minutes: prevMin, to_minutes: dur },
  })
  revalidatePath(ROUTE)
  return {}
}

/**
 * Troca o SERVIÇO do compromisso (edição inline no modal). Duração e horário
 * ficam como estão (decisão do protótipo aprovado); só o evento `service_changed`.
 */
export async function updateAppointmentService(id: string, serviceId: string | null): Promise<{ error?: string }> {
  const s = await agendaScope()
  const { error: gErr } = await gateAppointment(s, id)
  if (gErr) return { error: gErr }
  if (serviceId) {
    const { data: svc } = await supabaseAdmin.from("tenant_services")
      .select("id").eq("tenant_id", s.tenantId).eq("id", serviceId).eq("active", true).maybeSingle()
    if (!svc) return { error: "Serviço não encontrado" }
  }
  const { error } = await supabaseAdmin.from("appointments")
    .update({ service_id: serviceId, updated_at: new Date().toISOString() })
    .eq("tenant_id", s.tenantId).eq("id", id)
  if (error) return { error: error.message }
  await recordAppointmentEvent({
    tenantId: s.tenantId, appointmentId: id, type: "service_changed",
    actorUserId: s.userId, payload: { to: serviceId },
  })
  revalidatePath(ROUTE)
  return {}
}

const APPT_STATUSES = ["scheduled", "confirmed", "done", "no_show", "canceled"] as const

export async function setAppointmentStatus(id: string, status: "scheduled" | "confirmed" | "done" | "no_show" | "canceled"): Promise<{ error?: string }> {
  const s = await agendaScope()
  // A união TS some em runtime — valida contra o set permitido (sem CHECK no banco,
  // um cliente gravaria status arbitrário; auditoria B1).
  if (!(APPT_STATUSES as readonly string[]).includes(status)) return { error: "Status inválido" }
  const { appt, error: gErr } = await gateAppointment(s, id)
  if (gErr || !appt) return { error: gErr ?? "Agendamento não encontrado" }
  const { error } = await supabaseAdmin.from("appointments")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("tenant_id", s.tenantId).eq("id", id)
  if (error) return { error: error.message }
  if (status !== appt.status) {
    await recordAppointmentEvent({
      tenantId: s.tenantId, appointmentId: id,
      type: status === "canceled" ? "canceled" : "status_changed",
      actorUserId: s.userId, payload: { from: appt.status, to: status },
    })
  }
  revalidatePath(ROUTE)
  return {}
}

export async function cancelAppointment(id: string, reason?: string): Promise<{ error?: string }> {
  const s = await agendaScope()
  const { appt, error: gErr } = await gateAppointment(s, id)
  if (gErr || !appt) return { error: gErr ?? "Agendamento não encontrado" }
  const { error } = await supabaseAdmin.from("appointments")
    .update({ status: "canceled", notes: reason?.trim() || undefined, updated_at: new Date().toISOString() })
    .eq("tenant_id", s.tenantId).eq("id", id)
  if (error) return { error: error.message }
  await recordAppointmentEvent({
    tenantId: s.tenantId, appointmentId: id, type: "canceled",
    actorUserId: s.userId, payload: { from: appt.status, reason: reason?.trim() || null },
  })
  revalidatePath(ROUTE)
  return {}
}

// ═══════════════════════════════════════════════════════════════
// NOTAS + HISTÓRICO (Agenda 2.0 — F1) — doc: docs/agenda-2-0-design.md §1,§3
// ═══════════════════════════════════════════════════════════════
// Feed de notas internas (append-only) + timeline de eventos da ficha. Ambos
// GATED pela MESMA escada de visibilidade (gateAppointment ≥ details): quem só
// tem "livre/ocupado" nem lê. A escrita é exclusiva do service role (RLS das
// tabelas é SELECT-only pro papel autenticado — não tente escrever com client
// de sessão). Toda nota também vira evento `note_added` na espinha (porta única).

export interface AppointmentEventRow {
  id: string; type: string
  actor_user_id: string | null; actor_label: string | null
  actor_name: string | null                 // full_name do autor quando há usuário
  payload: Record<string, unknown>; created_at: string
}
export interface AppointmentNoteRow {
  id: string; body: string
  author_user_id: string | null; author_name: string | null
  created_at: string
}

/** Timeline de auditoria do compromisso (created_at asc). [] se sem acesso. */
export async function listAppointmentEvents(appointmentId: string): Promise<AppointmentEventRow[]> {
  const s = await agendaScope()
  if ((await gateAppointment(s, appointmentId)).error) return []
  const { data } = await supabaseAdmin.from("appointment_events")
    .select("id, type, actor_user_id, actor_label, payload, created_at, profiles!appointment_events_actor_user_id_fkey ( full_name )")
    .eq("tenant_id", s.tenantId).eq("appointment_id", appointmentId)
    .order("created_at", { ascending: true })
  type Row = { id: string; type: string; actor_user_id: string | null; actor_label: string | null; payload: Record<string, unknown> | null; created_at: string; profiles: { full_name: string | null } | null }
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id, type: r.type,
    actor_user_id: r.actor_user_id ?? null, actor_label: r.actor_label ?? null,
    actor_name: r.profiles?.full_name ?? null,
    payload: r.payload ?? {}, created_at: r.created_at,
  }))
}

/** Feed de notas internas do compromisso (created_at asc). [] se sem acesso. */
export async function listAppointmentNotes(appointmentId: string): Promise<AppointmentNoteRow[]> {
  const s = await agendaScope()
  if ((await gateAppointment(s, appointmentId)).error) return []
  const { data } = await supabaseAdmin.from("appointment_notes")
    .select("id, body, author_user_id, created_at, profiles!appointment_notes_author_user_id_fkey ( full_name )")
    .eq("tenant_id", s.tenantId).eq("appointment_id", appointmentId)
    .order("created_at", { ascending: true })
  type Row = { id: string; body: string; author_user_id: string | null; created_at: string; profiles: { full_name: string | null } | null }
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id, body: r.body,
    author_user_id: r.author_user_id ?? null, author_name: r.profiles?.full_name ?? null,
    created_at: r.created_at,
  }))
}

/** Adiciona uma nota (author = viewer) e registra o evento `note_added`. Gated ≥ details. */
export async function addAppointmentNote(appointmentId: string, body: string): Promise<{ error?: string; id?: string }> {
  const s = await agendaScope()
  const text = body?.trim()
  if (!text) return { error: "Escreva algo na nota" }
  const { error: gErr } = await gateAppointment(s, appointmentId)
  if (gErr) return { error: gErr }
  const { data, error } = await supabaseAdmin.from("appointment_notes")
    .insert({ tenant_id: s.tenantId, appointment_id: appointmentId, author_user_id: s.userId, body: text })
    .select("id").single()
  if (error) return { error: error.message }
  await recordAppointmentEvent({
    tenantId: s.tenantId, appointmentId, type: "note_added",
    actorUserId: s.userId, payload: { preview: text.slice(0, 80) },
  })
  revalidatePath(ROUTE)
  return { id: data.id as string }
}

/**
 * Subconjunto dos ids dados que têm ≥1 nota — alimenta o selo 📝 do board.
 * Inspeção 2026-07-18: gated pela ESCADA (nível ≥ detalhes por compromisso) —
 * presença de nota também é metadado; linha "Ocupado" não pode nem insinuar.
 */
export async function getAppointmentNoteFlags(appointmentIds: string[]): Promise<string[]> {
  const s = await getViewerScope()
  if (appointmentIds.length === 0) return []

  let allowed = appointmentIds
  if (!s.isAdmin) {
    const { data: rows } = await supabaseAdmin.from("appointments")
      .select(`id, resource_id, ${APPT_VISIBILITY_SELECT}`)
      .eq("tenant_id", s.tenantId).in("id", appointmentIds)
    const list = (rows ?? []) as unknown as ({ id: string; resource_id: string } & ApptVisibility)[]
    let coSet = new Set<string>()
    if (list.length) {
      const { data: parts } = await supabaseAdmin.from("appointment_participants")
        .select("appointment_id").eq("tenant_id", s.tenantId).eq("user_id", s.userId)
        .in("appointment_id", list.map((r) => r.id))
      coSet = new Set((parts ?? []).map((p) => p.appointment_id as string))
    }
    const shares = await viewerShareMap(s)
    allowed = list
      .filter((r) => LEVEL_RANK[appointmentLevel(s, r, shares.get(r.resource_id), coSet.has(r.id))] >= LEVEL_RANK.details)
      .map((r) => r.id)
    if (allowed.length === 0) return []
  }

  const { data } = await supabaseAdmin.from("appointment_notes")
    .select("appointment_id")
    .eq("tenant_id", s.tenantId).in("appointment_id", allowed)
  return Array.from(new Set((data ?? []).map((r) => r.appointment_id as string)))
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

// Auto-provisão da agenda pessoal (provisionAgentAgenda) MOVIDA pra módulo
// server-only [src/lib/agenda/provision.ts] — não pode ser export de "use server"
// (viraria endpoint com tenantId/userId controlados pelo cliente; auditoria M1).

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

// ═══════════════════════════════════════════════════════════════
// KPIs da Visão Geral (Agenda 2.0 F4) — doc: docs/agenda-2-0-design.md §1
// ═══════════════════════════════════════════════════════════════
// SÓ números agregados — zero PII. Escopo (decisão de segurança): admin vê o
// tenant inteiro; atendente vê SÓ as agendas atribuídas a ele (aproximação
// documentada — a escada fina por-compromisso não se aplica a agregados).
// Janelas: ocupação/receita = SEMANA ATUAL (seg–dom, -03) · no-show e % IA =
// últimos 30d · confirmação = PRÓXIMOS 7d (métrica de ação da recepção) ·
// remarcações = últimos 7d (espinha de eventos).

export interface AgendaKpis {
  occupancyPct: number | null; bookedMinutes: number; availableMinutes: number
  noShowPct: number | null; noShowCount: number; finishedCount: number
  confirmPct: number | null; confirmedUpcoming: number; pendingUpcoming: number
  reschedules7d: number
  aiSharePct: number | null; aiCount: number; createdCount: number
  expectedRevenue: number   // R$ (numeric somado) da semana atual
  /** Pulso de HOJE (dia corrente −03, sempre — independe do dia selecionado no mini-calendário). */
  todayTotal: number; todayConfirmed: number; todayPending: number; todayDone: number; todayNoShow: number
}

const KPI_TZ = "America/Sao_Paulo"
const ACTIVE_KPI_STATUSES = ["scheduled", "confirmed", "done"]

/** Início (seg 00:00 −03) da semana corrente. Brasil sem DST → offset fixo é seguro. */
function currentWeekStart(): Date {
  const wall = new Date(new Date().toLocaleString("en-US", { timeZone: KPI_TZ }))
  const monday = new Date(wall)
  monday.setDate(wall.getDate() - ((wall.getDay() + 6) % 7))
  const y = monday.getFullYear(), m = String(monday.getMonth() + 1).padStart(2, "0"), d = String(monday.getDate()).padStart(2, "0")
  return new Date(`${y}-${m}-${d}T00:00:00-03:00`)
}

/** 00:00 −03 do dia corrente (mesma técnica da semana). */
function todayStartTz(): Date {
  const wall = new Date(new Date().toLocaleString("en-US", { timeZone: KPI_TZ }))
  const y = wall.getFullYear(), m = String(wall.getMonth() + 1).padStart(2, "0"), d = String(wall.getDate()).padStart(2, "0")
  return new Date(`${y}-${m}-${d}T00:00:00-03:00`)
}

const hhmmToMin = (t: string): number => {
  const [h, m] = t.split(":").map(Number)
  return (h || 0) * 60 + (m || 0)
}

export async function getAgendaKpis(): Promise<AgendaKpis | null> {
  const s = await getViewerScope()
  if (!(await hasModule(s.tenantId, "agenda"))) return null

  const { data: resAll } = await supabaseAdmin.from("tenant_resources")
    .select("id, working_hours, assigned_agent_id, share_everyone_level")
    .eq("tenant_id", s.tenantId).eq("active", true)
  // Inspeção 2026-07-18 — escopo alinhado à ESCADA: admin e supervisor (view_all)
  // contam o tenant; atendente conta as agendas que GERENCIA (dele + delegação manage).
  const kpiShares = await viewerShareMap(s)
  const scoped = (resAll ?? []).filter((r) =>
    s.isAdmin || s.viewAll ||
    resourceLevel(s, r as { assigned_agent_id: string | null; share_everyone_level: ShareLevel | null }, kpiShares.get(r.id as string)) === "manage")
  const resourceIds = scoped.map((r) => r.id as string)
  if (resourceIds.length === 0) {
    return { occupancyPct: null, bookedMinutes: 0, availableMinutes: 0, noShowPct: null, noShowCount: 0, finishedCount: 0, confirmPct: null, confirmedUpcoming: 0, pendingUpcoming: 0, reschedules7d: 0, aiSharePct: null, aiCount: 0, createdCount: 0, expectedRevenue: 0, todayTotal: 0, todayConfirmed: 0, todayPending: 0, todayDone: 0, todayNoShow: 0 }
  }

  const now = new Date()
  const weekStart = currentWeekStart()
  const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000)
  const d30ago = new Date(now.getTime() - 30 * 86_400_000)
  const d7ago = new Date(now.getTime() - 7 * 86_400_000)
  const d7fwd = new Date(now.getTime() + 7 * 86_400_000)

  const todayStart = todayStartTz()
  const todayEnd = new Date(todayStart.getTime() + 86_400_000)

  const [weekR, finishedR, upcomingR, createdR, svcR, todayR] = await Promise.all([
    supabaseAdmin.from("appointments")
      .select("starts_at, ends_at, service_id, status")
      .eq("tenant_id", s.tenantId).in("resource_id", resourceIds)
      .in("status", ACTIVE_KPI_STATUSES)
      .gte("starts_at", weekStart.toISOString()).lt("starts_at", weekEnd.toISOString()),
    supabaseAdmin.from("appointments")
      .select("status", { count: "exact" })
      .eq("tenant_id", s.tenantId).in("resource_id", resourceIds)
      .in("status", ["done", "no_show"])
      .gte("starts_at", d30ago.toISOString()).lte("starts_at", now.toISOString()),
    supabaseAdmin.from("appointments")
      .select("status")
      .eq("tenant_id", s.tenantId).in("resource_id", resourceIds)
      .in("status", ["scheduled", "confirmed"])
      .gte("starts_at", now.toISOString()).lt("starts_at", d7fwd.toISOString()),
    supabaseAdmin.from("appointments")
      .select("source")
      .eq("tenant_id", s.tenantId).in("resource_id", resourceIds)
      .neq("status", "canceled")
      .gte("created_at", d30ago.toISOString()),
    supabaseAdmin.from("tenant_services")
      .select("id, price").eq("tenant_id", s.tenantId),
    supabaseAdmin.from("appointments")
      .select("status")
      .eq("tenant_id", s.tenantId).in("resource_id", resourceIds)
      .neq("status", "canceled")
      .gte("starts_at", todayStart.toISOString()).lt("starts_at", todayEnd.toISOString()),
  ])

  // Remarcações 7d — pela espinha de eventos; escopo por appointment das agendas visadas.
  let reschedules7d = 0
  {
    const { data: apptIds } = await supabaseAdmin.from("appointments")
      .select("id").eq("tenant_id", s.tenantId).in("resource_id", resourceIds)
      .gte("starts_at", d30ago.toISOString())
    const ids = (apptIds ?? []).map((r) => r.id as string)
    if (ids.length > 0) {
      const { count } = await supabaseAdmin.from("appointment_events")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", s.tenantId).eq("type", "rescheduled")
        .gte("created_at", d7ago.toISOString()).in("appointment_id", ids)
      reschedules7d = count ?? 0
    }
  }

  // Ocupação: minutos reservados ÷ minutos úteis (working_hours × 1 semana).
  const bookedMinutes = (weekR.data ?? []).reduce((acc, a) =>
    acc + Math.max(0, (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60_000), 0)
  const availableMinutes = scoped.reduce((acc, r) => {
    const wh = (r.working_hours ?? []) as WorkingHoursDay[]
    return acc + wh.reduce((a2, d) => a2 + (d.intervals ?? []).reduce((a3, [ini, fim]) => a3 + Math.max(0, hhmmToMin(fim) - hhmmToMin(ini)), 0), 0)
  }, 0)

  const priceById = new Map((svcR.data ?? []).map((sv) => [sv.id as string, Number(sv.price) || 0]))
  const expectedRevenue = (weekR.data ?? []).reduce((acc, a) => acc + (a.service_id ? (priceById.get(a.service_id) ?? 0) : 0), 0)

  const noShowCount = (finishedR.data ?? []).filter((a) => a.status === "no_show").length
  const finishedCount = finishedR.data?.length ?? 0
  const confirmedUpcoming = (upcomingR.data ?? []).filter((a) => a.status === "confirmed").length
  const upcomingTotal = upcomingR.data?.length ?? 0
  const aiCount = (createdR.data ?? []).filter((a) => a.source === "ai").length
  const createdCount = createdR.data?.length ?? 0

  const pct = (num: number, den: number): number | null => den > 0 ? Math.round((num / den) * 100) : null

  const todayBy = (st: string) => (todayR.data ?? []).filter((a) => a.status === st).length

  return {
    todayTotal: todayR.data?.length ?? 0,
    todayConfirmed: todayBy("confirmed"), todayPending: todayBy("scheduled"),
    todayDone: todayBy("done"), todayNoShow: todayBy("no_show"),
    occupancyPct: pct(bookedMinutes, availableMinutes),
    bookedMinutes: Math.round(bookedMinutes), availableMinutes,
    noShowPct: pct(noShowCount, finishedCount), noShowCount, finishedCount,
    confirmPct: pct(confirmedUpcoming, upcomingTotal), confirmedUpcoming, pendingUpcoming: upcomingTotal - confirmedUpcoming,
    reschedules7d,
    aiSharePct: pct(aiCount, createdCount), aiCount, createdCount,
    expectedRevenue,
  }
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

  // Mesma régua do board: só agendas que o viewer pode VER (senão a sidebar do
  // chat viraria porta lateral pra marcar em agenda restrita).
  const [visRes, svcR] = await Promise.all([
    listVisibleResources(),
    supabaseAdmin.from("tenant_services").select("*").eq("tenant_id", s.tenantId).eq("active", true).order("name"),
  ])
  return {
    enabled: true, items,
    resources: visRes,
    services: (svcR.data ?? []) as unknown as ServiceRow[],
  }
}
