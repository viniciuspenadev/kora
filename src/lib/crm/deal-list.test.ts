import { describe, expect, it } from "vitest"
import type { DealRow } from "@/lib/actions/deals"
import { dealListReturnHref, dealStageDays, filterDealList, sortDealList, taskTiming, type DealListFilters } from "./deal-list"

const now = new Date(2026, 8, 3, 12).getTime()
const filters: DealListFilters = { search: "", pipeline: "", stage: "", status: "", responsible: "", unit: "", focus: "" }
const deal = (id: string, changes: Partial<DealRow> = {}): DealRow => ({
  id, name: "Plano comercial", contact_id: null, contact_name: "João", company_id: null, company_name: "Órbita",
  pipeline_id: "pipeline-a", pipeline_name: "Vendas", created_by: "creator", assigned_to: "assignee",
  stage: { id: "stage-a", name: "Proposta", color: "#004add", is_won: false, is_lost: false },
  status: "open", estimated_value: null, won_at: null, lost_at: null, stage_entered_at: null,
  updated_at: new Date(now).toISOString(), responsible: "Maria", next_task: null, conversation_id: null,
  contact_pic: null, conversation_unread: false, tags: [], unit_id: null, ...changes,
})

describe("deal list", () => {
  it("only allows detail backlinks to the local deals list", () => {
    expect(dealListReturnHref("/negocios?view=list&status=open&page=2")).toBe("/negocios?view=list&status=open&page=2")
    for (const value of [null, "https://example.com", "//example.com", "javascript:alert(1)", "/negocios/other"]) expect(dealListReturnHref(value)).toBe("/negocios")
  })
  it("filters current assignee rather than creator, including unassigned deals", () => {
    const rows = [deal("a"), deal("b", { assigned_to: "creator", created_by: "assignee" })]
    expect(filterDealList(rows, { ...filters, responsible: "assignee" }, now).map((d) => d.id)).toEqual(["a"])
    expect(filterDealList([deal("c", { assigned_to: null })], { ...filters, responsible: "none" }, now)).toHaveLength(1)
  })
  it("combines filters and accent-insensitive contact/company search", () => {
    const rows = [deal("a", { unit_id: "unit-a" }), deal("b", { pipeline_id: "pipeline-b" }), deal("c", { status: "won" })]
    expect(filterDealList(rows, { ...filters, search: "orbita", status: "open", pipeline: "pipeline-a", stage: "stage-a", unit: "unit-a" }, now).map((d) => d.id)).toEqual(["a"])
    expect(filterDealList(rows, { ...filters, search: "joao", unit: "none" }, now)).toHaveLength(2)
  })
  it("distinguishes missing task from missing deadline and excludes closed deals from attention", () => {
    const overdue = deal("a", { next_task: { title: "Ligar", due_at: new Date(now - 3_600_000).toISOString() } })
    const closed = { ...overdue, id: "b", status: "won" }
    const undated = deal("c", { next_task: { title: "Revisar", due_at: null } })
    const rows = [overdue, closed, undated, deal("d")]
    expect(filterDealList(rows, { ...filters, focus: "overdue" }, now).map((d) => d.id)).toEqual(["a"])
    expect(filterDealList(rows, { ...filters, focus: "today" }, now).map((d) => d.id)).toEqual(["a"])
    expect(filterDealList(rows, { ...filters, focus: "no_task" }, now).map((d) => d.id)).toEqual(["d"])
    expect(taskTiming(undated, now)).toBe("undated")
  })
  it("sorts actual amounts including zero before missing values without mutating props", () => {
    const rows = [deal("missing"), deal("big", { estimated_value: 5000.51 }), deal("zero", { estimated_value: 0 })]
    expect(sortDealList(rows, "value_asc").map((d) => d.id)).toEqual(["zero", "big", "missing"])
    expect(sortDealList(rows, "value_desc").map((d) => d.id)).toEqual(["big", "zero", "missing"])
    expect(rows[0].id).toBe("missing")
  })
  it("orders actionable deadlines before undated and closed deals", () => {
    const rows = [deal("z"), deal("c", { status: "canceled", next_task: { title: "Old", due_at: new Date(now - 86_400_000).toISOString() } }), deal("a", { next_task: { title: "Next", due_at: new Date(now + 3600).toISOString() } })]
    expect(sortDealList(rows, "next_action").map((d) => d.id)).toEqual(["a", "c", "z"])
    expect(taskTiming(rows[1], now)).toBe("closed")
  })
  it("handles invalid and future stage timestamps without inventing inactivity", () => {
    expect(dealStageDays(deal("a", { stage_entered_at: new Date(now - 4 * 86_400_000).toISOString() }), now)).toBe(4)
    expect(dealStageDays(deal("b", { stage_entered_at: "invalid" }), now)).toBeNull()
    expect(dealStageDays(deal("c", { stage_entered_at: new Date(now + 1000).toISOString() }), now)).toBe(0)
  })
})
