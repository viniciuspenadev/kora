import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { getAvailability, type Slot } from "@/lib/agenda/availability"
import { runAppointmentEvent, rearmAppointmentReminders } from "@/lib/agenda/reminders"
import { recordAppointmentEvent } from "@/lib/agenda/events"
import { createNotification } from "@/lib/notifications"
import { hasModule } from "@/lib/modules"
import { carteiraOwner } from "@/lib/carteira"

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
  startsAt: string; durationMinutes?: number; source?: "ai" | "agent" | "manual" | "self_service"; notes?: string
  partySize?: number; notifyCustomer?: boolean; createdBy?: string | null
  /** Marcado numa conversa ao vivo (IA/nó já confirmou) → não manda o aviso plano
   *  da agenda (evita confirmação dupla); o round-trip de confirmação continua. */
  conversationalConfirm?: boolean
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

  // Espinha de eventos (Agenda 2.0 F0): quem criou, como, quando.
  await recordAppointmentEvent({
    tenantId, appointmentId: data.id, type: "created",
    actorUserId: createdBy,
    actorLabel: input.source === "ai" ? "IA" : input.source === "self_service" ? "cliente" : "sistema",
    payload: {
      starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
      resource_id: input.resourceId, service_id: input.serviceId ?? null,
      source: input.source ?? "manual",
    },
  })

  // Evento `created` → consumidor built-in (confirmação/lembrete do 3d).
  // Conversa ao vivo (IA/nó) → pula o aviso plano (round-trip preservado).
  await runAppointmentEvent(data.id, "created", { skipPlainNotify: input.conversationalConfirm === true })
  return { id: data.id, conversationId }
}

// ═══════════════════════════════════════════════════════════════
// Resolução de DESTINO + POOL — fonte ÚNICA (IA E determinístico)
// ═══════════════════════════════════════════════════════════════
// Decide EM QUE agenda(s) o agendamento pode cair. `binding` é o input do
// autor do fluxo (fixed/owner) e SOBREPÕE a escolha livre por nome (IA).
// docs/agenda-routing.md §1–2 + §1.1. Tanto a capability da IA quanto o nó
// "Agendar" chamam isto → roteamento NUNCA diverge entre os dois caminhos.

const normName = (s: string) => s.trim().toLowerCase()

export interface AgendaTargetSpec {
  /** input do nó: fixed (resourceId/serviceId) · owner (carteira) · ai/null (livre). */
  mode?:           "fixed" | "owner" | "ai" | null
  serviceId?:      string | null
  resourceId?:     string | null
  /** caminho livre (IA por nome) — só usado quando não há binding fixo/owner. */
  serviceName?:    string
  resourceName?:   string
  /** pra resolver o dono (owner mode) — a cascata usa AMBOS (docs/crm-agenda-owner-routing-design.md §3). */
  conversationId?: string | null
  contactId?:      string | null
  /** owner mode: o que fazer quando NÃO há dono resolvível (§4). Default `pool` = como era antes. */
  ownerFallback?:      "pool" | "resource" | "none" | null
  fallbackResourceId?: string | null
}

/**
 * O dono resolvido serve o serviço fixado? (furo B). Sem serviço, ou serviço sem
 * pool declarado → não restringe. Evita marcar um serviço na agenda de quem não o faz.
 */
function servesService(
  services: { id: string; resource_ids?: unknown }[] | null,
  serviceId: string | null, resourceId: string,
): boolean {
  if (!serviceId) return true
  const svc = (services ?? []).find((s) => s.id === serviceId)
  if (!svc) return true
  const ids = Array.isArray(svc.resource_ids) ? (svc.resource_ids as string[]) : []
  return ids.length === 0 || ids.includes(resourceId)
}

/**
 * Agenda do DONO do cliente — CASCATA da carteira (docs/crm-agenda-owner-routing-design.md §3).
 *
 *   1. `chat_contacts.owner_id`          → dono da CONTA (persistente, atravessa conversas)
 *   2. `chat_conversations.assigned_to`  → quem atende AGORA (rede pra contato sem dono)
 *
 * Ordem dono-primeiro = a MESMA doutrina do roteamento de retorno (conversation-dedup
 * §carteira: "o retorno vai pro DONO, não pro último que atendeu"). No caso comum
 * (auto-dono) os dois são a mesma pessoa → no-op. Antes daqui só existia o passo 2, o
 * que fazia lead novo (sem atendente) não resolver nunca.
 *
 * Só devolve agenda de agente ATIVO no tenant (furo A) — desligado não recebe agendamento.
 */
async function ownerResource(
  tenantId: string, conversationId: string | null, contactId: string | null,
): Promise<string | null> {
  const candidates: string[] = []
  const owner = await carteiraOwner(tenantId, contactId ?? null)
  if (owner) candidates.push(owner)
  if (conversationId) {
    const { data: conv } = await supabaseAdmin.from("chat_conversations")
      .select("assigned_to").eq("tenant_id", tenantId).eq("id", conversationId).maybeSingle()
    const a = (conv?.assigned_to as string | null) ?? null
    if (a && !candidates.includes(a)) candidates.push(a)
  }
  for (const agentId of candidates) {
    // Agente ainda ATIVO no tenant (furo A) — espelha a guarda do linkOwnerOnDeal.
    const { data: m } = await supabaseAdmin.from("tenant_users")
      .select("user_id").eq("tenant_id", tenantId).eq("user_id", agentId).eq("active", true).maybeSingle()
    if (!m) continue
    // Nada impede um agente de ser dono de 2+ agendas → ordena pra escolha ser
    // ESTÁVEL (a mais antiga = a principal). Sem isto, trocar o dono de uma agenda
    // podia fazer o destino oscilar entre execuções.
    const { data: res } = await supabaseAdmin.from("tenant_resources")
      .select("id").eq("tenant_id", tenantId).eq("assigned_agent_id", agentId).eq("active", true)
      .order("created_at", { ascending: true }).limit(1).maybeSingle()
    if (res?.id) return res.id as string
  }
  return null
}

/**
 * Resolve `{ serviceId, pool }`. Binding fixo/owner sobrepõe a IA (fail-closed:
 * alvo fixado que sumiu → erro, NÃO cai no livre). Sem binding / modo `ai` →
 * resolve por nome (serviço → todas ativas do serviço · senão → todas do tenant).
 */
export async function resolveAgendaTargets(
  tenantId: string, spec: AgendaTargetSpec,
): Promise<{ error?: string; serviceId: string | null; pool: string[] }> {
  const { data: services } = await supabaseAdmin.from("tenant_services")
    .select("id, name, resource_ids").eq("tenant_id", tenantId).eq("active", true)
  const { data: resources } = await supabaseAdmin.from("tenant_resources")
    .select("id, name").eq("tenant_id", tenantId).eq("active", true).order("name")
  const activeIds = new Set((resources ?? []).map((r) => r.id))
  const svcByName = spec.serviceName ? (services ?? []).find((s) => normName(s.name) === normName(spec.serviceName!)) : null

  // 1. BINDING FIXO (sobrepõe a IA).
  if (spec.mode === "fixed") {
    if (spec.resourceId) {
      if (!activeIds.has(spec.resourceId)) return { error: "A agenda fixada neste passo não está mais ativa. Avise um atendente.", serviceId: null, pool: [] }
      const svcId = spec.serviceId && (services ?? []).some((s) => s.id === spec.serviceId) ? spec.serviceId : (svcByName?.id ?? null)
      return { serviceId: svcId, pool: [spec.resourceId] }
    }
    if (spec.serviceId) {
      const svc = (services ?? []).find((s) => s.id === spec.serviceId)
      if (!svc) return { error: "O serviço fixado neste passo não está mais ativo. Avise um atendente.", serviceId: null, pool: [] }
      const pool = Array.isArray(svc.resource_ids) ? (svc.resource_ids as string[]).filter((id) => activeIds.has(id)) : []
      if (pool.length === 0) return { error: "O serviço fixado não tem agenda ativa. Avise um atendente.", serviceId: null, pool: [] }
      return { serviceId: svc.id, pool }
    }
    // fixed sem nada escolhido → cai no livre abaixo.
  }

  // 2. BINDING "dono da conversa" (carteira) — GATED no god mode (`agenda_owner_routing`,
  // beta/default-off). Gate OFF → NÃO resolve por dono (fail-closed) → degrada pro livre.
  // Resolve pela CASCATA (dono do contato → atendente da conversa), valida que o dono
  // SERVE o serviço (furo B) e, não resolvendo, aplica o fallback EXPLÍCITO (§4) em vez
  // de cair calado no pool inteiro. docs/crm-agenda-owner-routing-design.md.
  if (spec.mode === "owner" && (spec.conversationId || spec.contactId) && await hasModule(tenantId, "agenda_owner_routing")) {
    const svcId = svcByName?.id ?? null
    const owned = await ownerResource(tenantId, spec.conversationId ?? null, spec.contactId ?? null)
    if (owned && activeIds.has(owned) && servesService(services, svcId, owned)) {
      return { serviceId: svcId, pool: [owned] }
    }
    // Sem dono resolvível → o AUTOR do fluxo decide (default `pool` = comportamento antigo).
    const fb = spec.ownerFallback ?? "pool"
    if (fb === "none") {
      return { error: "Nenhum atendente responsável disponível para agendar agora.", serviceId: null, pool: [] }
    }
    if (fb === "resource") {
      if (spec.fallbackResourceId && activeIds.has(spec.fallbackResourceId)) {
        return { serviceId: svcId, pool: [spec.fallbackResourceId] }
      }
      return { error: "A agenda de plantão deste passo não está mais ativa. Avise um atendente.", serviceId: null, pool: [] }
    }
    // fb === "pool" → segue pro livre abaixo (união do serviço / todas as ativas).
  }

  // 3. LIVRE (ai / sem binding): por nome.
  if (spec.serviceName && !svcByName) {
    const opts = (services ?? []).map((s) => s.name).join(", ") || "(nenhum)"
    return { error: `Serviço "${spec.serviceName}" não existe. Serviços disponíveis: ${opts}.`, serviceId: null, pool: [] }
  }
  let pool: string[] = []
  if (spec.resourceName) {
    const r = (resources ?? []).find((r) => normName(r.name) === normName(spec.resourceName!))
    if (!r) {
      const opts = (resources ?? []).map((r) => r.name).join(", ") || "(nenhuma)"
      return { error: `Agenda "${spec.resourceName}" não existe. Agendas: ${opts}.`, serviceId: null, pool: [] }
    }
    pool = [r.id]
  } else if (svcByName && Array.isArray(svcByName.resource_ids) && svcByName.resource_ids.length > 0) {
    pool = (svcByName.resource_ids as string[]).filter((id) => activeIds.has(id))
  }
  if (pool.length === 0) pool = (resources ?? []).map((r) => r.id)   // fallback: tudo ativo
  if (pool.length === 0) return { error: "Nenhuma agenda configurada — não há como marcar horário.", serviceId: null, pool: [] }
  return { serviceId: svcByName?.id ?? null, pool }
}

/** UNIÃO de horários livres de um pool ("qualquer disponível") — dedup por start, ordenado. */
export async function availabilityPool(tenantId: string, input: {
  pool: string[]; serviceId?: string | null; rangeStart: string; rangeEnd: string; partySize?: number
}): Promise<{ start: string; end: string }[]> {
  const seen = new Set<string>()
  const merged: { start: string; end: string }[] = []
  for (const resourceId of input.pool) {
    const slots = await availabilitySlots(tenantId, {
      resourceId, serviceId: input.serviceId, rangeStart: input.rangeStart, rangeEnd: input.rangeEnd, partySize: input.partySize,
    })
    for (const s of slots) { if (!seen.has(s.start)) { seen.add(s.start); merged.push(s) } }
  }
  merged.sort((a, b) => a.start.localeCompare(b.start))
  return merged
}

/** 1ª agenda do pool com `startsAt` REALMENTE livre (resolução do pool no momento do book). */
export async function pickFreeInPool(tenantId: string, input: {
  pool: string[]; serviceId?: string | null; startsAt: string
}): Promise<string | null> {
  const start = new Date(input.startsAt).getTime()
  for (const resourceId of input.pool) {
    const slots = await availabilitySlots(tenantId, {
      resourceId, serviceId: input.serviceId,
      rangeStart: new Date(start - 60_000).toISOString(),
      rangeEnd:   new Date(start + 86_400_000).toISOString(),
    })
    if (slots.some((s) => Math.abs(new Date(s.start).getTime() - start) < 1000)) return resourceId
  }
  return null
}

/**
 * Remarca um agendamento — PORTA ÚNICA de toda remarcação (Agenda 2.0 F2).
 * Preserva a duração; `opts.resourceId` troca também a agenda (drag entre colunas
 * no Dia / select no modal). Server-less; o chamador é responsável pela autorização
 * (action = gateAppointment · capability = resolve pelo contato · interceptor = pendência).
 *
 * Garantias (iguais pra atendente, IA e cliente):
 *  • bloqueios SEMPRE barram (mesma regra do bookAppointment — antes só valia ao criar);
 *  • anti-double-book: capacidade 1 via EXCLUDE (`23P01` → mensagem amigável);
 *  • status volta pra `scheduled` (remarcou = precisa re-confirmar);
 *  • evento `rescheduled` na espinha (com troca de agenda no payload, se houver);
 *  • lembretes REARMADOS pro horário novo; `opts.resendConfirm` re-dispara a
 *    confirmação (gates de módulo/switch respeitados, fail-closed).
 */
export async function moveAppointment(
  tenantId: string, appointmentId: string, newStartsAt: string,
  opts?: { actorUserId?: string | null; actorLabel?: string | null; resourceId?: string | null; resendConfirm?: boolean },
): Promise<{ error?: string; ok?: boolean }> {
  const { data: appt } = await supabaseAdmin.from("appointments")
    .select("starts_at, ends_at, resource_id").eq("tenant_id", tenantId).eq("id", appointmentId).maybeSingle()
  if (!appt) return { error: "Agendamento não encontrado" }
  const start = new Date(newStartsAt)
  if (isNaN(start.getTime())) return { error: "Data/hora inválida" }
  const duration = new Date(appt.ends_at).getTime() - new Date(appt.starts_at).getTime()
  const end = new Date(start.getTime() + duration)

  // Troca de agenda (opcional): destino tem que ser recurso ATIVO do tenant (anti-IDOR).
  const targetResource = opts?.resourceId ?? appt.resource_id
  const changingResource = targetResource !== appt.resource_id
  let resQ = supabaseAdmin.from("tenant_resources")
    .select("capacity").eq("tenant_id", tenantId).eq("id", targetResource)
  if (changingResource) resQ = resQ.eq("active", true)
  const { data: targetRes } = await resQ.maybeSingle()
  if (changingResource && !targetRes) return { error: "Agenda de destino não encontrada" }
  const blocksOverlap: boolean | undefined = changingResource ? targetRes?.capacity === 1 : undefined

  // Bloqueios sempre barram (recurso de destino OU tenant inteiro).
  const { count: blocked } = await supabaseAdmin.from("tenant_blackouts")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .or(`resource_id.eq.${targetResource},resource_id.is.null`)
    .lt("starts_at", end.toISOString()).gt("ends_at", start.toISOString())
  if (blocked && blocked > 0) return { error: "Esse horário está bloqueado (folga/feriado)" }

  // Capacidade N: o EXCLUDE só protege capacidade 1 → reconta manualmente (exclui a
  // si mesmo). Sem isto, mover pra dentro de um recurso de grupo estoura o limite
  // (mesma checagem do bookAppointment; auditoria B2).
  if ((targetRes?.capacity ?? 0) > 1) {
    const { count: taken } = await supabaseAdmin.from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("resource_id", targetResource).neq("id", appointmentId)
      .in("status", ACTIVE_STATUSES as unknown as string[])
      .lt("starts_at", end.toISOString()).gt("ends_at", start.toISOString())
    if ((taken ?? 0) + 1 > (targetRes?.capacity ?? 0)) return { error: "Esse horário está lotado" }
  }

  const { error } = await supabaseAdmin.from("appointments")
    .update({
      starts_at: start.toISOString(), ends_at: end.toISOString(),
      resource_id: targetResource, status: "scheduled",
      ...(blocksOverlap !== undefined ? { blocks_overlap: blocksOverlap } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId).eq("id", appointmentId)
  if (error) {
    if (error.code === "23P01" || /exclusion|overlap/i.test(error.message)) return { error: "Esse horário acabou de ser preenchido" }
    return { error: error.message }
  }

  await recordAppointmentEvent({
    tenantId, appointmentId, type: "rescheduled",
    actorUserId: opts?.actorUserId ?? null, actorLabel: opts?.actorLabel ?? "sistema",
    payload: {
      from: appt.starts_at, to: start.toISOString(),
      ...(targetResource !== appt.resource_id ? { resource_from: appt.resource_id, resource_to: targetResource } : {}),
    },
  })
  await rearmAppointmentReminders(appointmentId, { resendConfirm: opts?.resendConfirm === true })
  return { ok: true }
}
