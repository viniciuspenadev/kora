// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — nó AGENDAR (determinístico, ZERO token)
// ═══════════════════════════════════════════════════════════════
// Mesma espinha do nó Menu (oferta → espera → resume → ramifica), mas as
// opções são DINÂMICAS (horários reais do motor) e o "escolher" tem efeito
// colateral (marca de fato + re-valida anti-double-book). Reusa o núcleo
// server-less da agenda (booking.ts) → roteamento idêntico ao da IA.
//
// DOIS modos (cfg.offerMode):
//   • "slots" (default): lista PLANA dos próximos horários (cruza dias). Bom pra
//     agenda enxuta — 1 toque resolve.
//   • "by_day": o cliente escolhe o DIA primeiro (dias com vaga → "ver mais dias")
//     e depois o HORÁRIO daquele dia. Bom pra agenda cheia.
// Render (cfg.render) decide o veículo (auto/interactive/numbered) — via sendOptions.
// Doc: docs/agenda-design.md §5 + agenda-routing.md.

import "server-only"
import { sendBotText } from "../outbound"
import { sendOptions } from "./interactive"
import { parseScheduleRequest, localDayRange, inPeriod } from "./ai-schedule"
import type { ExecCtx } from "../capabilities/types"
import type { ScheduleNodeConfig } from "./types"
import { resolveAgendaTargets, availabilityPool, pickFreeInPool, bookAppointment } from "@/lib/agenda/booking"
import { hasModule } from "@/lib/modules"

const TZ = "America/Sao_Paulo"

const NONE_ID = "schedule:none", NONE_LABEL = "Nenhum desses"
const MORE_ID = "schedule:more", MORE_LABEL = "Ver mais dias"
const BACK_ID = "schedule:back", BACK_LABEL = "Outro dia"
// No by_day o passo de DATA tem pergunta própria de DIA (o `intro` do autor é
// sobre HORÁRIO → fica pro passo de horário; senão "Escolha o horário" apareceria
// em cima de uma lista de dias).
const DATE_PROMPT = "Qual dia fica melhor pra você?"

const HORIZON_DEFAULT = 21
const MAXSLOTS_DEFAULT = 6
const MAXSLOTS_CAP = 9          // +1 "nenhum" ≤ 10 (limite de rows da lista Meta)
const DATE_PAGE = 7             // dias por página (≤9, +1 controle ≤ 10 rows)
const TIME_CAP = 9              // horários por dia (≤9, +1 "outro dia" ≤ 10)
const BYDAY_SLOT_CAP = 140      // teto defensivo do varrimento por-dia

// ── formatação ────────────────────────────────────────────────
/** "sex 12/06 às 14h00" — legível e ≤24 chars (cabe no title da row Meta). */
export function fmtSlot(iso: string): string {
  const d = new Date(iso)
  const wd = d.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short" }).replace(".", "")
  const dm = d.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" })
  const hm = d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).replace(":", "h")
  return `${wd} ${dm} às ${hm}`
}
/** Chave de dia no fuso (YYYY-MM-DD) — ordenável cronologicamente como string. */
function dayKey(iso: string): string { return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ }) }
/** "Hoje 16/06" / "Amanhã 17/06" / "qui 18/06" — ≤24 chars. */
function fmtDay(iso: string): string {
  const d = new Date(iso)
  const k = dayKey(iso)
  const todayK    = new Date().toLocaleDateString("en-CA", { timeZone: TZ })
  const tomorrowK = new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", { timeZone: TZ })
  const dm = d.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" })
  if (k === todayK)    return `Hoje ${dm}`
  if (k === tomorrowK) return `Amanhã ${dm}`
  const wd = d.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short" }).replace(".", "")
  return `${wd} ${dm}`
}
/** "09h00" — horário curto pra a oferta do dia. */
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).replace(":", "h")
}

// ── stash do nó (entre oferta e pick) — vive em variables[schedule:<id>] ──
export type ScheduleStash =
  | { mode: "slots"; serviceId: string | null; pool: string[]; slots: string[] }
  | { mode: "by_day"; serviceId: string | null; pool: string[]; byDay: Record<string, string[]>; dayKeys: string[]; phase: "date"; pageStart: number }
  | { mode: "by_day"; serviceId: string | null; pool: string[]; byDay: Record<string, string[]>; dayKeys: string[]; phase: "time"; pageStart: number; chosenDay: string; slots: string[] }
  // aiParse: a IA não identificou o serviço → o cliente escolhe (picker determinístico);
  // dia/período já interpretados ficam guardados pra estreitar a oferta depois.
  | { mode: "pick_service"; services: { id: string; name: string }[]; fromDate: string; period: string }

// ── núcleo: resolve destino + disponibilidade ──────────────────
export interface ScheduleOffer { slots: string[]; serviceId: string | null; pool: string[] }

async function resolvePool(ctx: ExecCtx, cfg: ScheduleNodeConfig) {
  const t = cfg.target
  return resolveAgendaTargets(ctx.tenantId, {
    mode:           t?.mode === "owner" ? "owner" : "fixed",
    serviceId:      t?.serviceId ?? null,
    resourceId:     t?.resourceId ?? null,
    conversationId: ctx.conversationId,
  })
}

/** Destino já resolvido (aiParse: serviço escolhido pela IA/picker) — pula resolvePool. */
type Resolved = { serviceId: string | null; pool: string[] }

/** Modo "slots": resolve destino + UNIÃO de horários do pool (null = sem destino). */
export async function prepareScheduleOffer(ctx: ExecCtx, cfg: ScheduleNodeConfig, resolved?: Resolved): Promise<ScheduleOffer | null> {
  let serviceId: string | null, pool: string[]
  if (resolved) { serviceId = resolved.serviceId; pool = resolved.pool }
  else {
    const res = await resolvePool(ctx, cfg)
    if (res.error || res.pool.length === 0) return null   // fail-closed → ramo "sem_horario"
    serviceId = res.serviceId; pool = res.pool
  }
  const now = Date.now()
  const horizon = Math.max(1, cfg.horizonDays ?? HORIZON_DEFAULT)
  const merged = await availabilityPool(ctx.tenantId, {
    pool, serviceId,
    rangeStart: new Date(now).toISOString(),
    rangeEnd:   new Date(now + horizon * 86_400_000).toISOString(),
  })
  const max = Math.min(Math.max(1, cfg.maxSlots ?? MAXSLOTS_DEFAULT), MAXSLOTS_CAP)
  return { slots: merged.slice(0, max).map((s) => s.start), serviceId, pool }
}

export interface DayOffer { serviceId: string | null; pool: string[]; dayKeys: string[]; byDay: Record<string, string[]> }

/** Modo "by_day": disponibilidade do horizonte agrupada por DIA (null = sem vaga). */
export async function prepareDayOffer(ctx: ExecCtx, cfg: ScheduleNodeConfig, resolved?: Resolved): Promise<DayOffer | null> {
  let serviceId: string | null, pool: string[]
  if (resolved) { serviceId = resolved.serviceId; pool = resolved.pool }
  else {
    const res = await resolvePool(ctx, cfg)
    if (res.error || res.pool.length === 0) return null
    serviceId = res.serviceId; pool = res.pool
  }
  const now = Date.now()
  const horizon = Math.max(1, cfg.horizonDays ?? HORIZON_DEFAULT)
  const merged = await availabilityPool(ctx.tenantId, {
    pool, serviceId,
    rangeStart: new Date(now).toISOString(),
    rangeEnd:   new Date(now + horizon * 86_400_000).toISOString(),
  })
  const byDay: Record<string, string[]> = {}
  for (const s of merged.slice(0, BYDAY_SLOT_CAP)) {
    const k = dayKey(s.start)
    if (!byDay[k]) byDay[k] = []
    if (byDay[k].length < TIME_CAP) byDay[k].push(s.start)
  }
  const dayKeys = Object.keys(byDay).sort()
  if (dayKeys.length === 0) return null
  return { serviceId, pool, dayKeys, byDay }
}

/** Re-valida o slot no pool e MARCA. `taken` = encheu agora; `id` = sucesso. */
export async function bookSchedulePick(
  ctx: ExecCtx, input: { iso: string; serviceId: string | null; pool: string[] },
): Promise<{ id?: string; taken?: boolean; error?: string }> {
  const resourceId = await pickFreeInPool(ctx.tenantId, { pool: input.pool, serviceId: input.serviceId, startsAt: input.iso })
  if (!resourceId) return { taken: true }
  if (ctx.dryRun) return {}   // simulador: valida disponibilidade, não escreve
  const r = await bookAppointment(ctx.tenantId, {
    contactId: ctx.contact.id, conversationId: ctx.conversationId,
    resourceId, serviceId: input.serviceId, startsAt: input.iso,
    source: "manual", createdBy: null, conversationalConfirm: true,
  })
  if (r.error) return /preenchido|lotado|bloqueado/i.test(r.error) ? { taken: true } : { error: r.error }
  return { id: r.id }
}

// ── envio das ofertas (slots / data / hora) ────────────────────
const SCHED_META = { studio_schedule: true }

/** Oferta PLANA (modo slots): horários + "Nenhum desses". */
export async function sendScheduleOffer(ctx: ExecCtx, cfg: ScheduleNodeConfig, slots: string[]): Promise<void> {
  await sendOptions(ctx, {
    render:     cfg.render,
    body:       cfg.intro?.trim() || "Escolha o melhor horário:",
    items:      slots.map((s, i) => ({ id: `schedule:slot:${i}`, title: fmtSlot(s) })),
    last:       { id: NONE_ID, title: NONE_LABEL },
    listButton: "Ver horários",
    meta:       SCHED_META,
  })
}

/** Oferta de DIAS (by_day, fase date): dias com vaga + "Ver mais dias"/"Nenhum desses". */
async function sendDateOffer(ctx: ExecCtx, cfg: ScheduleNodeConfig, stash: Extract<ScheduleStash, { phase: "date" }>): Promise<void> {
  const page = stash.dayKeys.slice(stash.pageStart, stash.pageStart + DATE_PAGE)
  const hasMore = stash.pageStart + DATE_PAGE < stash.dayKeys.length
  await sendOptions(ctx, {
    render:     cfg.render,
    body:       DATE_PROMPT,
    items:      page.map((k, i) => ({ id: `schedule:day:${i}`, title: fmtDay(stash.byDay[k][0]) })),
    last:       hasMore ? { id: MORE_ID, title: MORE_LABEL } : { id: NONE_ID, title: NONE_LABEL },
    listButton: "Ver dias",
    meta:       SCHED_META,
  })
}

/** Oferta de HORÁRIOS de um dia (by_day, fase time): horários + "Outro dia". */
async function sendTimeOffer(ctx: ExecCtx, cfg: ScheduleNodeConfig, stash: Extract<ScheduleStash, { phase: "time" }>): Promise<void> {
  const day = fmtDay(stash.slots[0])
  await sendOptions(ctx, {
    render:     cfg.render,
    body:       cfg.intro?.trim() ? `${cfg.intro.trim()} (${day})` : `Horários pra ${day}:`,
    items:      stash.slots.map((s, i) => ({ id: `schedule:slot:${i}`, title: fmtTime(s) })),
    last:       { id: BACK_ID, title: BACK_LABEL },
    listButton: "Ver horários",
    meta:       SCHED_META,
  })
}

// ── parsing das respostas ──────────────────────────────────────
type DatePick = { kind: "day"; index: number } | { kind: "more" } | { kind: "none" }
type TimePick = { kind: "slot"; index: number } | { kind: "back" } | { kind: "none" }
type SlotPick = { kind: "slot"; index: number } | { kind: "none" }

// ── roteio determinístico por id (Oficial) ─────────────────────
// O tap numa row/botão devolve EXATAMENTE o token que enviamos (schedule:slot:<i> ·
// schedule:day:<i> · schedule:svc:<i> · schedule:none/more/back). Cada resolver
// traduz o token no MESMO *Pick que o parser de texto produz → a máquina de estados
// abaixo não muda. Token de OUTRO contexto (ex.: "day" recebido na fase slots) →
// null → cai no parse de texto (que vira re-pergunta se também não casar).
const SCHED_TOKEN = "schedule:"
function tokenParts(optionId?: string): string[] | null {
  return optionId?.startsWith(SCHED_TOKEN) ? optionId.split(":") : null
}
function tokenSlotPick(optionId: string | undefined, slots: string[]): SlotPick | null {
  const p = tokenParts(optionId); if (!p) return null
  if (p[1] === "none") return { kind: "none" }
  if (p[1] === "slot") { const i = parseInt(p[2] ?? "", 10); if (i >= 0 && i < slots.length) return { kind: "slot", index: i } }
  return null
}
function tokenDatePick(optionId: string | undefined, page: string[], hasMore: boolean): DatePick | null {
  const p = tokenParts(optionId); if (!p) return null
  if (p[1] === "none") return { kind: "none" }
  if (p[1] === "more") return hasMore ? { kind: "more" } : { kind: "none" }
  if (p[1] === "day") { const i = parseInt(p[2] ?? "", 10); if (i >= 0 && i < page.length) return { kind: "day", index: i } }
  return null
}
function tokenTimePick(optionId: string | undefined, slots: string[]): TimePick | null {
  const p = tokenParts(optionId); if (!p) return null
  if (p[1] === "none") return { kind: "none" }
  if (p[1] === "back") return { kind: "back" }
  if (p[1] === "slot") { const i = parseInt(p[2] ?? "", 10); if (i >= 0 && i < slots.length) return { kind: "slot", index: i } }
  return null
}
function tokenServiceIndex(optionId: string | undefined, services: { id: string; name: string }[]): number | null {
  const p = tokenParts(optionId); if (!p || p[1] !== "svc") return null
  const i = parseInt(p[2] ?? "", 10)
  return i >= 0 && i < services.length ? i : null
}

/** Modo slots: tap (título) > "nenhum"/0 > número digitado. */
function parseSlotPick(reply: string, slots: string[]): SlotPick | null {
  const r = reply.trim().toLowerCase()
  if (!r) return null
  for (let i = 0; i < slots.length; i++) if (r === fmtSlot(slots[i]).toLowerCase()) return { kind: "slot", index: i }
  if (/\b0\b/.test(r) || /(nenhum|nenhuma|outro|outra|outros|mais|n[aã]o)/.test(r)) return { kind: "none" }
  const num = r.match(/\d+/)
  if (num) { const idx = parseInt(num[0], 10) - 1; if (idx >= 0 && idx < slots.length) return { kind: "slot", index: idx } }
  return null
}
function parseDatePick(reply: string, page: string[], hasMore: boolean): DatePick | null {
  const r = reply.trim().toLowerCase()
  if (!r) return null
  for (let i = 0; i < page.length; i++) if (r === fmtDay(page[i]).toLowerCase()) return { kind: "day", index: i }
  if (/(ver mais|mais dias|outros dias|pr[oó]ximos)/.test(r)) return hasMore ? { kind: "more" } : { kind: "none" }
  if (/(nenhum|nenhuma|cancelar|desistir)/.test(r)) return { kind: "none" }
  if (/\b0\b/.test(r)) return hasMore ? { kind: "more" } : { kind: "none" }
  const num = r.match(/\d+/)
  if (num) { const idx = parseInt(num[0], 10) - 1; if (idx >= 0 && idx < page.length) return { kind: "day", index: idx } }
  return null
}
function parseTimePick(reply: string, slots: string[]): TimePick | null {
  const r = reply.trim().toLowerCase()
  if (!r) return null
  for (let i = 0; i < slots.length; i++) if (r === fmtTime(slots[i]).toLowerCase()) return { kind: "slot", index: i }
  if (/(outro dia|voltar|trocar.*dia|mudar.*dia)/.test(r)) return { kind: "back" }
  if (/(nenhum|nenhuma|cancelar|desistir)/.test(r)) return { kind: "none" }
  if (/\b0\b/.test(r)) return { kind: "back" }
  const num = r.match(/\d+/)
  if (num) { const idx = parseInt(num[0], 10) - 1; if (idx >= 0 && idx < slots.length) return { kind: "slot", index: idx } }
  return null
}

// ── RESUME: processa a resposta do cliente (slots OU by_day) ───
// Centraliza TODA a máquina de estados do nó. O runtime só persiste o stash (wait)
// ou segue a aresta (branch). Faz os envios aqui dentro (oferta/re-oferta/confirma).
export type ScheduleResume =
  | { kind: "wait"; stash: ScheduleStash }                                       // sentou algo, segue esperando
  | { kind: "branch"; branch: string; responded: boolean; agendamento?: string } // avança pela aresta

const SUCCESS_DEFAULT = "✅ Agendado! Seu horário: {{horario}}. Até lá 😊"
function successMsg(cfg: ScheduleNodeConfig, iso: string): string {
  return (cfg.successText?.trim() || SUCCESS_DEFAULT).replace(/\{\{\s*horario\s*\}\}/g, fmtSlot(iso))
}
async function book(ctx: ExecCtx, cfg: ScheduleNodeConfig, iso: string, serviceId: string | null, pool: string[]): Promise<ScheduleResume | "taken" | "error"> {
  const r = await bookSchedulePick(ctx, { iso, serviceId, pool })
  if (r.taken) return "taken"
  if (r.error) return "error"
  await sendBotText(ctx, successMsg(cfg, iso), SCHED_META)
  return { kind: "branch", branch: "agendado", responded: true, agendamento: fmtSlot(iso) }
}

export async function resumeSchedule(
  ctx: ExecCtx, cfg: ScheduleNodeConfig, stash: ScheduleStash | undefined, reply: string,
  optionId?: string,   // Oficial: token `schedule:*` do tap → roteio determinístico (id-first)
): Promise<ScheduleResume> {
  // ── aiParse: cliente escolheu o serviço no picker → resolve + oferta ──
  if (stash?.mode === "pick_service") {
    const idx = tokenServiceIndex(optionId, stash.services) ?? pickServiceIndex(reply, stash.services)
    if (idx == null) {
      await sendBotText(ctx, "É só escolher um dos serviços 👇", SCHED_META)
      await sendServicePicker(ctx, cfg, stash.services)
      return { kind: "wait", stash }
    }
    const r = await resolveServiceId(ctx, cfg, stash.services[idx].id)
    if (!r) return { kind: "branch", branch: "sem_horario", responded: false }
    return offerForResolved(ctx, cfg, r, stash.fromDate, stash.period)
  }

  // ── modo slots (default; cobre stash antigo sem `mode`) ──
  if (!stash || stash.mode === "slots") {
    const s = (stash as Extract<ScheduleStash, { mode: "slots" }> | undefined) ?? { mode: "slots", slots: [], serviceId: null, pool: [] }
    const pick = tokenSlotPick(optionId, s.slots) ?? parseSlotPick(reply, s.slots)
    if (!pick) {
      await sendBotText(ctx, "É só responder com o *número* do horário (ou 0 se nenhum servir).", SCHED_META)
      await sendScheduleOffer(ctx, cfg, s.slots)
      return { kind: "wait", stash: s }
    }
    if (pick.kind === "none") return { kind: "branch", branch: "sem_horario", responded: false }
    const out = await book(ctx, cfg, s.slots[pick.index], s.serviceId, s.pool)
    if (out === "error") return { kind: "branch", branch: "sem_horario", responded: false }
    if (out === "taken") {
      await sendBotText(ctx, "Opa, esse horário acabou de ser preenchido 😕", SCHED_META)
      const fresh = await prepareScheduleOffer(ctx, cfg)
      if (!fresh || fresh.slots.length === 0) return { kind: "branch", branch: "sem_horario", responded: false }
      await sendScheduleOffer(ctx, cfg, fresh.slots)
      return { kind: "wait", stash: { mode: "slots", slots: fresh.slots, serviceId: fresh.serviceId, pool: fresh.pool } }
    }
    return out
  }

  // ── modo by_day ──
  if (stash.phase === "date") {
    const page = stash.dayKeys.slice(stash.pageStart, stash.pageStart + DATE_PAGE)
    const hasMore = stash.pageStart + DATE_PAGE < stash.dayKeys.length
    const pick = tokenDatePick(optionId, page, hasMore) ?? parseDatePick(reply, page.map((k) => stash.byDay[k][0]), hasMore)
    if (!pick) {
      await sendBotText(ctx, "É só tocar (ou responder o número) do dia que prefere.", SCHED_META)
      await sendDateOffer(ctx, cfg, stash)
      return { kind: "wait", stash }
    }
    if (pick.kind === "none") return { kind: "branch", branch: "sem_horario", responded: false }
    if (pick.kind === "more") {
      const next = { ...stash, pageStart: stash.pageStart + DATE_PAGE }
      await sendDateOffer(ctx, cfg, next)
      return { kind: "wait", stash: next }
    }
    const chosenDay = stash.dayKeys[stash.pageStart + pick.index]
    const slots = stash.byDay[chosenDay] ?? []
    if (slots.length === 0) return { kind: "branch", branch: "sem_horario", responded: false }
    const next: ScheduleStash = { mode: "by_day", serviceId: stash.serviceId, pool: stash.pool, byDay: stash.byDay, dayKeys: stash.dayKeys, phase: "time", pageStart: stash.pageStart, chosenDay, slots }
    await sendTimeOffer(ctx, cfg, next)
    return { kind: "wait", stash: next }
  }

  // phase === "time"
  const pick = tokenTimePick(optionId, stash.slots) ?? parseTimePick(reply, stash.slots)
  if (!pick) {
    await sendBotText(ctx, "É só tocar (ou responder o número) do horário.", SCHED_META)
    await sendTimeOffer(ctx, cfg, stash)
    return { kind: "wait", stash }
  }
  if (pick.kind === "none") return { kind: "branch", branch: "sem_horario", responded: false }
  if (pick.kind === "back") {
    const back: ScheduleStash = { mode: "by_day", serviceId: stash.serviceId, pool: stash.pool, byDay: stash.byDay, dayKeys: stash.dayKeys, phase: "date", pageStart: stash.pageStart }
    await sendDateOffer(ctx, cfg, back)
    return { kind: "wait", stash: back }
  }
  const out = await book(ctx, cfg, stash.slots[pick.index], stash.serviceId, stash.pool)
  if (out === "error") return { kind: "branch", branch: "sem_horario", responded: false }
  if (out === "taken") {
    await sendBotText(ctx, "Opa, esse horário acabou de ser preenchido 😕", SCHED_META)
    const fresh = await prepareDayOffer(ctx, cfg)
    if (!fresh) return { kind: "branch", branch: "sem_horario", responded: false }
    const dayLeft = fresh.byDay[stash.chosenDay]
    if (dayLeft?.length) {
      const next: ScheduleStash = { mode: "by_day", serviceId: fresh.serviceId, pool: fresh.pool, byDay: fresh.byDay, dayKeys: fresh.dayKeys, phase: "time", pageStart: 0, chosenDay: stash.chosenDay, slots: dayLeft }
      await sendTimeOffer(ctx, cfg, next)
      return { kind: "wait", stash: next }
    }
    const back: ScheduleStash = { mode: "by_day", serviceId: fresh.serviceId, pool: fresh.pool, byDay: fresh.byDay, dayKeys: fresh.dayKeys, phase: "date", pageStart: 0 }
    await sendDateOffer(ctx, cfg, back)
    return { kind: "wait", stash: back }
  }
  return out
}

// ── aiParse: a IA INTERPRETA (serviço/dia/período); o motor oferta/marca ──
// A IA só preenche {serviço, dia, período} — não oferta, não marca, não confirma
// (impossível alucinar/cravar). Serviço casa contra a lista REAL; não casou → picker.
function matchService(name: string, services: { id: string; name: string }[]): string | null {
  const n = name.trim().toLowerCase()
  if (!n) return null
  const exact = services.find((s) => s.name.trim().toLowerCase() === n)
  if (exact) return exact.id
  const partial = services.find((s) => { const sn = s.name.trim().toLowerCase(); return sn && (n.includes(sn) || sn.includes(n)) })
  return partial?.id ?? null
}

async function resolveServiceId(ctx: ExecCtx, cfg: ScheduleNodeConfig, serviceId: string): Promise<Resolved | null> {
  const t = cfg.target
  const res = await resolveAgendaTargets(ctx.tenantId, {
    mode:           t?.mode === "owner" ? "owner" : "fixed",
    serviceId,
    resourceId:     t?.resourceId ?? null,
    conversationId: ctx.conversationId,
  })
  if (res.error || res.pool.length === 0) return null
  return { serviceId: res.serviceId, pool: res.pool }
}

/** Horários de UM dia (filtrado por período) — a alavanca "sexta à tarde". */
async function daySlots(ctx: ExecCtx, cfg: ScheduleNodeConfig, r: Resolved, fromDate: string, period: string): Promise<string[]> {
  const range = localDayRange(fromDate)
  if (!range) return []
  const now = Date.now()
  if (range.end <= now) return []
  const merged = await availabilityPool(ctx.tenantId, {
    pool: r.pool, serviceId: r.serviceId,
    rangeStart: new Date(Math.max(now, range.start)).toISOString(),
    rangeEnd:   new Date(range.end).toISOString(),
  })
  let slots = merged.map((s) => s.start)
  if (period) slots = slots.filter((s) => inPeriod(s, period))
  const max = Math.min(Math.max(1, cfg.maxSlots ?? MAXSLOTS_DEFAULT), MAXSLOTS_CAP)
  return slots.slice(0, max)
}

async function sendServicePicker(ctx: ExecCtx, cfg: ScheduleNodeConfig, services: { id: string; name: string }[]): Promise<void> {
  await sendOptions(ctx, {
    render:     cfg.render,
    body:       "Qual serviço você quer agendar?",
    items:      services.slice(0, 10).map((s, i) => ({ id: `schedule:svc:${i}`, title: s.name })),
    listButton: "Ver serviços",
    meta:       SCHED_META,
  })
}
function pickServiceIndex(reply: string, services: { id: string; name: string }[]): number | null {
  const r = reply.trim().toLowerCase()
  if (!r) return null
  for (let i = 0; i < services.length; i++) {
    const sn = services[i].name.trim().toLowerCase()
    if (sn && (r === sn || r.includes(sn))) return i
  }
  const num = r.match(/\d+/)
  if (num) { const idx = parseInt(num[0], 10) - 1; if (idx >= 0 && idx < services.length) return idx }
  return null
}

/** Serviço resolvido → oferta (estreitada pro dia/período se a IA captou). */
async function offerForResolved(ctx: ExecCtx, cfg: ScheduleNodeConfig, r: Resolved, fromDate: string, period: string): Promise<ScheduleResume> {
  if (fromDate) {
    const slots = await daySlots(ctx, cfg, r, fromDate, period)
    if (slots.length > 0) {
      await sendScheduleOffer(ctx, cfg, slots)
      return { kind: "wait", stash: { mode: "slots", serviceId: r.serviceId, pool: r.pool, slots } }
    }
    await sendBotText(ctx, "Nesse dia não achei horário livre — veja as próximas opções 👇", SCHED_META)
  }
  return startNormal(ctx, cfg, r)
}

// ── ADVANCE: primeira oferta do nó ─────────────────────────────
/** Oferta normal (by_day/slots), opcionalmente com destino já resolvido (aiParse). */
async function startNormal(ctx: ExecCtx, cfg: ScheduleNodeConfig, resolved?: Resolved): Promise<ScheduleResume> {
  if (cfg.offerMode === "by_day") {
    const offer = await prepareDayOffer(ctx, cfg, resolved)
    if (!offer) return { kind: "branch", branch: "sem_horario", responded: false }
    const stash: ScheduleStash = { mode: "by_day", serviceId: offer.serviceId, pool: offer.pool, byDay: offer.byDay, dayKeys: offer.dayKeys, phase: "date", pageStart: 0 }
    await sendDateOffer(ctx, cfg, stash)
    return { kind: "wait", stash }
  }
  const offer = await prepareScheduleOffer(ctx, cfg, resolved)
  if (!offer || offer.slots.length === 0) return { kind: "branch", branch: "sem_horario", responded: false }
  await sendScheduleOffer(ctx, cfg, offer.slots)
  return { kind: "wait", stash: { mode: "slots", slots: offer.slots, serviceId: offer.serviceId, pool: offer.pool } }
}

/** Entrada do nó. aiParse: a IA interpreta serviço+dia → motor oferta/marca. */
export async function startSchedule(ctx: ExecCtx, cfg: ScheduleNodeConfig): Promise<ScheduleResume> {
  // Furo #1 (auditoria 2026-07-18): o nó só oferta/marca se o módulo `agenda` está
  // ligado. Sem ele, degrada pelo ramo "sem_horario" (o fluxo segue, nunca trava).
  if (!(await hasModule(ctx.tenantId, "agenda"))) {
    return { kind: "branch", branch: "sem_horario", responded: false }
  }
  // aiParse ("Entender com IA") precisa do add-on `ai`; sem ele, cai no modo
  // determinístico (botões) — o agendamento continua funcionando, só sem interpretar texto.
  if (!cfg.aiParse || !(await hasModule(ctx.tenantId, "ai"))) return startNormal(ctx, cfg)

  const services = ctx.services ?? []
  const parsed = await parseScheduleRequest(ctx.model ?? "gpt-4.1", ctx.history ?? [], services.map((s) => s.name),
    { tenantId: ctx.tenantId, conversationId: ctx.conversationId, kind: "ai_parse" })
  const matchedId = matchService(parsed.service, services) ?? (services.length === 1 ? services[0].id : null)

  if (matchedId) {
    const r = await resolveServiceId(ctx, cfg, matchedId)
    if (!r) return { kind: "branch", branch: "sem_horario", responded: false }
    return offerForResolved(ctx, cfg, r, parsed.fromDate, parsed.period)
  }
  // serviço não identificado → picker determinístico (sem serviços cadastrados → oferta normal).
  if (services.length === 0) return startNormal(ctx, cfg)
  await sendServicePicker(ctx, cfg, services)
  return { kind: "wait", stash: { mode: "pick_service", services, fromDate: parsed.fromDate, period: parsed.period } }
}
