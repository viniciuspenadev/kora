import { describe, it, expect } from "vitest"
import { evaluateTriggers, matchCondition, type TriggerEvalState } from "./evaluate-triggers"
import type { AITrigger, Condition } from "@/types/ai"

function state(overrides: Partial<TriggerEvalState> = {}): TriggerEvalState {
  return {
    isKnownContact:          false,
    lifecycle:               "contact",
    tagIds:                  [],
    stageId:                 null,
    origin:                  "direct",
    isFirstMessageOfSession: true,
    inactive24h:             false,
    incomingTextLower:       "",
    ...overrides,
  }
}

let seq = 0
function trigger(overrides: Partial<AITrigger> = {}): AITrigger {
  seq += 1
  return {
    id:               `t${seq}`,
    tenant_id:        "tenant",
    name:             `T${seq}`,
    priority:         100,
    active:           true,
    conditions:       [],
    context_payload:  [],
    instruction:      null,
    action_type:      "respond_only",
    action_target_id: null,
    created_at:       `2026-01-0${seq}T00:00:00Z`,
    updated_at:       "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

describe("matchCondition", () => {
  it("is_known_contact is_true/is_false", () => {
    const c: Condition = { attribute: "is_known_contact", operator: "is_true", value: null }
    expect(matchCondition(c, state({ isKnownContact: true }))).toBe(true)
    expect(matchCondition(c, state({ isKnownContact: false }))).toBe(false)
    const cf: Condition = { ...c, operator: "is_false" }
    expect(matchCondition(cf, state({ isKnownContact: false }))).toBe(true)
  })

  it("lifecycle equals / in", () => {
    expect(matchCondition({ attribute: "lifecycle", operator: "equals", value: "won" }, state({ lifecycle: "won" }))).toBe(true)
    expect(matchCondition({ attribute: "lifecycle", operator: "equals", value: "won" }, state({ lifecycle: "lead" }))).toBe(false)
    expect(matchCondition({ attribute: "lifecycle", operator: "in", value: ["lead", "won"] }, state({ lifecycle: "lead" }))).toBe(true)
    expect(matchCondition({ attribute: "lifecycle", operator: "not_in", value: ["lead", "won"] }, state({ lifecycle: "contact" }))).toBe(true)
  })

  it("tags contains / not_contains (case-insensitive)", () => {
    const s = state({ tagIds: ["VIP", "abc"] })
    expect(matchCondition({ attribute: "tags", operator: "contains", value: ["vip"] }, s)).toBe(true)
    expect(matchCondition({ attribute: "tags", operator: "not_contains", value: ["xyz"] }, s)).toBe(true)
    expect(matchCondition({ attribute: "tags", operator: "contains", value: ["xyz"] }, s)).toBe(false)
  })

  it("message_contains_keyword", () => {
    const s = state({ incomingTextLower: "quero saber o preço do produto" })
    expect(matchCondition({ attribute: "message_contains_keyword", operator: "contains", value: ["preço", "valor"] }, s)).toBe(true)
    expect(matchCondition({ attribute: "message_contains_keyword", operator: "contains", value: ["boleto"] }, s)).toBe(false)
    expect(matchCondition({ attribute: "message_contains_keyword", operator: "not_contains", value: ["boleto"] }, s)).toBe(true)
  })
})

describe("evaluateTriggers", () => {
  it("escolhe o de menor priority entre os que casam", () => {
    const a = trigger({ priority: 200, conditions: [] })
    const b = trigger({ priority: 50,  conditions: [] })
    expect(evaluateTriggers([a, b], state())?.id).toBe(b.id)
  })

  it("AND: só casa se TODAS as condições passam", () => {
    const t = trigger({
      priority: 10,
      conditions: [
        { attribute: "is_known_contact", operator: "is_true", value: null },
        { attribute: "tags", operator: "contains", value: ["vip"] },
      ],
    })
    const catchAll = trigger({ priority: 9000, conditions: [] })
    // falta a tag → não casa o específico, cai no catch-all
    expect(evaluateTriggers([t, catchAll], state({ isKnownContact: true, tagIds: ["outra"] }))?.id).toBe(catchAll.id)
    // com tag → casa o específico
    expect(evaluateTriggers([t, catchAll], state({ isKnownContact: true, tagIds: ["vip"] }))?.id).toBe(t.id)
  })

  it("trigger inativo é ignorado", () => {
    const inactive = trigger({ priority: 1, active: false, conditions: [] })
    const active   = trigger({ priority: 100, conditions: [] })
    expect(evaluateTriggers([inactive, active], state())?.id).toBe(active.id)
  })

  it("catch-all (sem condições) sempre casa", () => {
    const t = trigger({ conditions: [] })
    expect(evaluateTriggers([t], state())?.id).toBe(t.id)
  })

  it("nenhum match → null", () => {
    const t = trigger({ conditions: [{ attribute: "lifecycle", operator: "equals", value: "won" }] })
    expect(evaluateTriggers([t], state({ lifecycle: "contact" }))).toBeNull()
  })
})
