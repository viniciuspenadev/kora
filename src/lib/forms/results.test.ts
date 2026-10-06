import { describe, expect, it } from "vitest"
import { buildFormResults, periodStart, formatDuration, completionPct, isTrackStep, asResultPeriod, TRACK_STEP, type ResultsSubmission } from "./results"
import { normalizeDefinition, UNKNOWN_OPTION_ID } from "./definition"

// Resultados: o que a aba mostra a partir dos contadores (sem dado pessoal) e dos comprovantes.
const def = normalizeDefinition({ questions: [
  { id: "servico", type: "cards", title: "O que você precisa?", options: [{ id: "sacada", label: "Sacada" }, { id: "box", label: "Box" }] },
  { id: "largura", type: "chips", title: "Largura", allowUnknown: true, unknownLabel: "Não sei medir",
    options: [{ id: "ate3", label: "Até 3 m" }], showIf: { questionId: "servico", optionIds: ["sacada"] } },
  { id: "local", type: "location", title: "Onde é a obra?" },
] })
const sub = (over: Partial<ResultsSubmission> = {}): ResultsSubmission => ({
  created_at: "2026-10-06T12:00:00Z", outcome: "sent", replied: false, answers: { servico: "sacada" },
  source: { kind: "embed", device: "mobile", utm: {} }, secondsToCall: 6, ...over,
})

describe("do clique à conversa", () => {
  const r = buildFormResults({
    definition: def,
    stats: [
      { step: TRACK_STEP.view, reached: 200, exits: 0 }, { step: TRACK_STEP.view, reached: 116, exits: 0 },   // dois dias somam
      { step: TRACK_STEP.start, reached: 79, exits: 0 },
      { step: "servico", reached: 79, exits: 5 }, { step: "largura", reached: 40, exits: 2 },
      { step: "local", reached: 64, exits: 3 }, { step: TRACK_STEP.contact, reached: 61, exits: 13 },
      { step: TRACK_STEP.review, reached: 48, exits: 0 },
    ],
    submissions: [
      sub({ replied: true, secondsToCall: 4 }), sub({ replied: true, secondsToCall: 8 }), sub(),
      sub({ outcome: "no_whatsapp", secondsToCall: null, source: { kind: "link", device: "desktop" } }),
      sub({ outcome: "in_attendance", secondsToCall: null, answers: { servico: "box" }, source: { kind: "embed", utm: { source: "google" }, device: "mobile" } }),
    ],
  })
  it("viram e começaram vêm dos contadores; enviaram, chamou e responderam, dos comprovantes", () => {
    expect(r.funnel).toEqual({ views: 316, starts: 79, submits: 5, called: 3, replied: 2, avgSecondsToCall: 6 })
  })
  it("onde desistem: cada pergunta na ordem, Seus dados e Confira; caminho marcado; maior saída destacada", () => {
    expect(r.steps.map((s) => [s.key, s.number, s.conditional, s.reached])).toEqual([
      ["servico", 1, false, 79], ["largura", 2, true, 40], ["local", 3, false, 64],
      ["__contact", null, false, 61], ["__review", null, false, 48],
    ])
    expect(r.worstStep).toEqual({ label: "Seus dados", exitPctOfStarts: 16 })
  })
  it("de onde vêm: a fonte da campanha quando há, senão onde o formulário estava", () => {
    expect(r.origins).toEqual([{ label: "Site", count: 3 }, { label: "Link próprio", count: 1 }, { label: "Google", count: 1 }])
  })
  it("o que mais pedem: a 1ª pergunta de escolha, pelo rótulo", () => {
    expect(r.topChoice).toEqual({ title: "O que você precisa?", answered: 5, options: [{ label: "Sacada", count: 4 }, { label: "Box", count: 1 }] })
  })
  it("precisaram de contato e pelo celular", () => {
    expect(r.needsContact).toBe(1)          // sem WhatsApp (em atendimento NÃO conta: o responsável já foi avisado)
    expect(r.mobilePct).toBe(80)
  })
})

describe("casos de borda", () => {
  it("sem nada: zeros, sem destaque, sem divisão por zero", () => {
    const r = buildFormResults({ definition: def, stats: [], submissions: [] })
    expect(r.funnel).toEqual({ views: 0, starts: 0, submits: 0, called: 0, replied: 0, avgSecondsToCall: null })
    expect(r.worstStep).toBeNull()
    expect(r.origins).toEqual([])
    expect(r.topChoice).toEqual({ title: "O que você precisa?", answered: 0, options: [] })
    expect(r.mobilePct).toBeNull()
    expect(r.medianFillSeconds).toBeNull()
  })
  it("opção que saiu do formulário e 'Não sei' aparecem com nome honesto; mais de 5 origens viram 'Outras'", () => {
    const d2 = normalizeDefinition({ questions: [{ id: "largura", type: "chips", title: "Largura", allowUnknown: true, unknownLabel: "Não sei medir", options: [{ id: "ate3", label: "Até 3 m" }] }] })
    const r = buildFormResults({ definition: d2, stats: [], submissions: [
      sub({ answers: { largura: UNKNOWN_OPTION_ID } }), sub({ answers: { largura: "antiga" } }),
      ...["a", "b", "c", "d", "e", "f", "g"].map((s) => sub({ source: { kind: "embed", utm: { source: s } } })),
    ] })
    expect(r.topChoice?.options.map((o) => o.label).sort()).toEqual(["Não sei medir", "Opção que saiu do formulário"])
    // Site (2) + 7 campanhas (1 cada): as 5 maiores aparecem, as outras 3 viram "Outras".
    expect(r.origins).toHaveLength(6)
    expect(r.origins[0]).toEqual({ label: "Site", count: 2 })
    expect(r.origins.at(-1)).toEqual({ label: "Outras", count: 3 })
  })
  it("tempo para preencher: mediana, ignorando o que não é são", () => {
    const r = buildFormResults({ definition: def, stats: [], submissions: [30, 50, 900, -1, 999_999].map((s) => sub({ source: { kind: "link", elapsedS: s } })) })
    expect(r.medianFillSeconds).toBe(50)
  })
})

describe("auxiliares", () => {
  it("período começa à meia-noite de Brasília", () => {
    // 06/10 01:00 UTC = 05/10 22:00 em Brasília → "últimos 7 dias" começam em 29/09 00:00 BRT.
    expect(periodStart(7, new Date("2026-10-06T01:00:00Z"))).toEqual({ day: "2026-09-29", iso: "2026-09-29T03:00:00.000Z" })
    expect(periodStart(30, new Date("2026-10-06T15:00:00Z")).day).toBe("2026-09-07")
    expect(asResultPeriod("90")).toBe(90)
    expect(asResultPeriod(365)).toBe(30)
  })
  it("duração, conclusão e formato de passo", () => {
    expect([formatDuration(48), formatDuration(80), formatDuration(120), formatDuration(7500), formatDuration(null)]).toEqual(["48 s", "1 min 20 s", "2 min", "2 h 5 min", "—"])
    expect(completionPct(48, 79)).toBe(61)
    expect(completionPct(10, 4)).toBe(100)          // envios de antes da contagem não passam de 100%
    expect(completionPct(3, 0)).toBeNull()
    expect(["__view", "servico", "p_2"].every(isTrackStep)).toBe(true)
    expect(["", "Servico", "../x", "a".repeat(65), 1].some(isTrackStep)).toBe(false)
  })
})
