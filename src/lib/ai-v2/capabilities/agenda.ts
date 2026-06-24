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
  // Playbook da AGENDA (Studio Engine §Pilar 1) — o craft de agendamento mora aqui,
  // não no prompt do cliente. Injeta data de hoje + serviços/agendas + as 8 regras.
  playbook: (ctx) => {
    const now = new Date()
    const hoje    = now.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })
    const hojeIso = now.toLocaleDateString("en-CA",  { timeZone: TZ })   // YYYY-MM-DD
    const services  = (ctx.services ?? []).map((s) => s.name)
    const resources = (ctx.resources ?? []).map((r) => r.name)
    const L = [
      `AGENDA — você PODE marcar horário. Hoje é ${hoje} (${hojeIso}); use isto pra resolver datas que o cliente citar ("sexta" = a próxima sexta-feira).`,
    ]
    if (services.length > 0)  L.push(`Serviços (use o nome exato): ${services.join(", ")}.`)
    if (resources.length > 0) L.push(`Agendas/profissionais: ${resources.join(", ")}.`)
    L.push(
      "COMO AGENDAR — siga à risca:",
      "1. NUNCA invente horário. Chame check_availability ANTES de oferecer e ofereça SOMENTE o que ela retornar. Pra marcar, passe em \"slot\" a LETRA daquele horário (A, B, C…) — copie a letra exata, NUNCA invente uma letra fora da lista nem escreva a data/hora.",
      "2. Recomende o horário mais próximo E pergunte se prefere outro dia/horário. Ex: \"Tenho terça às 09h — esse serve, ou prefere outro dia?\".",
      "3. Se o cliente citar um dia/período, chame check_availability com from_date (YYYY-MM-DD) e/ou period (manha/tarde/noite). NUNCA diga que não tem sem consultar aquele dia.",
      "4. Se não houver no dia/período pedido, diga e ofereça o mais próximo OU pergunte outro dia — nunca empurre só o mais cedo.",
      "5. ANTES de marcar, confirme o horário exato (\"Fecho terça às 09h, ok?\") e só marque após o \"sim\".",
      "6. Você NÃO tem lista de espera — não prometa \"te aviso quando abrir\". Se nada servir, transfira pro time.",
      "7. Reaproveite os horários que já consultou neste papo; só chame check_availability de novo se o cliente mudar o dia/período.",
      "8. Pegue o NOME da pessoa (update_contact) antes de marcar, pra a confirmação sair personalizada.",
      "9. ⚠️ DEMO/AGENDAMENTO trava a conclusão: se você ofereceu, mencionou OU o cliente topou uma demonstração/horário, NÃO chame finish_step (não conclua/transfira) até MARCAR o horário OU o cliente recusar claramente. NUNCA pergunte 'tem interesse em agendar?' e conclua na mesma resposta — se ele topar, chame check_availability, ofereça os horários, ESPERE a escolha e MARQUE primeiro. Só depois de marcar (ou recusa) você segue.",
    )
    return L.join("\n")
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
    // Rotula cada horário com uma LETRA e guarda o mapa letra→ISO (+ pool/serviço) no
    // estado da conversa. A IA oferta as letras; pra marcar, COPIA a letra (não inventa).
    const top = merged.slice(0, Math.min(MAX_SLOTS, LETTERS.length))
    const slots: Record<string, string> = {}
    top.forEach((s, i) => { slots[LETTERS[i]] = s.start })
    await saveOffer(ctx, { at: Date.now(), serviceId, pool, slots })
    const list = top.map((s, i) => `${LETTERS[i]}) ${fmtSlot(s.start)}`).join(" · ")
    return {
      ok: true,
      toolMessage: `Horários LIVRES (ofereça SOMENTE estes; pra marcar, passe em "slot" a LETRA exata — NUNCA invente uma letra fora da lista): ${list}`,
      data: { slots: top, serviceId },
    }
  },
})

// 🔡 TOKEN DE HORÁRIO (anti-fuso E anti-fabricação): o check_availability rotula cada
// horário com uma LETRA (A, B, C…) e guarda o mapa letra→instante no estado da conversa
// (metadata.ai_slot_offer). A IA COPIA a letra — 1 char de um alfabeto FECHADO, que ela
// não tem como fabricar (e se inventar, o erro devolve as letras válidas → corrige em 1
// turno, SEM re-listar). Substitui o epoch de 13 dígitos, que o LLM "chutava" (passava um
// 1750…=2025 em vez de copiar o 1781…=2026 → a trava rejeitava e ela re-ofertava em loop).
// O servidor resolve letra→ISO exato (segue anti-fuso) e `pickFreeInPool` revalida (corrida).
const LETTERS = "ABCDEFGH"
const SLOT_TTL_MS = 20 * 60_000
const SLOT_HINT = "Passe a LETRA (A, B, C…) do horário escolhido, exatamente como na lista do check_availability."

interface SlotOffer { at: number; serviceId: string | null; pool: string[]; slots: Record<string, string> }

async function writeMeta(ctx: ExecCtx): Promise<void> {
  const meta = { ...(ctx.conversationMetadata ?? {}) }
  try {
    await supabaseAdmin.from("chat_conversations").update({ metadata: meta }).eq("id", ctx.conversationId).eq("tenant_id", ctx.tenantId)
  } catch (e) { console.error("[agenda] writeMeta:", e instanceof Error ? e.message : e) }
}
/** Guarda a oferta no estado (in-memory pro mesmo turno + DB pro próximo). */
async function saveOffer(ctx: ExecCtx, offer: SlotOffer): Promise<void> {
  ctx.conversationMetadata.ai_slot_offer = offer
  await writeMeta(ctx)
}
function readOffer(ctx: ExecCtx): SlotOffer | null {
  const o = (ctx.conversationMetadata?.ai_slot_offer ?? null) as SlotOffer | null
  if (!o || typeof o.at !== "number" || !o.slots) return null
  if (Date.now() - o.at > SLOT_TTL_MS) return null   // expirou → re-consultar
  return o
}
async function clearOffer(ctx: ExecCtx): Promise<void> {
  if (ctx.conversationMetadata) delete ctx.conversationMetadata.ai_slot_offer
  await writeMeta(ctx)
}
/** Extrai a letra A–H que a IA passou (tolerante a "B", "b", "letra B"). */
function parseSlotLetter(raw: string): string | null {
  const m = raw.trim().toUpperCase().match(/[A-H]/)
  return m ? m[0] : null
}

// ── schedule_appointment (ação) ──────────────────────────────────────────
interface ScheduleArgs { slot: string }

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
        "Marca um horário pro cliente. Use SOMENTE a LETRA (A, B, C…) do horário que veio do check_availability — " +
        "copie a letra exata, NÃO escreva data/hora nem invente uma letra fora da lista. Se der erro/indisponível, chame check_availability de novo.",
      parameters: {
        type: "object",
        properties: {
          slot: { type: "string", description: "A LETRA do horário escolhido (A, B, C…), exatamente como apareceu na lista do check_availability." },
        },
        required: ["slot"],
        additionalProperties: false,
      },
    },
  },
  parseArgs: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>
    return { slot: typeof p.slot === "string" ? p.slot.trim() : "" }
  },
  execute: async (ctx, args) => {
    // Resolve a LETRA contra a oferta guardada (serviço/pool já vêm dela → fonte única).
    const offer = readOffer(ctx)
    if (!offer) return { ok: false, toolMessage: `Não há lista de horários ativa (ou expirou). Chame check_availability primeiro e ofereça os horários. ${SLOT_HINT}` }
    const letter = parseSlotLetter(args.slot)
    if (!letter || !offer.slots[letter]) {
      const valid = Object.keys(offer.slots).join(", ")
      return { ok: false, toolMessage: `A letra "${args.slot}" não está na lista atual. Letras válidas: ${valid}. NÃO invente — confirme com o cliente qual dessas, ou chame check_availability de novo.` }
    }
    const iso = offer.slots[letter]

    // 🔒 ANTI-CORRIDA + RESOLUÇÃO DO POOL: acha a 1ª agenda do pool com ESTE horário
    // REALMENTE livre (o slot pode ter enchido entre a oferta e a marca).
    const chosen = await pickFreeInPool(ctx.tenantId, { pool: offer.pool, serviceId: offer.serviceId, startsAt: iso })
    if (!chosen) return { ok: false, toolMessage: `O horário ${fmtSlot(iso)} (${letter}) acabou de ser ocupado. Chame check_availability de novo e ofereça SOMENTE os retornados.` }

    if (ctx.dryRun) return { ok: true, toolMessage: `[simulação] Agendaria para ${fmtSlot(iso)}.` }

    const r = await bookAppointment(ctx.tenantId, {
      contactId: ctx.contact.id, conversationId: ctx.conversationId,
      resourceId: chosen, serviceId: offer.serviceId, startsAt: iso,
      source: "ai", createdBy: null, conversationalConfirm: true,
    })
    if (r.error) return { ok: false, toolMessage: `Não consegui marcar: ${r.error}. Ofereça outro horário (check_availability).` }
    await clearOffer(ctx)
    return { ok: true, toolMessage: `Agendado com sucesso para ${fmtSlot(iso)}. ✅`, data: { appointmentId: r.id } }
  },
})

// ── reschedule_appointment (ação) ────────────────────────────────────────
interface RescheduleArgs { new_slot: string }

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
        "Remarca o PRÓXIMO agendamento do cliente pra um novo horário. Use SOMENTE a LETRA (A, B, C…) do horário que " +
        "veio do check_availability — copie a letra exata, não escreva data/hora nem invente. NUNCA invente horário.",
      parameters: {
        type: "object",
        properties: {
          new_slot: { type: "string", description: "A LETRA do novo horário (A, B, C…), exatamente como na lista do check_availability." },
        },
        required: ["new_slot"],
        additionalProperties: false,
      },
    },
  },
  parseArgs: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>
    return { new_slot: typeof p.new_slot === "string" ? p.new_slot.trim() : "" }
  },
  execute: async (ctx, args) => {
    const offer = readOffer(ctx)
    if (!offer) return { ok: false, toolMessage: `Não há lista de horários ativa (ou expirou). Chame check_availability primeiro. ${SLOT_HINT}` }
    const letter = parseSlotLetter(args.new_slot)
    if (!letter || !offer.slots[letter]) {
      const valid = Object.keys(offer.slots).join(", ")
      return { ok: false, toolMessage: `A letra "${args.new_slot}" não está na lista atual. Letras válidas: ${valid}. NÃO invente.` }
    }
    const start = new Date(offer.slots[letter])

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
    await clearOffer(ctx)
    return { ok: true, toolMessage: `Remarcado para ${fmtSlot(start.toISOString())}. ✅`, data: { appointmentId: appt.id } }
  },
})
