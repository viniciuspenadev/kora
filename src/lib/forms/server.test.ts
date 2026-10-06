import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
process.env.AUTH_SECRET = "segredo-de-teste"
const { signRenderToken, verifyRenderToken, hashIp, definitionHash } = await import("./server")
const { templateDefinition } = await import("./templates")
const { SUBMIT_LIMITS } = await import("./limits")

const ID = "abcdefghij0123456789"

describe("bilhete da página", () => {
  it("vale depois do tempo mínimo e até 24 h", () => {
    const t0 = 1_800_000_000_000
    const tok = signRenderToken(ID, t0)
    expect(verifyRenderToken(tok, ID, t0 + 500)).toEqual({ ok: false, reason: "too_fast" })
    expect(verifyRenderToken(tok, ID, t0 + SUBMIT_LIMITS.minFillMs + 1)).toEqual({ ok: true })
    expect(verifyRenderToken(tok, ID, t0 + SUBMIT_LIMITS.renderTokenMaxAgeMs + 1)).toEqual({ ok: false, reason: "expired" })
  })
  it("adulterado, de outro formulário ou lixo = inválido", () => {
    const t0 = 1_800_000_000_000
    const tok = signRenderToken(ID, t0)
    const later = t0 + 10_000
    expect(verifyRenderToken(tok, "zzzzzzzzzz0123456789", later).ok).toBe(false)
    expect(verifyRenderToken(`${t0 - 60_000}.${tok.split(".")[1]}`, ID, later).ok).toBe(false)
    expect(verifyRenderToken("nada", ID, later).ok).toBe(false)
    expect(verifyRenderToken(42, ID, later).ok).toBe(false)
  })
})

describe("hash", () => {
  it("IP vira HMAC de 32 hex, estável; sem IP = nada", () => {
    expect(hashIp("1.2.3.4")).toMatch(/^[0-9a-f]{32}$/)
    expect(hashIp("1.2.3.4")).toBe(hashIp("1.2.3.4"))
    expect(hashIp("1.2.3.4")).not.toBe(hashIp("1.2.3.5"))
    expect(hashIp("unknown")).toBeNull()
  })
  it("carimbo da versão não depende da ordem das chaves", () => {
    const a = templateDefinition("quote_guided")
    const b = JSON.parse(JSON.stringify({ ending: a.ending, appearance: a.appearance, review: a.review, contact: a.contact, questions: a.questions, version: a.version }))
    expect(definitionHash(a)).toMatch(/^[0-9a-f]{64}$/)
    expect(definitionHash(b)).toBe(definitionHash(a))
    expect(definitionHash({ ...a, review: { title: "outro" } })).not.toBe(definitionHash(a))
  })
})
