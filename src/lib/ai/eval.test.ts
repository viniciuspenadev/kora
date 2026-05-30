// ═══════════════════════════════════════════════════════════════
// Eval set determinístico — cenários realistas por segmento
// ═══════════════════════════════════════════════════════════════
// Exercita o pipeline PURO (evaluateTriggers → compilePrompt) ponta-a-ponta
// pra setups de tenant que espelham casos reais. Guarda contra regressão na
// seleção de trigger E na composição do prompt.
//
// A qualidade da RESPOSTA da LLM é avaliada à parte (manual, live) —
// ver docs/ai-rebuild/eval-set.md. Aqui só o que é determinístico.

import { describe, it, expect } from "vitest"
import { evaluateTriggers, type TriggerEvalState } from "./evaluate-triggers"
import { compilePrompt, type CompileInput } from "./compile-prompt"
import type { AITrigger, AITriggerInput } from "@/types/ai"

let seq = 0
function mkTrigger(t: Partial<AITriggerInput> & { name: string }): AITrigger {
  seq += 1
  return {
    id:               `trg-${seq}`,
    tenant_id:        "t",
    priority:         100,
    active:           true,
    conditions:       [],
    context_payload:  [],
    instruction:      null,
    action_type:      "respond_only",
    action_target_id: null,
    qualification:    [],
    created_at:       `2026-01-${String(seq).padStart(2, "0")}T00:00:00Z`,
    updated_at:       "2026-01-01T00:00:00Z",
    ...t,
  }
}

function state(o: Partial<TriggerEvalState> = {}): TriggerEvalState {
  return {
    isKnownContact: false, lifecycle: "contact", tagIds: [], stageId: null,
    origin: "direct", isFirstMessageOfSession: true, inactive24h: false,
    incomingTextLower: "", ...o,
  }
}

// Setup típico: alguns triggers priorizados + catch-all "Geral" no fim.
function tenantTriggers(): AITrigger[] {
  return [
    mkTrigger({
      name: "Captura de anúncio", priority: 10, active: true,
      conditions: [{ attribute: "origin", operator: "equals", value: "ad" }],
      context_payload: ["contact_fields", "conversation_history"],
      instruction: "Cliente veio de anúncio. Descubra o que ele viu e qualifique.",
      action_type: "route_to_department", action_target_id: "dept-vendas",
    }),
    mkTrigger({
      name: "VIPs retornando", priority: 20, active: true,
      conditions: [
        { attribute: "tags", operator: "contains", value: ["vip"] },
        { attribute: "lifecycle", operator: "equals", value: "won" },
      ],
      context_payload: ["contact_fields", "contact_tags", "conversation_history"],
      instruction: "Acolha pelo nome, sem se reapresentar.",
      action_type: "route_to_department", action_target_id: "dept-vendas",
    }),
    mkTrigger({
      name: "Cobrança", priority: 30, active: true,
      conditions: [{ attribute: "tags", operator: "contains", value: ["inadimplente"] }],
      context_payload: ["contact_fields"],
      instruction: null,
      action_type: "route_to_department", action_target_id: "dept-financeiro",
    }),
    mkTrigger({
      name: "Quer orçamento", priority: 40, active: true,
      conditions: [{ attribute: "message_contains_keyword", operator: "contains", value: ["orçamento", "preço", "comprar"] }],
      context_payload: ["conversation_history"],
      instruction: null,
      action_type: "route_to_department", action_target_id: "dept-vendas",
    }),
    mkTrigger({
      name: "Geral", priority: 9000, active: true,
      conditions: [],
      context_payload: ["contact_fields", "conversation_history"],
      instruction: null,
      action_type: "respond_only", action_target_id: null,
    }),
  ]
}

describe("eval set — seleção de trigger por cenário", () => {
  const triggers = tenantTriggers()

  it("paciente novo cru → cai no catch-all Geral (respond_only)", () => {
    const m = evaluateTriggers(triggers, state({ lifecycle: "contact", isFirstMessageOfSession: true, incomingTextLower: "oi, bom dia" }))
    expect(m?.name).toBe("Geral")
    expect(m?.action_type).toBe("respond_only")
  })

  it("lead de anúncio → Captura de anúncio (maior prioridade vence)", () => {
    // mesmo com keyword de orçamento, anúncio tem prioridade menor (10 < 40)
    const m = evaluateTriggers(triggers, state({ origin: "ad", incomingTextLower: "quero saber preço" }))
    expect(m?.name).toBe("Captura de anúncio")
    expect(m?.action_target_id).toBe("dept-vendas")
  })

  it("VIP ganho retornando → VIPs retornando", () => {
    const m = evaluateTriggers(triggers, state({ tagIds: ["vip"], lifecycle: "won", isKnownContact: true, incomingTextLower: "voltei" }))
    expect(m?.name).toBe("VIPs retornando")
  })

  it("VIP mas ainda lead (não ganho) → NÃO casa VIPs, cai em Geral", () => {
    const m = evaluateTriggers(triggers, state({ tagIds: ["vip"], lifecycle: "lead", incomingTextLower: "oi" }))
    expect(m?.name).toBe("Geral")
  })

  it("inadimplente → Cobrança → Financeiro", () => {
    const m = evaluateTriggers(triggers, state({ tagIds: ["inadimplente"], lifecycle: "lead", incomingTextLower: "recebi uma cobrança" }))
    expect(m?.name).toBe("Cobrança")
    expect(m?.action_target_id).toBe("dept-financeiro")
  })

  it("pede orçamento (sem outras condições) → Quer orçamento → Vendas", () => {
    const m = evaluateTriggers(triggers, state({ incomingTextLower: "qual o preço do plano?" }))
    expect(m?.name).toBe("Quer orçamento")
    expect(m?.action_target_id).toBe("dept-vendas")
  })

  it("sem catch-all e nada casa → null (IA não atua)", () => {
    const semGeral = triggers.filter((t) => t.name !== "Geral")
    const m = evaluateTriggers(semGeral, state({ incomingTextLower: "oi" }))
    expect(m).toBeNull()
  })
})

describe("eval set — prompt composto bate com o trigger", () => {
  function compileFor(trigger: AITrigger, route: CompileInput["route"]): string {
    return compilePrompt({
      persona: {
        name: "Amanda", tone: "amigavel", language: "pt-BR",
        identityText: null, communicationStyle: "Direta e acolhedora.", antiPatterns: "Não inventa preço.",
      },
      knowledge: [{ title: "Horário", category: "FAQ", content: "Seg a sex 9-18h." }],
      contact: { name: "Vinicius", lifecycle: "Ganho", tags: ["vip"], lastNote: null, stageName: null },
      show: {
        contactFields: trigger.context_payload.includes("contact_fields"),
        contactTags: trigger.context_payload.includes("contact_tags"),
        contactLifecycle: trigger.context_payload.includes("contact_lifecycle"),
        pipelineStage: trigger.context_payload.includes("pipeline_stage"),
        lastNote: trigger.context_payload.includes("last_internal_note"),
      },
      instruction: trigger.instruction,
      route,
    })
  }

  it("trigger que roteia → prompt contém bloco ENCAMINHAMENTO + dept", () => {
    const t = tenantTriggers().find((x) => x.name === "VIPs retornando")!
    const out = compileFor(t, { departmentName: "Vendas", requiredFields: [{ label: "O que procura?" }], handoffMessage: "Já passei pro time!" })
    expect(out).toContain("# ENCAMINHAMENTO")
    expect(out).toContain("Vendas")
    expect(out).toContain("O que procura?")
    expect(out).toContain("route_to_department")
    // roteiro do trigger entra
    expect(out).toContain("Acolha pelo nome")
    // contato VIP visível (context_payload pede tags+fields)
    expect(out).toContain("Nome: Vinicius")
    expect(out).toContain("Tags: vip")
  })

  it("trigger respond_only → SEM bloco ENCAMINHAMENTO", () => {
    const t = tenantTriggers().find((x) => x.name === "Geral")!
    const out = compileFor(t, null)
    expect(out).not.toContain("# ENCAMINHAMENTO")
    expect(out).not.toContain("route_to_department")
    // ainda traz conhecimento + anti-alucinação
    expect(out).toContain("# O QUE VOCÊ SABE")
    expect(out).toContain("NUNCA invente")
  })
})
