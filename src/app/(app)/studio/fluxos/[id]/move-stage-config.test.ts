import { expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

// Painel do Mover etapa renderizado de verdade: kanban antes da etapa, etapas na ordem
// das colunas, destino "Kanban › Etapa", e nada de oferecer o que o motor recusa.
vi.mock("server-only", () => ({}))
vi.mock("@/lib/actions/whatsapp-official", () => ({ getInboxTemplates: async () => [] }))
vi.mock("@/auth", () => ({ auth: async () => null }))
const { MoveStageConfig } = await import("./config-panel")

const st = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ id, name, color: null, isWon: false, isLost: false, isTriage: false, available: true, ...extra })
const kanbans = [
  { id: "vendas", name: "Vendas", color: "#004add", isDefault: true, active: true,
    stages: [st("vt", "Triagem", { isTriage: true }), st("vp", "Proposta"), st("vg", "Fechado", { isWon: true }), st("vo", "Arquivo", { available: false })] },
  { id: "suporte", name: "Suporte", color: null, isDefault: false, active: true, stages: [st("sp", "Proposta")] },
  { id: "velho", name: "Antigo", color: null, isDefault: false, active: false, stages: [] },
]
const render = (cfg: Record<string, unknown>, ks = kanbans) =>
  renderToStaticMarkup(createElement(MoveStageConfig, { cfg, set: () => {}, kanbans: ks }))

it("com vários kanbans, pede o kanban antes da etapa", () => {
  const html = render({})
  expect(html).toContain("Vendas"); expect(html).toContain("Suporte")
  expect(html).toContain("Escolha o kanban para ver as etapas dele.")
  expect(html).toContain("Inativo")
})
it("etapas do kanban escolhido, na ordem, com marcas e sem oferecer a oculta", () => {
  const html = render({ pipelineId: "vendas" })
  expect(html).toContain("Etapa em Vendas")
  expect(html.indexOf("Triagem")).toBeLessThan(html.indexOf("Proposta"))
  expect(html).toContain("Ganho"); expect(html).toContain("Oculta")
  expect(html).toMatch(/type="radio"[^>]*disabled=""/)
})
it("destino mostra Kanban › Etapa e o efeito de ganho", () => {
  const html = render({ pipelineId: "vendas", stageId: "vg", stage: "Fechado" })
  expect(html).toContain("Vendas › Fechado")
  expect(html).toContain("marcada como ganha")
})
it("nó antigo só com nome avisa para fixar o destino", () => {
  expect(render({ stage: "Proposta" })).toContain("guarda só o nome")
})
it("etapa apagada avisa", () => {
  expect(render({ pipelineId: "vendas", stageId: "sumiu" })).toContain("não existe mais")
})
it("um kanban só: vai direto para as etapas", () => {
  const html = render({}, [kanbans[1]])
  expect(html).toContain("Mover para a etapa"); expect(html).not.toContain("Escolha o kanban")
})
