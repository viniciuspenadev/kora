import { describe, expect, it } from "vitest"
import { normalizeDefinition, UNKNOWN_OPTION_ID } from "./definition"
import { templateDefinition } from "./templates"
import { parseSubmission, coerceAnswer, parseSource, cleanUrl, cleanLine } from "./submission"

// O envio público só aceita o que a VERSÃO aceita (S6): chave, opção, forma e caminho.
const def = normalizeDefinition({
  appearance: { title: "Orçamento" },
  contact: { consentText: "Aceito que {{empresa}} me chame no WhatsApp.", marketing: { enabled: true, text: "Novidades de {{empresa}}" } },
  questions: [
    { id: "precisa", type: "cards", title: "O que você precisa?", options: [{ id: "sacada", label: "Sacada" }, { id: "box", label: "Box" }] },
    { id: "largura", type: "chips", title: "Largura?", options: [{ id: "ate_2", label: "Até 2 m" }, { id: "mais_2", label: "Mais de 2 m" }],
      allowUnknown: true, showIf: { questionId: "precisa", optionIds: ["sacada"] } },
    { id: "extras", type: "multi", title: "Extras?", required: false, options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
    { id: "email", type: "email", title: "E-mail", required: false, target: { kind: "contact", field: "email" } },
    { id: "obra", type: "location", title: "Onde é a obra?" },
  ],
})
const contact = { name: "  Marina   Lopes ", whatsapp: "(47) 99812-4471", consent: true, marketing: true }
const base = (answers: Record<string, unknown>, c: Record<string, unknown> = contact) => parseSubmission(def, { answers, contact: c }, { businessName: "Vitra Vidros" })

describe("envio conferido contra a versão", () => {
  it("caminho completo passa e o telefone vira E.164; aceite sai com o texto exato", () => {
    const r = base({ precisa: "sacada", largura: "mais_2", obra: { city: "Itajaí", district: "Fazenda" } })
    expect(r).toMatchObject({ ok: true, value: {
      name: "Marina Lopes", phoneE164: "5547998124471",
      answers: { precisa: "sacada", largura: "mais_2", obra: { city: "Itajaí", district: "Fazenda" } },
      consentText: "Aceito que Vitra Vidros me chame no WhatsApp.",
      marketing: { shown: true, checked: true, text: "Novidades de Vitra Vidros" },
    } })
  })
  it("resposta de caminho abandonado NÃO vai para o comprovante", () => {
    const r = base({ precisa: "box", largura: "mais_2", obra: { city: "Itajaí", district: "" } })
    expect(r.ok && r.value.answers).toEqual({ precisa: "box", obra: { city: "Itajaí", district: "" } })
  })
  it("pergunta obrigatória do caminho sem resposta é recusada; fora do caminho, não", () => {
    expect(base({ precisa: "sacada", obra: { city: "Itajaí", district: "" } })).toEqual({ ok: false, error: "Largura?: Responda para continuar." })
    expect(base({ precisa: "box", obra: { city: "Itajaí", district: "" } }).ok).toBe(true)
  })
  it("opção que não existe, data torta ou chave estranha: recusa ou descarta (ninguém digita isso pela tela)", () => {
    expect(base({ precisa: "piscina", obra: { city: "X", district: "" } }).ok).toBe(false)
    expect(base({ precisa: "box", extras: ["a", "zzz"], obra: { city: "X", district: "" } }).ok).toBe(false)
    const r = base({ precisa: "box", obra: { city: "X", district: "" }, __proto__: "x", hacker: "<script>" })
    expect(r.ok && Object.keys(r.value.answers)).toEqual(["precisa", "obra"])
  })
  it("'Não sei' só vale onde o botão existe", () => {
    expect(base({ precisa: "sacada", largura: UNKNOWN_OPTION_ID, obra: { city: "X", district: "" } }).ok).toBe(true)
    expect(base({ precisa: UNKNOWN_OPTION_ID, obra: { city: "X", district: "" } }).ok).toBe(false)
  })
  it("e-mail do caminho é conferido pela mesma regra da tela", () => {
    expect(base({ precisa: "box", email: "não-é-email", obra: { city: "X", district: "" } })).toEqual({ ok: false, error: "E-mail: Confira o e-mail." })
  })
  it("Seus dados: nome, WhatsApp plausível e aceite são obrigatórios; novidades só se a caixa existe", () => {
    const ans = { precisa: "box", obra: { city: "X", district: "" } }
    expect(base(ans, { ...contact, name: "M" })).toEqual({ ok: false, error: "Escreva seu nome." })
    expect(base(ans, { ...contact, whatsapp: "123" })).toEqual({ ok: false, error: "Confira o número do WhatsApp, com DDD." })
    expect(base(ans, { ...contact, consent: "true" })).toEqual({ ok: false, error: "Para a gente chamar você, marque o aceite." })
    const sem = parseSubmission(templateDefinition("contact_us"), { answers: { assunto: "duvida" }, contact }, { businessName: "X" })
    expect(sem.ok && sem.value.marketing).toEqual({ shown: false, checked: false, text: null })
  })
  it("corpo que não é objeto não quebra", () => {
    expect(parseSubmission(def, null, { businessName: "X" }).ok).toBe(false)
    expect(parseSubmission(def, "oi", { businessName: "X" }).ok).toBe(false)
  })
})

describe("forma de cada tipo", () => {
  const q = (type: string, extra: Record<string, unknown> = {}) => normalizeDefinition({ questions: [{ id: "x", type, title: "T", ...extra }] }).questions[0]
  it("texto: sem controle, espaços colapsados, cortado; longo mantém parágrafo", () => {
    expect(coerceAnswer(q("short_text"), "  a\u0000b \t c  ")).toBe("a b c")
    expect((coerceAnswer(q("short_text"), "x".repeat(500)) as string).length).toBe(200)
    expect(coerceAnswer(q("long_text"), "linha 1\r\n\r\n\r\n\r\nlinha 2")).toBe("linha 1\n\nlinha 2")
    expect(coerceAnswer(q("short_text"), "   ")).toBeUndefined()
  })
  it("data real, nota 0–10, local com cidade ou bairro", () => {
    expect(coerceAnswer(q("date"), "2026-02-30")).toBeNull()
    expect(coerceAnswer(q("date"), "2026-10-02")).toBe("2026-10-02")
    expect(coerceAnswer(q("nps"), "11")).toBeNull()
    expect(coerceAnswer(q("nps"), "10")).toBe("10")
    expect(coerceAnswer(q("location"), { city: "", district: "" })).toBeUndefined()
    expect(coerceAnswer(q("location"), "Itajaí")).toBeNull()
  })
  it("várias escolhas: sem repetição, vazio = sem resposta", () => {
    const m = q("multi", { options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] })
    expect(coerceAnswer(m, ["a", "a"])).toEqual(["a"])
    expect(coerceAnswer(m, [])).toBeUndefined()
    expect(coerceAnswer(m, "a")).toBeNull()
  })
})

describe("origem", () => {
  it("só http(s), sem credencial; UTM cortada; aparelho vem do servidor", () => {
    expect(cleanUrl("javascript:alert(1)")).toBeNull()
    expect(cleanUrl("https://user:senha@site.com/p?a=1")).toBe("https://site.com/p?a=1")
    const s = parseSource({ kind: "hack", page: "https://site.com/sacadas", utm: { source: "google", campaign: "x".repeat(300), evil: "1" } }, "Mozilla/5.0 (iPhone)")
    expect(s).toEqual({ kind: "link", page: "https://site.com/sacadas", referrer: null, utm: { source: "google", campaign: "x".repeat(100) }, device: "mobile", elapsedS: null })
    expect(parseSource(null, null)).toMatchObject({ kind: "link", device: "desktop", utm: {} })
  })
  it("tempo para preencher: só número são (0 a 24 h), arredondado", () => {
    expect(parseSource({ elapsedS: 47.6 }, null).elapsedS).toBe(48)
    for (const bad of [-1, 90_000, Number.NaN, "30", null]) expect(parseSource({ elapsedS: bad }, null).elapsedS).toBeNull()
  })
  it("cleanLine aceita só texto", () => {
    expect(cleanLine(42, 10)).toBe("")
  })
})
