import { describe, expect, it } from "vitest"
import { computeDealValue, termFactor } from "./value"

describe("termFactor", () => {
  it("avulso 1×, mensal × prazo, anual × prazo/12, sem prazo = 12 meses", () => {
    expect(termFactor({ billing: "one_time", term_months: 24 })).toBe(1)
    expect(termFactor({ billing: "monthly", term_months: 6 })).toBe(6)
    expect(termFactor({ billing: "monthly", term_months: null })).toBe(12)
    expect(termFactor({ billing: "yearly", term_months: 24 })).toBe(2)
  })
})

describe("computeDealValue", () => {
  it("soma avulso + mensal × prazo, com desconto por linha", () => {
    const v = computeDealValue([
      { billing: "one_time", unit_price: 100, quantity: 3, discount: 30, term_months: null },
      { billing: "monthly", unit_price: 50, quantity: 1, discount: 0, term_months: 6 },
    ])
    expect(v.total).toBe(570)
    expect(v.mrr).toBe(50)
  })
})
