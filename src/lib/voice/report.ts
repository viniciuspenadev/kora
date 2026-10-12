export type CallResult = "active" | "connected" | "ended" | "failed" | "unconfirmed"
export const callResultLabels: Record<CallResult, string> = {
  active: "Em andamento", connected: "Encerrada · conectada", ended: "Encerrada · conexão não confirmada",
  failed: "Não iniciada", unconfirmed: "Resultado não confirmado",
}
export type CallReportRow = {
  id: string; conversationId: string | null; startedAt: string; actorId: string | null; actor: string
  contact: string; phone: string; instanceId: string | null; instanceLabel: string; result: CallResult
  durationSeconds: number | null; connectionObserved: boolean; legacyLine: boolean
}
export function callResult(state: unknown, connectedAt: unknown, startedAt: string, now: number): CallResult {
  if (state === "failed") return "failed"
  if (state === "unconfirmed") return "unconfirmed"
  if (state === "ended") return typeof connectedAt === "string" && Number.isFinite(Date.parse(connectedAt)) ? "connected" : "ended"
  if (["dialing", "ringing", "connected", "ending"].includes(String(state)) && now - Date.parse(startedAt) <= 20 * 60_000) return "active"
  return "unconfirmed"
}
export function callMetrics(rows: CallReportRow[]) {
  const durations = rows.flatMap(row => row.result !== "active" && row.durationSeconds !== null ? [row.durationSeconds] : [])
  return { total: rows.length, connected: rows.filter(row => row.connectionObserved).length,
    active: rows.filter(row => row.result === "active").length, failed: rows.filter(row => row.result === "failed").length,
    unconfirmed: rows.filter(row => row.result === "unconfirmed").length,
    totalSeconds: durations.reduce((a, b) => a + b, 0), durationCount: durations.length,
    averageSeconds: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null }
}
/** Date-only report boundaries use the same named timezone as the displayed timestamps. */
export function callDateBoundary(value: string, timeZone = "America/Sao_Paulo"): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Período inválido")
  const nominal = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(nominal) || new Date(nominal).toISOString().slice(0, 10) !== value) throw new Error("Período inválido")
  let instant = nominal
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(p => [p.type, p.value]))
    const wallTime = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
    if (wallTime === nominal) return new Date(instant).toISOString()
    instant += nominal - wallTime
  }
  throw new Error("Não foi possível calcular o período neste fuso")
}
