// ═══════════════════════════════════════════════════════════════
// Motor de disponibilidade da Agenda (função PURA, sem DB)
// ═══════════════════════════════════════════════════════════════
// Doc: docs/agenda-design.md §4. Dado um recurso (horário de trabalho +
// capacidade + grade), o serviço (duração + buffers) e o estado real
// (reservas ativas + bloqueios), devolve os SLOTS livres num intervalo.
//
//   slots = grade(working_hours)
//         − fora do horizonte/lead-time
//         − blackouts (sempre bloqueiam)
//         − slots onde sobreposições + partySize > capacidade
//
// Determinístico: é o que alimenta a IA (nunca inventa horário) e o
// calendário. Fuso via Intl (mesmo padrão de business-hours.ts), sem lib.

const MIN = 60_000
const DAY = 86_400_000

export interface WorkingHoursDay {
  /** 0=domingo … 6=sábado. */
  day:       number
  /** Janelas de trabalho em wall-clock no fuso do recurso: [["09:00","12:00"],…]. */
  intervals: [string, string][]
}

export interface AvailabilityResource {
  working_hours:    WorkingHoursDay[]
  slot_minutes:     number
  timezone:         string
  capacity:         number
  min_lead_minutes: number
  max_horizon_days: number
}

export interface Interval { start: Date; end: Date }
export type Slot = Interval

export interface AvailabilityParams {
  resource:               AvailabilityResource
  durationMinutes:        number
  bufferBeforeMinutes?:   number
  bufferAfterMinutes?:    number
  /** Reservas ATIVAS do recurso (start/end crus, sem buffer). */
  busy:                   Interval[]
  /** Bloqueios (do recurso + do tenant). */
  blackouts:              Interval[]
  rangeStart:             Date
  rangeEnd:               Date
  now?:                   Date
  partySize?:             number
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

interface ZonedParts {
  year: number; month: number; day: number
  hour: number; minute: number; second: number
  weekday: number
}

/** Quebra um instante UTC nos campos de wall-clock do fuso. */
function tzParts(date: Date, timeZone: string): ZonedParts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    weekday: "short", hour12: false,
  })
  const p: Record<string, string> = {}
  for (const part of f.formatToParts(date)) p[part.type] = part.value
  const hour = p.hour === "24" ? "0" : p.hour   // alguns runtimes dão "24" pra meia-noite
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +hour, minute: +p.minute, second: +p.second,
    weekday: WD[p.weekday] ?? 0,
  }
}

/** Offset (ms) tal que `local = utc + offset` no fuso, pra um dado instante. */
function tzOffsetMs(timeZone: string, date: Date): number {
  const p = tzParts(date, timeZone)
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUTC - date.getTime()
}

/**
 * Instante UTC pra um wall-clock (mês 1-12) no fuso. Duas passadas pra
 * acertar a fronteira de DST (no-op no Brasil, correto em fusos com horário
 * de verão).
 */
export function zonedTimeToUtc(
  year: number, month: number, day: number,
  hour: number, minute: number, timeZone: string,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute))
  const off1 = tzOffsetMs(timeZone, guess)
  let utc = new Date(guess.getTime() - off1)
  const off2 = tzOffsetMs(timeZone, utc)
  if (off2 !== off1) utc = new Date(guess.getTime() - off2)
  return utc
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart
}

/**
 * Slots livres no intervalo. Cada slot tem a duração do serviço; os buffers
 * só ampliam a "zona livre exigida" ao redor do candidato (espaçamento contra
 * reservas existentes), não o tamanho oferecido.
 */
export function getAvailability(params: AvailabilityParams): Slot[] {
  const {
    resource, durationMinutes,
    bufferBeforeMinutes = 0, bufferAfterMinutes = 0,
    busy, blackouts, rangeStart, rangeEnd,
    now = new Date(), partySize = 1,
  } = params

  const tz       = resource.timezone || "America/Sao_Paulo"
  const stepMs   = Math.max(1, resource.slot_minutes) * MIN
  const durMs    = durationMinutes * MIN
  const beforeMs = bufferBeforeMinutes * MIN
  const afterMs  = bufferAfterMinutes * MIN

  // Limites: lead-time mínimo e horizonte máximo do recurso.
  const minStart = Math.max(rangeStart.getTime(), now.getTime() + resource.min_lead_minutes * MIN)
  const hardEnd  = Math.min(rangeEnd.getTime(), now.getTime() + resource.max_horizon_days * DAY)
  if (minStart >= hardEnd) return []

  const byDay = new Map<number, [string, string][]>()
  for (const w of resource.working_hours) byDay.set(w.day, w.intervals)

  const slots: Slot[] = []
  let cursor = tzParts(rangeStart, tz)

  for (let i = 0; i < 366; i++) {
    const dayMidnightUtc = zonedTimeToUtc(cursor.year, cursor.month, cursor.day, 0, 0, tz).getTime()
    if (dayMidnightUtc > hardEnd) break

    for (const [open, close] of byDay.get(cursor.weekday) ?? []) {
      const [oh, om] = open.split(":").map(Number)
      const [ch, cm] = close.split(":").map(Number)
      const openMs  = zonedTimeToUtc(cursor.year, cursor.month, cursor.day, oh, om, tz).getTime()
      const closeMs = zonedTimeToUtc(cursor.year, cursor.month, cursor.day, ch, cm, tz).getTime()

      for (let s = openMs; s + durMs <= closeMs; s += stepMs) {
        const e = s + durMs
        if (s < minStart || e > hardEnd) continue
        // Blackout bloqueia no slot cru (sem buffer).
        if (blackouts.some((b) => overlaps(s, e, b.start.getTime(), b.end.getTime()))) continue
        // Capacidade: conta reservas dentro da zona [start-before, end+after].
        const zoneStart = s - beforeMs, zoneEnd = e + afterMs
        let taken = 0
        for (const b of busy) {
          if (overlaps(zoneStart, zoneEnd, b.start.getTime(), b.end.getTime())) taken++
        }
        if (taken + partySize > resource.capacity) continue
        slots.push({ start: new Date(s), end: new Date(e) })
      }
    }

    // Avança 1 dia local (+26h cruza o dia mesmo em fronteira de DST).
    cursor = tzParts(new Date(dayMidnightUtc + 26 * 3600_000), tz)
  }

  return slots
}
