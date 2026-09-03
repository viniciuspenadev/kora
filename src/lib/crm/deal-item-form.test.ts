import { describe, expect, it } from "vitest"
import { parseItemMoney, reviewDealItem } from "./deal-item-form"

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
