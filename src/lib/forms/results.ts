// Kora Formulários — Resultados (Fase 4; docs/forms-design.md §13). Puro: o servidor junta os
// dados (contadores sem dado pessoal + comprovantes) e esta função monta o que a aba mostra,
// na ordem do desenho aprovado: do clique à conversa · onde desistem · de onde vêm · o que pedem.

import { normalizeDefinition, isChoiceType, UNKNOWN_OPTION_ID, type Answers } from "./definition"
import { NEEDS_CONTACT, asFormOutcome } from "./outcomes"

/** Passos especiais (a chave de pergunta nunca começa com "__"). */
export const TRACK_STEP = { view: "__view", start: "__start", contact: "__contact", review: "__review" } as const

/** Formato aceito de passo — a função do banco confere de novo e contra a versão publicada. */
export function isTrackStep(v: unknown): v is string {
  return typeof v === "string" && /^[a-z_][a-z0-9_]{0,63}$/.test(v)
}

export const RESULT_PERIODS = [7, 30, 90] as const
export type ResultPeriod = (typeof RESULT_PERIODS)[number]
export const asResultPeriod = (v: unknown): ResultPeriod => (RESULT_PERIODS as readonly number[]).includes(Number(v)) ? Number(v) as ResultPeriod : 30

const SOURCE_LABEL: Record<string, string> = { link: "Link próprio", embed: "Site", popup: "Pop-up", qr: "QR" }

export interface ResultsSubmission {
  created_at: string
  outcome:    string
  replied:    boolean
  source:     { kind?: string; utm?: Record<string, string>; device?: string; elapsedS?: number | null } | null
  answers:    Answers
  /** Segundos do envio até o Kora chamar (null = não chamou). */
  secondsToCall: number | null
}

export interface FormResults {
  funnel: { views: number; starts: number; submits: number; called: number; replied: number; avgSecondsToCall: number | null }
  steps:  { key: string; label: string; number: number | null; conditional: boolean; reached: number; exits: number }[]
  /** O passo onde mais gente sai (só com saída registrada). */
  worstStep: { label: string; exitPctOfStarts: number } | null
  origins:   { label: string; count: number }[]
  topChoice: { title: string; answered: number; options: { label: string; count: number }[] } | null
  needsContact: number
  mobilePct:    number | null
  medianFillSeconds: number | null
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

export function buildFormResults(input: {
  definition:  unknown
  stats:       { step: string; reached: number; exits: number }[]
  submissions: ResultsSubmission[]
}): FormResults {
  const def = normalizeDefinition(input.definition)
  const byStep = new Map<string, { reached: number; exits: number }>()
  for (const r of input.stats) {
    const cur = byStep.get(r.step) ?? { reached: 0, exits: 0 }
    byStep.set(r.step, { reached: cur.reached + (r.reached || 0), exits: cur.exits + (r.exits || 0) })
  }
  const count = (k: string) => byStep.get(k) ?? { reached: 0, exits: 0 }
  const subs = input.submissions

  const called = subs.filter((s) => s.secondsToCall !== null || asFormOutcome(s.outcome) === "sent")
  const callTimes = called.map((s) => s.secondsToCall).filter((x): x is number => typeof x === "number" && x >= 0)
  const funnel = {
    views:   count(TRACK_STEP.view).reached,
    starts:  count(TRACK_STEP.start).reached,
    submits: subs.length,
    called:  called.length,
    replied: subs.filter((s) => s.replied).length,
    avgSecondsToCall: callTimes.length ? Math.round(callTimes.reduce((a, b) => a + b, 0) / callTimes.length) : null,
  }

  const steps: FormResults["steps"] = [
    ...def.questions.map((q, i) => ({ key: q.id, label: q.title.trim() || "Pergunta sem título", number: i + 1, conditional: !!q.showIf, ...count(q.id) })),
    { key: TRACK_STEP.contact, label: "Seus dados", number: null, conditional: false, ...count(TRACK_STEP.contact) },
    { key: TRACK_STEP.review, label: "Confira e envie", number: null, conditional: false, ...count(TRACK_STEP.review) },
  ]
  const worst = funnel.starts > 0
    ? steps.filter((s) => s.exits > 0).sort((a, b) => b.exits - a.exits)[0] ?? null
    : null

  // De onde vêm: a fonte da campanha (utm_source) quando há; senão onde o formulário estava.
  const originCount = new Map<string, number>()
  for (const s of subs) {
    const label = s.source?.utm?.source ? cap(s.source.utm.source) : SOURCE_LABEL[s.source?.kind ?? "link"] ?? "Link próprio"
    originCount.set(label, (originCount.get(label) ?? 0) + 1)
  }
  const sortedOrigins = [...originCount.entries()].sort((a, b) => b[1] - a[1])
  const origins = sortedOrigins.slice(0, 5).map(([label, n]) => ({ label, count: n }))
  const rest = sortedOrigins.slice(5).reduce((a, [, n]) => a + n, 0)
  if (rest) origins.push({ label: "Outras", count: rest })

  // O que mais pedem: a 1ª pergunta de escolha única (cartões/faixas), pelo rótulo de HOJE.
  const q = def.questions.find((x) => isChoiceType(x.type) && x.type !== "multi")
  let topChoice: FormResults["topChoice"] = null
  if (q) {
    const tally = new Map<string, number>()
    let answered = 0
    for (const s of subs) {
      const v = s.answers?.[q.id]
      if (typeof v !== "string") continue
      answered++
      tally.set(v, (tally.get(v) ?? 0) + 1)
    }
    const label = (id: string) => id === UNKNOWN_OPTION_ID ? (q.unknownLabel || "Não sei") : q.options.find((o) => o.id === id)?.label || "Opção que saiu do formulário"
    topChoice = { title: q.title.trim() || "Pergunta", answered,
      options: [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ label: label(id), count: n })) }
  }

  const withDevice = subs.filter((s) => s.source?.device === "mobile" || s.source?.device === "desktop")
  return {
    funnel, steps,
    worstStep: worst ? { label: worst.number ? `${worst.number} · ${worst.label}` : worst.label, exitPctOfStarts: Math.round((worst.exits / funnel.starts) * 100) } : null,
    origins, topChoice,
    needsContact: subs.filter((s) => NEEDS_CONTACT.has(asFormOutcome(s.outcome))).length,
    mobilePct: withDevice.length ? Math.round((withDevice.filter((s) => s.source?.device === "mobile").length / withDevice.length) * 100) : null,
    medianFillSeconds: median(subs.map((s) => s.source?.elapsedS).filter((x): x is number => typeof x === "number" && x > 0 && x <= 86_400)),
  }
}

/** "48 s" · "1 min 20 s" · "2 h 5 min" · "—" (sem dado). */
export function formatDuration(s: number | null): string {
  if (s === null || !Number.isFinite(s) || s < 0) return "—"
  const t = Math.round(s)
  if (t < 60) return `${t} s`
  if (t < 3600) { const m = Math.floor(t / 60), r = t % 60; return r ? `${m} min ${r} s` : `${m} min` }
  const h = Math.floor(t / 3600), m = Math.round((t % 3600) / 60)
  return m ? `${h} h ${m} min` : `${h} h`
}

/** Conclusão: de quem começou, quantos enviaram (nunca passa de 100% — a contagem de "começou"
 *  só existe desde a Fase 4, e envios anteriores não podem inflar a taxa). null = ninguém começou. */
export function completionPct(submits: number, starts: number): number | null {
  return starts > 0 ? Math.min(100, Math.round((submits / starts) * 100)) : null
}

/** Primeiro dia (horário de Brasília) do período, "YYYY-MM-DD", e o instante em que ele começa. */
export function periodStart(days: ResultPeriod, now = new Date()): { day: string; iso: string } {
  const brt = new Date(now.getTime() - 3 * 3_600_000)             // Brasília = UTC−3 (sem horário de verão)
  brt.setUTCDate(brt.getUTCDate() - (days - 1))
  const day = brt.toISOString().slice(0, 10)
  return { day, iso: `${day}T03:00:00.000Z` }
}
