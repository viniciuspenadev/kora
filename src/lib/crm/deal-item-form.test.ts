import { describe, expect, it } from "vitest"
import { parseItemMoney, reviewDealItem, reviewManualItem, itemStartStep, MANUAL_NAME_MAX } from "./deal-item-form"

const base = { billing: "one_time" as const, listPrice: 100, maxPct: 20, price: "100,00", quantity: "2", discount: "", discountMode: "brl" as const, term: "" }
describe("proposal item review", () => {
  it("reads BR money including thousands and preserves zero", () => {
    expect(parseItemMoney("1.500")).toBe(1500)
    expect(parseItemMoney("1.500,25")).toBe(1500.25)
    expect(parseItemMoney("15.50")).toBe(15.5)
    expect(parseItemMoney("0")).toBe(0)
    expect(parseItemMoney("1,2,3")).toBeNull()
  })
  it("combines price negotiation and discount against the catalog floor", () => {
    expect(reviewDealItem({ ...base, price: "90", discount: "15", discountMode: "pct" }).error).toContain("combinados")
    expect(reviewDealItem({ ...base, price: "90", discount: "20" }).periodTotal).toBe(160)
  })
  it("converts percent across the full line, not per unit", () => {
    const r = reviewDealItem({ ...base, discount: "10", discountMode: "pct" })
    expect(r.discount).toBe(20)
    expect(r.summary?.total).toBe(180)
  })
  it("separates recurring period, term total and monthly revenue", () => {
    const r = reviewDealItem({ ...base, billing: "yearly", term: "24" })
    expect(r.periodTotal).toBe(200)
    expect(r.summary?.total).toBe(400)
    expect(r.summary?.mrr).toBe(16.67)
    expect(reviewDealItem({ ...base, billing: "monthly" }).summary?.total).toBe(2400)
  })
  it("rejects invalid quantities, percentages and fractional terms", () => {
    expect(reviewDealItem({ ...base, quantity: "0" }).summary).toBeNull()
    expect(reviewDealItem({ ...base, discount: "101", discountMode: "pct" }).summary).toBeNull()
    expect(reviewDealItem({ ...base, billing: "monthly", term: "1.5" }).summary).toBeNull()
  })
  it("accepts free items and fractional quantities, ignoring terms for one-time items", () => {
    const r = reviewDealItem({ ...base, listPrice: 0, price: "0", quantity: "1,5", term: "invalid" })
    expect(r.error).toBeNull()
    expect(r.summary?.total).toBe(0)
    expect(r.quantity).toBe(1.5)
    expect(r.termMonths).toBeNull()
  })
})

describe("first step of adding an item", () => {
  it("only asks when both sources exist; otherwise goes straight to the one available", () => {
    expect(itemStartStep({ hasCatalog: true, manualAllowed: true })).toBe("choose")
    expect(itemStartStep({ hasCatalog: true, manualAllowed: false })).toBe("catalog")
    expect(itemStartStep({ hasCatalog: false, manualAllowed: true })).toBe("manual")
    expect(itemStartStep({ hasCatalog: false, manualAllowed: false })).toBe("none")
  })
})

describe("manual item review", () => {
  const manual = { name: "Instalação especial", billing: "one_time" as const, price: "350,00", quantity: "2", term: "" }
  it("any typed price is final: no floor, no discount", () => {
    const r = reviewManualItem({ ...manual, price: "1" })
    expect(r.error).toBeNull()
    expect(r.periodTotal).toBe(2)
    expect(r.discount).toBe(0)
  })
  it("requires name and price; keeps quantity and term rules", () => {
    expect(reviewManualItem({ ...manual, name: "  " }).error).toBe("Dê um nome ao item.")
    expect(reviewManualItem({ ...manual, name: "x".repeat(MANUAL_NAME_MAX + 1) }).error).toContain("máximo")
    expect(reviewManualItem({ ...manual, price: "" }).error).toBe("Informe o preço do item.")
    expect(reviewManualItem({ ...manual, quantity: "0" }).summary).toBeNull()
    expect(reviewManualItem({ ...manual, billing: "monthly", term: "12" }).summary?.total).toBe(8400)
  })
})
