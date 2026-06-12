"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope } from "@/lib/visibility"
import { requireModule } from "@/lib/modules"
import { createNotification } from "@/lib/notifications"
import { runAppointmentEvent } from "@/lib/agenda/reminders"
import { getAvailability, type WorkingHoursDay, type Slot } from "@/lib/agenda/availability"

// ═══════════════════════════════════════════════════════════════
// Server actions da Agenda (Fase 1) — doc: docs/agenda-design.md
// ═══════════════════════════════════════════════════════════════
// Padrão do projeto: supabaseAdmin (service-role) + tenant_id imposto na
// app; config (recursos/serviços/bloqueios) é território de owner/admin;
// agendamento qualquer membro autenticado cria. Mutações retornam
// { error?: string } / { id }. Visibilidade de agendamento = tenant-wide
// read (coordenação de agenda exige enxergar), conforme decisão §8.

const ACTIVE_STATUSES = ["scheduled", "confirmed", "done"] as const
const ROUTE = "/agenda"

export interface ResourceRow {
  id: string; tenant_id: string; name: string; kind: string | null
  capacity: number; working_hours: WorkingHoursDay[]; slot_minutes: number
  timezone: string; assigned_agent_id: string | null
  min_lead_minutes: number; max_horizon_days: number; active: boolean
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
  revalidatePath(ROUTE)
  return {}
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
  const { data: resource } = await supabaseAdmin.from("tenant_resources")
    .select("*").eq("tenant_id", s.tenantId).eq("id", input.resourceId).maybeSingle()
  if (!resource) return { error: "Recurso não encontrado" }

  let durationMinutes = resource.slot_minutes
  let bufferBefore = 0, bufferAfter = 0
  if (input.serviceId) {
    const { data: svc } = await supabaseAdmin.from("tenant_services")
      .select("duration_minutes, buffer_before_minutes, buffer_after_minutes")
      .eq("tenant_id", s.tenantId).eq("id", input.serviceId).maybeSingle()
    if (svc) { durationMinutes = svc.duration_minutes; bufferBefore = svc.buffer_before_minutes; bufferAfter = svc.buffer_after_minutes }
  }

  const { busy, blackouts } = await loadResourceState(s.tenantId, input.resourceId, input.rangeStart, input.rangeEnd)
  const slots: Slot[] = getAvailability({
    resource: resource as never,
    durationMinutes, bufferBeforeMinutes: bufferBefore, bufferAfterMinutes: bufferAfter,
    busy, blackouts,
    rangeStart: new Date(input.rangeStart), rangeEnd: new Date(input.rangeEnd),
    partySize: input.partySize ?? 1,
  })
  return { slots: slots.map((sl) => ({ start: sl.start.toISOString(), end: sl.end.toISOString() })) }
}

/** Carrega reservas ativas + bloqueios de um recurso num intervalo (pro motor). */
async function loadResourceState(tenantId: string, resourceId: string, rangeStart: string, rangeEnd: string) {
  const [appts, blocks] = await Promise.all([
    supabaseAdmin.from("appointments")
      .select("starts_at, ends_at")
      .eq("tenant_id", tenantId).eq("resource_id", resourceId)
      .in("status", ACTIVE_STATUSES as unknown as string[])
      .lt("starts_at", rangeEnd).gt("ends_at", rangeStart),
    supabaseAdmin.from("tenant_blackouts")
      .select("starts_at, ends_at")
      .eq("tenant_id", tenantId)
      .or(`resource_id.eq.${resourceId},resource_id.is.null`)
      .lt("starts_at", rangeEnd).gt("ends_at", rangeStart),
  ])
  const toInt = (r: { starts_at: string; ends_at: string }) => ({ start: new Date(r.starts_at), end: new Date(r.ends_at) })
  return { busy: (appts.data ?? []).map(toInt), blackouts: (blocks.data ?? []).map(toInt) }
}

// ═══════════════════════════════════════════════════════════════
// AGENDAMENTOS (qualquer membro autenticado)
// ═══════════════════════════════════════════════════════════════
export async function listAppointments(input: { rangeStart: string; rangeEnd: string; resourceId?: string }): Promise<AppointmentRow[]> {
  const s = await getViewerScope()
  let q = supabaseAdmin.from("appointments")
    .select("*, chat_contacts(push_name, custom_name, phone_number), tenant_services(name), tenant_resources(name)")
    .eq("tenant_id", s.tenantId)
    .lt("starts_at", input.rangeEnd).gt("ends_at", input.rangeStart)
    .order("starts_at")
  if (input.resourceId) q = q.eq("resource_id", input.resourceId)
  const { data } = await q
  return (data ?? []) as unknown as AppointmentRow[]
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

  // Anti-IDOR: recurso, contato e conversa precisam ser DO tenant. Sem isso,
  // um membro poderia linkar um contact_id/conversation_id de OUTRO tenant
  // (FK é global) e depois ler o nome/telefone via o embed de listAppointments.
  const { data: resource } = await supabaseAdmin.from("tenant_resources")
    .select("id, capacity").eq("tenant_id", s.tenantId).eq("id", input.resourceId).maybeSingle()
  if (!resource) return { error: "Recurso não encontrado" }

  const { data: contact } = await supabaseAdmin.from("chat_contacts")
    .select("id").eq("tenant_id", s.tenantId).eq("id", input.contactId).maybeSingle()
  if (!contact) return { error: "Contato não encontrado" }

  let conversationId = input.conversationId ?? null
  if (conversationId) {
    const { data: conv } = await supabaseAdmin.from("chat_conversations")
      .select("id").eq("tenant_id", s.tenantId).eq("id", conversationId).maybeSingle()
    if (!conv) return { error: "Conversa inválida" }
  } else {
    // Liga ao chat mais recente do contato (se houver) → o aviso "ao agendar"
    // tem por onde sair e o agendamento aparece no contexto da conversa.
    const { data: last } = await supabaseAdmin.from("chat_conversations")
      .select("id").eq("tenant_id", s.tenantId).eq("contact_id", input.contactId)
      .order("last_message_at", { ascending: false }).limit(1).maybeSingle()
    conversationId = last?.id ?? null
  }

  let duration = input.durationMinutes ?? 30
  let agentId: string | null = null
  if (input.serviceId) {
    const { data: svc } = await supabaseAdmin.from("tenant_services")
      .select("duration_minutes").eq("tenant_id", s.tenantId).eq("id", input.serviceId).maybeSingle()
    if (!svc) return { error: "Serviço não encontrado" }
    duration = svc.duration_minutes
  }
  const startsAt = new Date(input.startsAt)
  if (isNaN(startsAt.getTime())) return { error: "Data/hora inválida" }
  const endsAt = new Date(startsAt.getTime() + duration * 60_000)
  const partySize = Math.max(1, input.partySize ?? 1)

  // Bloqueios sempre barram.
  const { count: blocked } = await supabaseAdmin.from("tenant_blackouts")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", s.tenantId)
    .or(`resource_id.eq.${input.resourceId},resource_id.is.null`)
    .lt("starts_at", endsAt.toISOString()).gt("ends_at", startsAt.toISOString())
  if (blocked && blocked > 0) return { error: "Esse horário está bloqueado (folga/feriado)" }

  // Capacidade N: contagem (capacidade 1 fica a cargo do EXCLUDE).
  if (resource.capacity > 1) {
    const { count: taken } = await supabaseAdmin.from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", s.tenantId).eq("resource_id", input.resourceId)
      .in("status", ACTIVE_STATUSES as unknown as string[])
      .lt("starts_at", endsAt.toISOString()).gt("ends_at", startsAt.toISOString())
    if ((taken ?? 0) + partySize > resource.capacity) return { error: "Esse horário está lotado" }
  }

  const { data, error } = await supabaseAdmin.from("appointments").insert({
    tenant_id: s.tenantId, contact_id: input.contactId, conversation_id: conversationId,
    resource_id: input.resourceId, service_id: input.serviceId ?? null,
    starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
    status: "scheduled", source: input.source ?? "manual",
    blocks_overlap: resource.capacity === 1,
    notify_customer: input.notifyCustomer ?? true,
    notes: input.notes?.trim() || null, created_by: s.userId,
  }).select("id, resource_id").single()

  if (error) {
    // 23P01 = exclusion_violation (EXCLUDE de sobreposição pra capacidade 1).
    if (error.code === "23P01" || /exclusion|overlap/i.test(error.message)) {
      return { error: "Esse horário acabou de ser preenchido" }
    }
    return { error: error.message }
  }

  // Plano do atendente: notifica o dono do recurso (se houver e não for quem agendou).
  const { data: res2 } = await supabaseAdmin.from("tenant_resources")
    .select("assigned_agent_id, name").eq("id", input.resourceId).maybeSingle()
  agentId = res2?.assigned_agent_id ?? null
  if (agentId && agentId !== s.userId) {
    await createNotification({
      tenantId: s.tenantId, recipientId: agentId, type: "appt_created",
      title: "Novo agendamento", body: `${res2?.name ?? "Recurso"} · ${startsAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
      payload: { appointment_id: data.id, conversation_id: conversationId },
    })
  }

  // Evento `created` → consumidor built-in (avisa o cliente "ao agendar", §6.7-A).
  // Best-effort + gated por allowlist: não envia nada a cliente real sem AGENDA_REMINDER_ALLOWLIST.
  await runAppointmentEvent(data.id, "created")

  revalidatePath(ROUTE)
  return { id: data.id }
}

export async function rescheduleAppointment(id: string, newStartsAt: string): Promise<{ error?: string }> {
  const s = await agendaScope()
  const start = new Date(newStartsAt)
  if (isNaN(start.getTime())) return { error: "Data/hora inválida" }
  const { data: appt } = await supabaseAdmin.from("appointments")
    .select("starts_at, ends_at, resource_id").eq("tenant_id", s.tenantId).eq("id", id).maybeSingle()
  if (!appt) return { error: "Agendamento não encontrado" }
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
  const { error } = await supabaseAdmin.from("appointments")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("tenant_id", s.tenantId).eq("id", id)
  if (error) return { error: error.message }
  revalidatePath(ROUTE)
  return {}
}

export async function cancelAppointment(id: string, reason?: string): Promise<{ error?: string }> {
  const s = await agendaScope()
  const { error } = await supabaseAdmin.from("appointments")
    .update({ status: "canceled", notes: reason?.trim() || undefined, updated_at: new Date().toISOString() })
    .eq("tenant_id", s.tenantId).eq("id", id)
  if (error) return { error: error.message }
  revalidatePath(ROUTE)
  return {}
}
