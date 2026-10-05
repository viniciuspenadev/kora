import { describe, expect, it } from "vitest"
import { outcomeFromEntry, asFormOutcome, NEEDS_CONTACT, FORM_OUTCOMES, FORM_OUTCOME_LABEL, NEEDS_CONTACT_REASON } from "./outcomes"
import { buildFormFlowVariables, formTriggerVariables } from "./flow-variables"
import { normalizeDefinition } from "./definition"

describe("situação depois do envio", () => {
  it("cada desfecho do Disparar vira uma situação clara", () => {
    expect(outcomeFromEntry({ outcome: "sent" })).toBe("sent")
    expect(outcomeFromEntry({ outcome: "no_whatsapp", reason: "send_failed" })).toBe("no_whatsapp")
    expect(outcomeFromEntry({ outcome: "blocked", reason: "phone_window" })).toBe("throttled")
    expect(outcomeFromEntry({ outcome: "blocked", reason: "tenant_hourly_cap" })).toBe("throttled")
    expect(outcomeFromEntry({ outcome: "blocked", reason: "human_attendance" })).toBe("in_attendance")
    expect(outcomeFromEntry({ outcome: "blocked", reason: "content_blocked" })).toBe("blocked")
    expect(outcomeFromEntry({ outcome: "ended" })).toBe("flow_done")
    expect(outcomeFromEntry({ outcome: "stopped", reason: "node:message" })).toBe("flow_error")
  })
  it("quem precisa de contato humano: o Kora não chamou (em atendimento NÃO — o responsável já foi avisado)", () => {
    expect([...NEEDS_CONTACT].sort()).toEqual(["blocked", "flow_done", "flow_error", "no_flow", "no_whatsapp", "throttled"])
    expect(NEEDS_CONTACT.has("in_attendance")).toBe(false)
    for (const o of NEEDS_CONTACT) expect(NEEDS_CONTACT_REASON[o]).toBeTruthy()
    for (const o of FORM_OUTCOMES) expect(FORM_OUTCOME_LABEL[o]).toBeTruthy()
  })
  it("valor desconhecido do banco vira 'Recebida' (não quebra a tela)", () => {
    expect(asFormOutcome("qualquer")).toBe("received")
    expect(asFormOutcome("sent")).toBe("sent")
  })
})

describe("o que o fluxo recebe", () => {
  const def = normalizeDefinition({ questions: [
    { id: "servico", type: "cards", title: "O que você precisa?", options: [{ id: "box", label: "Box" }, { id: "sacada", label: "Sacada" }] },
    { id: "obra", type: "location", title: "Onde é a obra?" },
  ] })
  it("respostas pelo rótulo legível, primeiro nome, origem e campanha", () => {
    const v = buildFormFlowVariables({
      contactName: "Marina  Lopes", phoneE164: "5547998124471", formName: "Orçamento", definition: def,
      answers: { servico: "box", obra: { city: "Itajaí", district: "Fazenda" } }, source: { kind: "qr", utm: { campaign: "verao" } },
    })
    expect(v).toEqual({
      nome: "Marina  Lopes", primeiro_nome: "Marina", telefone: "+55 (47) 99812-4471",
      resposta: { servico: "Box", obra: "Itajaí · Fazenda" }, formulario: "Orçamento", origem: "QR", campanha: "verao",
    })
  })
  it("o catálogo do painel lista exatamente as chaves que o motor preenche", () => {
    const tokens = formTriggerVariables({ id: "f", name: "x", status: "published", questions: [{ id: "servico", title: "O que você precisa?" }] }).map((t) => t.token)
    expect(tokens).toEqual(["resposta.servico", "primeiro_nome", "formulario", "origem", "campanha"])
    const v = buildFormFlowVariables({ contactName: "A", phoneE164: "5511999990000", formName: "x", definition: def, answers: {}, source: null })
    for (const t of tokens.filter((t) => !t.startsWith("resposta."))) expect(t in v).toBe(true)
  })
})
