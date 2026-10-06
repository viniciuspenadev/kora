import { describe, expect, it } from "vitest"
import { codeFailAction, codeFailClearsInput, wrongCodeFeedback } from "./code-feedback"

describe("wrongCodeFeedback", () => {
  it("conta as tentativas que restam (plural e singular)", () => {
    expect(wrongCodeFeedback(1, 5)).toEqual({ error: "Código incorreto. Restam 4 tentativas.", reason: "wrong", attemptsLeft: 4 })
    expect(wrongCodeFeedback(4, 5)).toEqual({ error: "Código incorreto. Resta 1 tentativa.", reason: "wrong", attemptsLeft: 1 })
  })

  it("na última tentativa errada já manda pedir outro código", () => {
    expect(wrongCodeFeedback(5, 5)).toEqual({ error: "Código incorreto e as tentativas acabaram. Peça um novo código.", reason: "exhausted", attemptsLeft: 0 })
    expect(wrongCodeFeedback(9, 5).attemptsLeft).toBe(0)
  })
})

describe("codeFailAction", () => {
  it("código que não serve mais oferece novo código; verificação encerrada oferece recomeçar", () => {
    expect(codeFailAction("expired")).toBe("resend")
    expect(codeFailAction("exhausted")).toBe("resend")
    expect(codeFailAction("used")).toBe("restart")
    expect(codeFailAction("missing")).toBe("restart")
  })

  it("erro passageiro não oferece saída extra", () => {
    expect(codeFailAction("wrong")).toBeNull()
    expect(codeFailAction("throttled")).toBeNull()
    expect(codeFailAction(null)).toBeNull()
    expect(codeFailAction(undefined)).toBeNull()
  })
})

describe("codeFailClearsInput", () => {
  it("limpa as caixas quando o código digitado não serve mais; mantém em falha passageira", () => {
    for (const r of ["wrong", "exhausted", "expired", "used", "missing"] as const) expect(codeFailClearsInput(r)).toBe(true)
    expect(codeFailClearsInput("throttled")).toBe(false)
    expect(codeFailClearsInput(undefined)).toBe(false)
  })
})
