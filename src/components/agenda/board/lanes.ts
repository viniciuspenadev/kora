// ═══════════════════════════════════════════════════════════════
// Agenda 2.0 — board: faixas (lanes) + helpers de fuso/formatação/cores
// ═══════════════════════════════════════════════════════════════
// Fonte ÚNICA (dentro do board) do algoritmo de sobreposição — portado 1:1 do
// protótipo aprovado — e dos helpers de tempo no fuso America/Sao_Paulo.
// Reusado por day/week/month-view + apt-card + o modal. Não duplica helpers do
// overview porque os do overview são privados do módulo (e agenda-overview.tsx
// não muda nesta fase); aqui é o ponto compartilhado do board.
//
// ⚠️ As cores de STATUS abaixo são os HEX EXATOS do protótipo aprovado pelo
// owner (load-bearing na revisão) — cor CHEIA por status, não são tokens do
// tema. Os tokens do design system regem o CHROME (toolbar, cards, modal); o
// preenchimento do cartão segue o protótipo.

export const TZ = "America/Sao_Paulo"
export const HOUR_PX = 72               // altura de 1h na grade (ajuste do owner: células maiores)
export const PX_PER_MIN = HOUR_PX / 60

export interface StatusStyle { bg: string; bd: string; fg: string; chipText: string; label: string }
export const STATUS_COLORS: Record<string, StatusStyle> = {
  confirmed: { bg: "#059669", bd: "#047857", fg: "#ffffff", chipText: "#047857", label: "Confirmado" },
  scheduled: { bg: "#fbbf24", bd: "#f59e0b", fg: "#451a03", chipText: "#b45309", label: "Aguarda confirmação" },
  done:      { bg: "#cbd5e1", bd: "#94a3b8", fg: "#1e293b", chipText: "#334155", label: "Concluído" },
  no_show:   { bg: "#ef4444", bd: "#dc2626", fg: "#ffffff", chipText: "#b91c1c", label: "Faltou" },
  canceled:  { bg: "#fee2e2", bd: "#fecaca", fg: "#991b1b", chipText: "#b91c1c", label: "Cancelado" },
}
export function statusStyle(status: string): StatusStyle { return STATUS_COLORS[status] ?? STATUS_COLORS.scheduled }

// Cores das linhas de grade — espelham o protótipo (chrome do board).
export const GRID_HOUR = "#aebbcb"      // hora — forte, bem visível
export const GRID_HALF = "#e1e7ee"      // meia-hora — visível mas claramente secundária (senão 1h lê como 2 células)

// ── fuso America/Sao_Paulo ──
const _hm = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false })
/** Minuto-do-dia (0–1439) no fuso do tenant. */
export function minutesInTz(d: Date): number {
  const p = _hm.formatToParts(d)
  const h = +(p.find((x) => x.type === "hour")?.value ?? "0") % 24
  const m = +(p.find((x) => x.type === "minute")?.value ?? "0")
  return h * 60 + m
}
export function ymdInTz(d: Date): string { return d.toLocaleDateString("en-CA", { timeZone: TZ }) }
export function hhmm(d: Date): string { return d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }) }
/** "HH:MM" a partir de minuto-do-dia (pode passar de 24h em compromissos longos). */
export function minutesToLabel(min: number): string {
  const h = Math.floor(min / 60) % 24, m = ((min % 60) + 60) % 60
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0")
}
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
export const initial = (s: string) => (s.trim()[0] ?? "?").toUpperCase()

// ── gestos: snap, construção de ISO no fuso, overlap ──
export const SNAP_MIN = 15
export const snap15 = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN

const _tzParts = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
})
/** Offset (min) a somar ao UTC pra obter a hora local no fuso — robusto a qualquer TZ de runtime. */
function tzOffsetMinutes(d: Date): number {
  const p: Record<string, string> = {}
  for (const part of _tzParts.formatToParts(d)) p[part.type] = part.value
  const hour = +p.hour === 24 ? 0 : +p.hour
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second)
  return Math.round((asUTC - d.getTime()) / 60_000)
}
/** ISO (UTC) do horário de parede (dateKey + minuto-do-dia) no fuso America/Sao_Paulo. */
export function isoFromDayMinute(dateKey: string, minute: number): string {
  const [y, m, d] = dateKey.split("-").map(Number)
  const hh = Math.floor(minute / 60), mm = ((minute % 60) + 60) % 60
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm))
  return new Date(guess.getTime() - tzOffsetMinutes(guess) * 60_000).toISOString()
}
/** Dois intervalos [start, start+dur) se sobrepõem? */
export function rangesOverlap(aStart: number, aDur: number, bStart: number, bDur: number): boolean {
  return aStart < bStart + bDur && bStart < aStart + aDur
}

// ── faixas lado a lado (estilo Google Calendar) — portado de layoutLanes ──
export interface LaneInput { id: string; startMin: number; durMin: number }
export interface LanePos { lane: number; lanes: number }

export function layoutLanes(items: LaneInput[]): Map<string, LanePos> {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.durMin - a.durMin)
  const pos = new Map<string, LanePos>()
  let cluster: LaneInput[] = [], laneEnds: number[] = [], clusterEnd = -1
  const flush = () => {
    const n = Math.max(1, laneEnds.length)
    for (const x of cluster) { const p = pos.get(x.id); if (p) p.lanes = n }
    cluster = []; laneEnds = []; clusterEnd = -1
  }
  for (const a of sorted) {
    if (cluster.length && a.startMin >= clusterEnd) flush()
    let lane = laneEnds.findIndex((e) => e <= a.startMin)
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0) }
    laneEnds[lane] = a.startMin + a.durMin
    pos.set(a.id, { lane, lanes: 1 })
    cluster.push(a)
    clusterEnd = Math.max(clusterEnd, a.startMin + a.durMin)
  }
  flush()
  return pos
}
