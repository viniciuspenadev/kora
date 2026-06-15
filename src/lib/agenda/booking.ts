import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { getAvailability, type Slot } from "@/lib/agenda/availability"
import { runAppointmentEvent } from "@/lib/agenda/reminders"
import { createNotification } from "@/lib/notifications"

// ═══════════════════════════════════════════════════════════════
// Núcleo server-less da Agenda (disponibilidade) — SEM sessão
// ═══════════════════════════════════════════════════════════════
// Fonte única reusada pelas server actions (com sessão) E pelas capabilities
// do Studio (sem sessão, igual o interceptor do 3d). Toda query é tenant-scoped
// pelo `tenantId` passado — o chamador é responsável por já tê-lo validado.
// Doc: docs/agenda-design.md §5 (Agenda F2) + docs/capability-platform.md.

/** Status que OCUPAM um horário (idem ao motor/interceptor). */
export const ACTIVE_STATUSES = ["scheduled", "confirmed", "done"] as const

/** Carrega reservas ativas + bloqueios de um recurso num intervalo (pro motor). */
export async function loadResourceState(tenantId: string, resourceId: string, rangeStart: string, rangeEnd: string) {
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

/**
 * Slots livres de um recurso num intervalo — server-less. Resolve duração/buffers
 * do serviço (se houver), carrega o estado real e roda o motor determinístico.
 * Recurso inexistente → [] (sem horário). NÃO lança.
 */
export async function availabilitySlots(tenantId: string, input: {
  resourceId: string; serviceId?: string | null; rangeStart: string; rangeEnd: string; partySize?: number
}): Promise<{ start: string; end: string }[]> {
  const { data: resource } = await supabaseAdmin.from("tenant_resources")
    .select("*").eq("tenant_id", tenantId).eq("id", input.resourceId).maybeSingle()
  if (!resource) return []

  let durationMinutes = resource.slot_minutes as number
  let bufferBefore = 0, bufferAfter = 0
  if (input.serviceId) {
    const { data: svc } = await supabaseAdmin.from("tenant_services")
      .select("duration_minutes, buffer_before_minutes, buffer_after_minutes")
      .eq("tenant_id", tenantId).eq("id", input.serviceId).maybeSingle()
    if (svc) { durationMinutes = svc.duration_minutes; bufferBefore = svc.buffer_before_minutes; bufferAfter = svc.buffer_after_minutes }
  }

  const { busy, blackouts } = await loadResourceState(tenantId, input.resourceId, input.rangeStart, input.rangeEnd)
  const slots: Slot[] = getAvailability({
    resource: resource as never,
    durationMinutes, bufferBeforeMinutes: bufferBefore, bufferAfterMinutes: bufferAfter,
    busy, blackouts,
    rangeStart: new Date(input.rangeStart), rangeEnd: new Date(input.rangeEnd),
    partySize: input.partySize ?? 1,
  })
  return slots.map((sl) => ({ start: sl.start.toISOString(), end: sl.end.toISOString() }))
}

/**
 * Cria um agendamento — núcleo server-less. Anti-double-book: capacidade 1 via
 * EXCLUDE no banco (`23P01` → erro amigável); capacidade N por contagem.
 * `createdBy` = quem criou (atendente = userId; IA/sistema = null). NÃO revalida
 * page cache (isso é da server action). Reusado por `createAppointment` (sessão)
 * E pela capability `schedule_appointment` (Studio).
 */
export async function bookAppointment(tenantId: string, input: {
  contactId: string; conversationId?: string | null; resourceId: string; serviceId?: string | null
  startsAt: string; durationMinutes?: number; source?: "ai" | "agent" | "manual"; notes?: string
  partySize?: number; notifyCustomer?: boolean; createdBy?: string | null
}): Promise<{ error?: string; id?: string; conversationId?: string | null }> {
  // Anti-IDOR: recurso, contato e conversa precisam ser DO tenant.
  const { data: resource } = await supabaseAdmin.from("tenant_resources")
    .select("id, capacity").eq("tenant_id", tenantId).eq("id", input.resourceId).maybeSingle()
  if (!resource) return { error: "Recurso não encontrado" }
  const { data: contact } = await supabaseAdmin.from("chat_contacts")
    .select("id").eq("tenant_id", tenantId).eq("id", input.contactId).maybeSingle()
  if (!contact) return { error: "Contato não encontrado" }

  let conversationId = input.conversationId ?? null
  if (conversationId) {
    const { data: conv } = await supabaseAdmin.from("chat_conversations")
      .select("id").eq("tenant_id", tenantId).eq("id", conversationId).maybeSingle()
    if (!conv) return { error: "Conversa inválida" }
  } else {
    const { data: last } = await supabaseAdmin.from("chat_conversations")
      .select("id").eq("tenant_id", tenantId).eq("contact_id", input.contactId)
      .order("last_message_at", { ascending: false }).limit(1).maybeSingle()
    conversationId = last?.id ?? null
  }

  let duration = input.durationMinutes ?? 30
  if (input.serviceId) {
    const { data: svc } = await supabaseAdmin.from("tenant_services")
      .select("duration_minutes").eq("tenant_id", tenantId).eq("id", input.serviceId).maybeSingle()
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
    .eq("tenant_id", tenantId)
    .or(`resource_id.eq.${input.resourceId},resource_id.is.null`)
    .lt("starts_at", endsAt.toISOString()).gt("ends_at", startsAt.toISOString())
  if (blocked && blocked > 0) return { error: "Esse horário está bloqueado (folga/feriado)" }

  // Capacidade N: contagem (capacidade 1 fica a cargo do EXCLUDE).
  if (resource.capacity > 1) {
    const { count: taken } = await supabaseAdmin.from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("resource_id", input.resourceId)
      .in("status", ACTIVE_STATUSES as unknown as string[])
      .lt("starts_at", endsAt.toISOString()).gt("ends_at", startsAt.toISOString())
    if ((taken ?? 0) + partySize > resource.capacity) return { error: "Esse horário está lotado" }
  }

  const createdBy = input.createdBy ?? null
  const { data, error } = await supabaseAdmin.from("appointments").insert({
    tenant_id: tenantId, contact_id: input.contactId, conversation_id: conversationId,
    resource_id: input.resourceId, service_id: input.serviceId ?? null,
    starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
    status: "scheduled", source: input.source ?? "manual",
    blocks_overlap: resource.capacity === 1,
    notify_customer: input.notifyCustomer ?? true,
    notes: input.notes?.trim() || null, created_by: createdBy,
  }).select("id, resource_id").single()

  if (error) {
    if (error.code === "23P01" || /exclusion|overlap/i.test(error.message)) return { error: "Esse horário acabou de ser preenchido" }
    return { error: error.message }
  }

  // Notifica o dono do recurso (se houver e não for quem agendou).
  const { data: res2 } = await supabaseAdmin.from("tenant_resources")
    .select("assigned_agent_id, name").eq("id", input.resourceId).maybeSingle()
  const agentId = res2?.assigned_agent_id ?? null
  if (agentId && agentId !== createdBy) {
    await createNotification({
      tenantId, recipientId: agentId, type: "appt_created",
      title: "Novo agendamento", body: `${res2?.name ?? "Recurso"} · ${startsAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
      payload: { appointment_id: data.id, conversation_id: conversationId },
    })
  }

  // Evento `created` → consumidor built-in (confirmação/lembrete do 3d).
  await runAppointmentEvent(data.id, "created")
  return { id: data.id, conversationId }
}

/**
 * Move um agendamento pra um novo horário (preserva a duração). Server-less.
 * Anti-double-book: capacidade 1 via EXCLUDE (`23P01`). O chamador é responsável
 * pela autorização (ex: a capability resolve o appointment PELO contato → anti-IDOR).
 */
export async function moveAppointment(tenantId: string, appointmentId: string, newStartsAt: string): Promise<{ error?: string; ok?: boolean }> {
  const { data: appt } = await supabaseAdmin.from("appointments")
    .select("starts_at, ends_at").eq("tenant_id", tenantId).eq("id", appointmentId).maybeSingle()
  if (!appt) return { error: "Agendamento não encontrado" }
  const start = new Date(newStartsAt)
  if (isNaN(start.getTime())) return { error: "Data/hora inválida" }
  const duration = new Date(appt.ends_at).getTime() - new Date(appt.starts_at).getTime()
  const end = new Date(start.getTime() + duration)
  const { error } = await supabaseAdmin.from("appointments")
    .update({ starts_at: start.toISOString(), ends_at: end.toISOString(), status: "scheduled", updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("id", appointmentId)
  if (error) {
    if (error.code === "23P01" || /exclusion|overlap/i.test(error.message)) return { error: "Esse horário acabou de ser preenchido" }
    return { error: error.message }
  }
  return { ok: true }
}
