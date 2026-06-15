// ═══════════════════════════════════════════════════════════════
// Capacidades da Agenda (conector de DOMÍNIO) — Studio F2
// ═══════════════════════════════════════════════════════════════
// Implementação de REFERÊNCIA da Camada 1 (docs/capability-platform.md).
// NÃO expõe tabela crua: expõe operações VALIDADAS (disponibilidade real +
// reserva atômica). A IA nunca inventa horário. Server-less: reusa o núcleo
// `availabilitySlots`/`bookAppointment`. Doc: docs/agenda-design.md §5.
import { defineCapability } from "./registry"
import type { ExecCtx } from "./types"
import { supabaseAdmin } from "@/lib/supabase"
import {
  availabilitySlots, bookAppointment, moveAppointment,
  resolveAgendaTargets, availabilityPool, pickFreeInPool, type AgendaTargetSpec,
} from "@/lib/agenda/booking"

export const CHECK_AVAILABILITY      = "check_availability"
export const SCHEDULE_APPOINTMENT     = "schedule_appointment"
export const RESCHEDULE_APPOINTMENT   = "reschedule_appointment"

const TZ = "America/Sao_Paulo"
const HORIZON_DAYS = 21
const MAX_SLOTS = 6

// "qua 09/06 às 14h00" — legível; o ISO cru vai entre [ ] pra a IA reusar no schedule.
function fmtSlot(iso: string): string {
  const d = new Date(iso)
  const wd = d.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short" }).replace(".", "")
  const dm = d.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" })
  const hm = d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).replace(":", "h")
  return `${wd} ${dm} às ${hm}`
}

// `pool` = agendas candidatas (1 ou N). "Qualquer disponível" = união do pool
// (docs/agenda-routing.md §1–2). `resourceId` = pool[0] (fallback/back-compat).
/** Monta o spec de destino a partir do ctx (binding do nó) + os nomes que a IA passou. */
function targetSpec(ctx: ExecCtx, service: string, resource: string): AgendaTargetSpec {
  const b = ctx.agendaBinding ?? null
  return {
    mode:           b?.mode ?? "ai",
    serviceId:      b?.serviceId ?? null,
    resourceId:     b?.resourceId ?? null,
    serviceName:    service || undefined,
    resourceName:   resource || undefined,
    conversationId: ctx.conversationId,
  }
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
    const res = await resolveAgendaTargets(ctx.tenantId, targetSpec(ctx, args.service, args.resource))
    if (res.error) return { ok: false, toolMessage: res.error }
    const { serviceId, pool } = res

    const now = Date.now()
    const merged = await availabilityPool(ctx.tenantId, {
      pool, serviceId,
      rangeStart: new Date(now).toISOString(),
      rangeEnd:   new Date(now + HORIZON_DAYS * 86_400_000).toISOString(),
    })

    if (merged.length === 0) {
      return { ok: true, toolMessage: "Sem horários livres nos próximos dias — diga ao cliente que um atendente vai ajudar a encontrar." }
    }
    const list = merged.slice(0, MAX_SLOTS).map((s) => `${fmtSlot(s.start)} [${s.start}]`).join(" · ")
    return {
      ok: true,
      toolMessage: `Horários LIVRES (ofereça SOMENTE estes; o valor em [ ] é o starts_at exato pra agendar): ${list}`,
      data: { slots: merged.slice(0, MAX_SLOTS), serviceId },
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

    const res = await resolveAgendaTargets(ctx.tenantId, targetSpec(ctx, args.service, args.resource))
    if (res.error) return { ok: false, toolMessage: res.error }
    const { serviceId, pool } = res

    // 🔒 ANTI-ALUCINAÇÃO + RESOLUÇÃO DO POOL: acha a 1ª agenda do pool com ESTE
    // horário REALMENTE livre. Se a IA inventou (ou o pool todo encheu) → rejeita.
    const chosen = await pickFreeInPool(ctx.tenantId, { pool, serviceId, startsAt: start.toISOString() })
    if (!chosen) return { ok: false, toolMessage: "Esse horário não está livre. Chame check_availability de novo e ofereça SOMENTE os horários retornados." }

    // Simulador: valida tudo, mas não escreve.
    if (ctx.dryRun) return { ok: true, toolMessage: `[simulação] Agendaria para ${fmtSlot(start.toISOString())}.` }

    const r = await bookAppointment(ctx.tenantId, {
      contactId: ctx.contact.id, conversationId: ctx.conversationId,
      resourceId: chosen, serviceId, startsAt: start.toISOString(),
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
