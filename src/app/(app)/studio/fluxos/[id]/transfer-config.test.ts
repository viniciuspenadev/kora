import { describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

// Painel do nó Transferir renderizado de verdade (sem navegador): cada configuração tem que
// MOSTRAR o efeito real — setor vazio, atendente fora do número, opção que saiu do nó.
vi.mock("server-only", () => ({}))
vi.mock("@/lib/actions/whatsapp-official", () => ({ getInboxTemplates: async () => [] }))
vi.mock("@/auth", () => ({ auth: async () => null }))
const { TransferConfig } = await import("./config-panel")

const departments = [{ id: "vendas", name: "Vendas" }, { id: "fin", name: "Financeiro" }]
const agents = [
  { id: "ana",  name: "Ana",  departmentId: "vendas", attendsAll: true,  instanceIds: [] },
  { id: "bia",  name: "Bia",  departmentId: "vendas", attendsAll: false, instanceIds: ["numero-2"] },
]
const render = (cfg: Record<string, unknown>, extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(TransferConfig, {
  cfg, set: () => {}, departments, agents, flowVars: ["cidade"], flowInstances: [], businessHoursEnabled: true, ...extra,
}))

describe("painel do Transferir", () => {
  it("destino em botões com ícone, com os 5 destinos", () => {
    const html = render({ target: "department", department: "Vendas" })
    for (const label of ["Atendente", "Departamento", "Distribuir", "Responsável", "Fila geral"]) expect(html).toContain(label)
    expect(html).toContain("Fila de Vendas")
    expect(html).toContain("As 2 pessoas do departamento podem assumir")
  })

  it("setor sem ninguém e setor apagado viram aviso, não silêncio", () => {
    expect(render({ target: "department", department: "Financeiro" })).toContain("Ninguém neste departamento")
    expect(render({ target: "department", department: "Suporte" })).toContain("não existe mais")
  })

  it("atendente que não atende o número do fluxo aparece desabilitado e avisado", () => {
    const html = render({ target: "agent" }, { flowInstances: ["numero-1"] })
    expect(html).toContain("Não atende o número deste fluxo")
    expect(html).toMatch(/type="radio"[^>]*disabled=""/)
    expect(render({ target: "agent", agentId: "bia" }, { flowInstances: ["numero-1"] })).toContain("a transferência vai falhar")
  })

  it("sem filtro de número no fluxo, ninguém é bloqueado (a checagem fica por conversa)", () => {
    expect(render({ target: "agent" })).not.toContain("Não atende o número deste fluxo")
  })

  it("rodízio mostra a ordem e marca quem foi desativado", () => {
    const html = render({ target: "round_robin", agentIds: ["bia", "sumiu", "ana"] })
    expect(html).toContain("Ordem do rodízio")
    expect(html).toContain("Rodízio entre 3 atendentes")
    expect(html).toContain("Há atendente desativado na distribuição")
    expect(html.indexOf("Bia")).toBeLessThan(html.lastIndexOf("Ana"))
  })

  it("“Manter a IA atendendo” não é mais oferecida; config antiga é avisada", () => {
    expect(render({ target: "pool" })).not.toContain("Manter a IA atendendo")
    expect(render({ target: "pool", whenUnavailable: "keep_ai" })).toContain("saiu deste nó")
  })

  it("horário desligado: diz que sempre encaminha na hora e aponta onde configurar", () => {
    const html = render({ target: "pool" }, { businessHoursEnabled: false })
    expect(html).toContain("sempre encaminhada na hora")
    expect(html).toContain('href="/automacao/mensagens"')
  })

  it("prévia mostra as duas pontas: o que o cliente recebe e o que a equipe vê", () => {
    const html = render({ target: "agent", agentId: "ana", handoff: "Oi! Sou {{agente}}.", summary: "Quer orçamento em {{cidade}}" })
    expect(html).toContain("Oi! Sou Ana.")
    expect(html).toContain("A equipe vê · nota interna")
    expect(html).toContain("Resumo: Quer orçamento em {{cidade}}")
  })
})
