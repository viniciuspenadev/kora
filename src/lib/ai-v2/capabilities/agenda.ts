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

// ── targeting de DIA/PERÍODO (alavanca 1: honrar "sexta à tarde") ─────────
const PERIODS = new Set(["manha", "tarde", "noite"])

/** Hora (0–23) de um instante no fuso da agenda. */
function hourInTZ(iso: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)))
}
function inPeriod(iso: string, period: string): boolean {
  const h = hourInTZ(iso)
  if (period === "manha") return h < 12
  if (period === "tarde") return h >= 12 && h < 18
  if (period === "noite") return h >= 18
  return true
}
/** Offset (ms) tal que wall-clock(TZ) = utc + offset (Brasil sem DST → -3h exato). */
function tzOffsetMs(instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instant))
  const p: Record<string, number> = {}
  for (const x of parts) if (x.type !== "literal") p[x.type] = Number(x.value)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant
}
/** Intervalo UTC [00:00, 24:00) do dia local YYYY-MM-DD no fuso da agenda. null = inválido. */
function localDayRange(dateStr: string): { start: number; end: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  if (!m) return null
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0)
  const start = guess - tzOffsetMs(guess)
  return { start, end: start + 24 * 3600_000 }
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
interface CheckArgs { service: string; resource: string; from_date: string; period: string }

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
        "NUNCA invente horário, ofereça SOMENTE os que esta ferramenta retornar. Se o cliente citar um dia ou " +
        "período, passe from_date/period — NUNCA diga que não tem sem consultar aquele dia.",
      parameters: {
        type: "object",
        properties: {
          service:   { type: "string", description: "Nome do serviço (ex: Corte). Opcional." },
          resource:  { type: "string", description: "Nome da agenda/profissional (ex: João). Opcional." },
          from_date: { type: "string", description: "Dia desejado pelo cliente em YYYY-MM-DD (ex: a próxima sexta). Opcional — sem ele, busca a partir de hoje." },
          period:    { type: "string", enum: ["manha", "tarde", "noite"], description: "Período do dia se o cliente pedir (manhã/tarde/noite). Opcional." },
        },
        additionalProperties: false,
      },
    },
  },
  parseArgs: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>
    const period = typeof p.period === "string" ? p.period.trim().toLowerCase() : ""
    return {
      service:   typeof p.service === "string"   ? p.service.trim()   : "",
      resource:  typeof p.resource === "string"  ? p.resource.trim()  : "",
      from_date: typeof p.from_date === "string" ? p.from_date.trim() : "",
      period:    PERIODS.has(period) ? period : "",
    }
  },
  execute: async (ctx, args) => {
    const res = await resolveAgendaTargets(ctx.tenantId, targetSpec(ctx, args.service, args.resource))
    if (res.error) return { ok: false, toolMessage: res.error }
    const { serviceId, pool } = res

    const now = Date.now()
    const day = args.from_date ? localDayRange(args.from_date) : null
    const rangeStart = day ? new Date(Math.max(now, day.start)).toISOString() : new Date(now).toISOString()
    const rangeEnd   = day ? new Date(day.end).toISOString()                  : new Date(now + HORIZON_DAYS * 86_400_000).toISOString()

    let merged = await availabilityPool(ctx.tenantId, { pool, serviceId, rangeStart, rangeEnd })
    if (args.period) merged = merged.filter((s) => inPeriod(s.start, args.period))

    if (merged.length === 0) {
      const onde = day ? "nesse dia" : "nos próximos dias"
      const qual = args.period ? ` de ${args.period}` : ""
      return { ok: true, toolMessage: `Sem horários livres${qual} ${onde}. Diga ao cliente e ofereça outro dia/período (ou um atendente ajuda a encontrar).` }
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
