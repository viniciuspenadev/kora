// ═══════════════════════════════════════════════════════════════
// Capacidades da Agenda (conector de DOMÍNIO) — Studio F2
// ═══════════════════════════════════════════════════════════════
// Implementação de REFERÊNCIA da Camada 1 (docs/capability-platform.md).
// NÃO expõe tabela crua: expõe operações VALIDADAS (disponibilidade real +
// reserva atômica). A IA nunca inventa horário. Server-less: reusa o núcleo
// `availabilitySlots`/`bookAppointment`. Doc: docs/agenda-design.md §5.
import { defineCapability } from "./registry"
import { supabaseAdmin } from "@/lib/supabase"
import { availabilitySlots, bookAppointment, moveAppointment } from "@/lib/agenda/booking"

export const CHECK_AVAILABILITY      = "check_availability"
export const SCHEDULE_APPOINTMENT     = "schedule_appointment"
export const RESCHEDULE_APPOINTMENT   = "reschedule_appointment"

const TZ = "America/Sao_Paulo"
const HORIZON_DAYS = 21
const MAX_SLOTS = 6

const norm = (s: string) => s.trim().toLowerCase()

// "qua 09/06 às 14h00" — legível; o ISO cru vai entre [ ] pra a IA reusar no schedule.
function fmtSlot(iso: string): string {
  const d = new Date(iso)
  const wd = d.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short" }).replace(".", "")
  const dm = d.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" })
  const hm = d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).replace(":", "h")
  return `${wd} ${dm} às ${hm}`
}

interface Targets { serviceId: string | null; resourceId: string }

/** Resolve serviço (por nome) + agenda (nome → do serviço → 1ª ativa). Compartilhado pelas 2 tools. */
async function resolveTargets(tenantId: string, service: string, resource: string): Promise<{ error?: string; targets?: Targets }> {
  const { data: services } = await supabaseAdmin.from("tenant_services")
    .select("id, name, resource_ids").eq("tenant_id", tenantId).eq("active", true)
  const svc = service ? (services ?? []).find((s) => norm(s.name) === norm(service)) : null
  if (service && !svc) {
    const opts = (services ?? []).map((s) => s.name).join(", ") || "(nenhum)"
    return { error: `Serviço "${service}" não existe. Serviços disponíveis: ${opts}.` }
  }

  const { data: resources } = await supabaseAdmin.from("tenant_resources")
    .select("id, name").eq("tenant_id", tenantId).eq("active", true).order("name")
  let resourceId: string | null = null
  if (resource) {
    const r = (resources ?? []).find((r) => norm(r.name) === norm(resource))
    if (!r) {
      const opts = (resources ?? []).map((r) => r.name).join(", ") || "(nenhuma)"
      return { error: `Agenda "${resource}" não existe. Agendas: ${opts}.` }
    }
    resourceId = r.id
  } else if (svc && Array.isArray(svc.resource_ids)) {
    resourceId = (svc.resource_ids as string[]).find((id) => (resources ?? []).some((r) => r.id === id)) ?? null
  }
  if (!resourceId) resourceId = (resources ?? [])[0]?.id ?? null
  if (!resourceId) return { error: "Nenhuma agenda configurada — não há como marcar horário." }
  return { targets: { serviceId: svc?.id ?? null, resourceId } }
}

// ── check_availability (retrieval) ───────────────────────────────────────
interface CheckArgs { service: string; resource: string }

export const checkAvailabilityCapability = defineCapability<CheckArgs>({
  id:           CHECK_AVAILABILITY,
  name:         "Consultar disponibilidade",
  category:     "external",
  minPlanLevel: 0,
  isNode:       true,
  toolSchema: {
    type: "function",
    function: {
      name: CHECK_AVAILABILITY,
      description:
        "Consulta os horários REAIS livres na agenda do negócio. Chame ANTES de oferecer qualquer horário — " +
        "NUNCA invente horário, ofereça SOMENTE os que esta ferramenta retornar. Informe serviço/agenda quando souber.",
      parameters: {
        type: "object",
        properties: {
          service:  { type: "string", description: "Nome do serviço (ex: Corte). Opcional." },
          resource: { type: "string", description: "Nome da agenda/profissional (ex: João). Opcional." },
        },
        additionalProperties: false,
      },
    },
  },
  parseArgs: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>
    return {
      service:  typeof p.service === "string"  ? p.service.trim()  : "",
      resource: typeof p.resource === "string" ? p.resource.trim() : "",
    }
  },
  execute: async (ctx, args) => {
    const res = await resolveTargets(ctx.tenantId, args.service, args.resource)
    if (res.error || !res.targets) return { ok: false, toolMessage: res.error ?? "Agenda indisponível." }
    const { serviceId, resourceId } = res.targets

    const now = Date.now()
    const slots = await availabilitySlots(ctx.tenantId, {
      resourceId, serviceId,
      rangeStart: new Date(now).toISOString(),
      rangeEnd:   new Date(now + HORIZON_DAYS * 86_400_000).toISOString(),
    })
    if (slots.length === 0) {
      return { ok: true, toolMessage: "Sem horários livres nos próximos dias — diga ao cliente que um atendente vai ajudar a encontrar." }
    }
    const list = slots.slice(0, MAX_SLOTS).map((s) => `${fmtSlot(s.start)} [${s.start}]`).join(" · ")
    return {
      ok: true,
      toolMessage: `Horários LIVRES (ofereça SOMENTE estes; o valor em [ ] é o starts_at exato pra agendar): ${list}`,
      data: { slots: slots.slice(0, MAX_SLOTS), resourceId, serviceId },
    }
  },
})

// ── schedule_appointment (ação) ──────────────────────────────────────────
interface ScheduleArgs { service: string; resource: string; starts_at: string }

export const scheduleAppointmentCapability = defineCapability<ScheduleArgs>({
  id:           SCHEDULE_APPOINTMENT,
  name:         "Agendar horário",
  category:     "external",
  minPlanLevel: 0,
  isNode:       true,
  toolSchema: {
    type: "function",
    function: {
      name: SCHEDULE_APPOINTMENT,
      description:
        "Marca um horário pro cliente. Use SOMENTE um starts_at que veio de check_availability (o valor EXATO em [ ]). " +
        "NUNCA invente horário. Se der erro/indisponível, chame check_availability de novo e ofereça outro.",
      parameters: {
        type: "object",
        properties: {
          service:   { type: "string", description: "Nome do serviço. Opcional (use o mesmo do check_availability)." },
          resource:  { type: "string", description: "Nome da agenda. Opcional." },
          starts_at: { type: "string", description: "starts_at ISO EXATO vindo de check_availability (o valor em [ ])." },
        },
        required: ["starts_at"],
        additionalProperties: false,
      },
    },
  },
  parseArgs: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>
    return {
      service:   typeof p.service === "string"   ? p.service.trim()   : "",
      resource:  typeof p.resource === "string"  ? p.resource.trim()  : "",
      starts_at: typeof p.starts_at === "string" ? p.starts_at.trim() : "",
    }
  },
  execute: async (ctx, args) => {
    if (!args.starts_at) return { ok: false, toolMessage: "Falta o horário. Chame check_availability e use um dos slots (o valor em [ ])." }
    const start = new Date(args.starts_at)
    if (isNaN(start.getTime())) return { ok: false, toolMessage: "Horário inválido. Use um starts_at EXATO vindo de check_availability." }

    const res = await resolveTargets(ctx.tenantId, args.service, args.resource)
    if (res.error || !res.targets) return { ok: false, toolMessage: res.error ?? "Agenda indisponível." }
    const { serviceId, resourceId } = res.targets

    // 🔒 ANTI-ALUCINAÇÃO: o starts_at TEM que ser um slot livre REAL do motor.
    // Se a IA inventou um horário, isto rejeita — fail-closed.
    const slots = await availabilitySlots(ctx.tenantId, {
      resourceId, serviceId,
      rangeStart: new Date(start.getTime() - 60_000).toISOString(),
      rangeEnd:   new Date(start.getTime() + 86_400_000).toISOString(),
    })
    const real = slots.some((s) => Math.abs(new Date(s.start).getTime() - start.getTime()) < 1000)
    if (!real) return { ok: false, toolMessage: "Esse horário não está livre. Chame check_availability de novo e ofereça SOMENTE os horários retornados." }

    // Simulador: valida tudo, mas não escreve.
    if (ctx.dryRun) return { ok: true, toolMessage: `[simulação] Agendaria para ${fmtSlot(start.toISOString())}.` }

    const r = await bookAppointment(ctx.tenantId, {
      contactId: ctx.contact.id, conversationId: ctx.conversationId,
      resourceId, serviceId, startsAt: start.toISOString(),
      source: "ai", createdBy: null,
    })
    if (r.error) return { ok: false, toolMessage: `Não consegui marcar: ${r.error}. Ofereça outro horário (check_availability).` }
    return { ok: true, toolMessage: `Agendado com sucesso para ${fmtSlot(start.toISOString())}. ✅`, data: { appointmentId: r.id } }
  },
})

// ── reschedule_appointment (ação) ────────────────────────────────────────
interface RescheduleArgs { new_starts_at: string }

export const rescheduleAppointmentCapability = defineCapability<RescheduleArgs>({
  id:           RESCHEDULE_APPOINTMENT,
  name:         "Remarcar horário",
  category:     "external",
  minPlanLevel: 0,
  isNode:       true,
  toolSchema: {
    type: "function",
    function: {
      name: RESCHEDULE_APPOINTMENT,
      description:
        "Remarca o PRÓXIMO agendamento do cliente pra um novo horário. Use SOMENTE um new_starts_at vindo de " +
        "check_availability (o valor EXATO em [ ]). NUNCA invente horário.",
      parameters: {
        type: "object",
        properties: {
          new_starts_at: { type: "string", description: "novo starts_at ISO EXATO vindo de check_availability." },
        },
        required: ["new_starts_at"],
        additionalProperties: false,
      },
    },
  },
  parseArgs: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>
    return { new_starts_at: typeof p.new_starts_at === "string" ? p.new_starts_at.trim() : "" }
  },
  execute: async (ctx, args) => {
    if (!args.new_starts_at) return { ok: false, toolMessage: "Falta o novo horário. Chame check_availability e use um dos slots." }
    const start = new Date(args.new_starts_at)
    if (isNaN(start.getTime())) return { ok: false, toolMessage: "Horário inválido. Use um starts_at EXATO vindo de check_availability." }

    // Resolve o PRÓXIMO agendamento DESTE contato (anti-IDOR: filtra por contact_id).
    const { data: appt } = await supabaseAdmin.from("appointments")
      .select("id, resource_id, service_id").eq("tenant_id", ctx.tenantId).eq("contact_id", ctx.contact.id)
      .in("status", ["scheduled", "confirmed"]).gt("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true }).limit(1).maybeSingle()
    if (!appt) return { ok: false, toolMessage: "Não encontrei um agendamento futuro deste cliente pra remarcar." }

    // 🔒 ANTI-ALUCINAÇÃO: o novo horário tem que ser slot livre REAL do recurso.
    const slots = await availabilitySlots(ctx.tenantId, {
      resourceId: appt.resource_id, serviceId: appt.service_id,
      rangeStart: new Date(start.getTime() - 60_000).toISOString(),
      rangeEnd:   new Date(start.getTime() + 86_400_000).toISOString(),
    })
    const real = slots.some((s) => Math.abs(new Date(s.start).getTime() - start.getTime()) < 1000)
    if (!real) return { ok: false, toolMessage: "Esse horário não está livre. Chame check_availability e ofereça SOMENTE os retornados." }

    if (ctx.dryRun) return { ok: true, toolMessage: `[simulação] Remarcaria para ${fmtSlot(start.toISOString())}.` }

    const r = await moveAppointment(ctx.tenantId, appt.id, start.toISOString())
    if (r.error) return { ok: false, toolMessage: `Não consegui remarcar: ${r.error}. Ofereça outro horário (check_availability).` }
    return { ok: true, toolMessage: `Remarcado para ${fmtSlot(start.toISOString())}. ✅`, data: { appointmentId: appt.id } }
  },
})
