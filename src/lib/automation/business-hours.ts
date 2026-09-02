/**
 * Horário comercial — checa se now() está dentro do schedule do tenant
 * e renderiza mensagem de "fora do ar".
 */

export type DaySchedule = { start: string; end: string } | null

export interface BusinessHoursSchedule {
  mon: DaySchedule
  tue: DaySchedule
  wed: DaySchedule
  thu: DaySchedule
  fri: DaySchedule
  sat: DaySchedule
  sun: DaySchedule
}

export type DayKey = keyof BusinessHoursSchedule

const WEEKDAY_MAP: Record<string, DayKey> = {
  Sun: "sun", Mon: "mon", Tue: "tue", Wed: "wed",
  Thu: "thu", Fri: "fri", Sat: "sat",
}

/**
 * Pega weekday + HH:mm no fuso horário do tenant.
 * Usa Intl.DateTimeFormat pra evitar dependências externas.
 */
function getTenantTime(timezone: string): { weekday: DayKey; hhmm: string } {
  const now = new Date()
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday:  "short",
    hour:     "2-digit",
    minute:   "2-digit",
    hour12:   false,
  })
  const parts = fmt.formatToParts(now)
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon"
  let   hour    = parts.find((p) => p.type === "hour")?.value   ?? "00"
  const minute  = parts.find((p) => p.type === "minute")?.value ?? "00"
  // Intl pode retornar "24" pra meia-noite com hour12:false em alguns navegadores
  if (hour === "24") hour = "00"
  return {
    weekday: WEEKDAY_MAP[weekday] ?? "mon",
    hhmm:    `${hour}:${minute}`,
  }
}

/**
 * Retorna `true` se o instante atual cai dentro do horário comercial configurado.
 * Schedule nulo pra um dia = fechado nesse dia.
 */
export function isWithinBusinessHours(
  schedule: BusinessHoursSchedule | Record<string, DaySchedule>,
  timezone: string = "America/Sao_Paulo",
): boolean {
  const { weekday, hhmm } = getTenantTime(timezone)
  const day = (schedule as Record<string, DaySchedule>)[weekday]
  if (!day) return false
  return hhmm >= day.start && hhmm < day.end
}

/**
 * Retorna `true` se está FORA do horário comercial (atalho).
 */
export function isOutsideBusinessHours(
  schedule: BusinessHoursSchedule | Record<string, DaySchedule>,
  timezone: string = "America/Sao_Paulo",
): boolean {
  return !isWithinBusinessHours(schedule, timezone)
}
