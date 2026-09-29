import { expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))
vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: {} }))
const { teamAccessSummary } = await import("./team-access-summary")
const { uncoveredTeamQueues } = await import("./team-queue-coverage")
const input = { role: "agent", viewAll: false, seePool: false, departmentName: null, supervisedNames: [], numberNames: [] }
it("sem departamento explica participações e não promete fila própria", () => {
  const text = teamAccessSummary(input).join(" ")
  expect(text).toContain("participa")
  expect(text).toContain("Não acessa a fila geral")
  expect(text).not.toContain("fila de")
})
it("fila geral desligada preserva descrição da fila própria e da supervisão", () => {
  const text = teamAccessSummary({ ...input, departmentName: "Comercial", supervisedNames: ["Suporte"] }).join(" ")
  expect(text).toContain("fila de Comercial")
  expect(text).toContain("Supervisiona todas as conversas de: Suporte")
})
it("seleção de números explica exceções de atribuição e participação", () => {
  expect(teamAccessSummary({ ...input, numberNames: ["Comercial"] }).join(" ")).toContain("mesmo em outro número")
})
it("fila geral não conta como cobertura de outro departamento", () => {
  const result = uncoveredTeamQueues([{ role: "agent", active: true, see_pool: true }], [{ id: "sales", name: "Comercial" }], [])
  expect(result).toHaveLength(1)
  expect(result[0]).toContain("Comercial")
})
it("administrador sozinho não substitui agente na cobertura operacional", () => {
  expect(uncoveredTeamQueues([{ role: "owner", active: true }], [], [])).toHaveLength(1)
})
it("agente do setor cobre a própria fila com geral desligada", () => {
  const result = uncoveredTeamQueues([{ role: "agent", active: true, see_pool: false, department_id: "sales" }], [{ id: "sales", name: "Comercial" }], [])
  expect(result).toHaveLength(1); expect(result[0]).toContain("Fila geral")
})
it("atendente inativo ou número diferente não cobrem a fila", () => {
  expect(uncoveredTeamQueues([{ role: "agent", active: false, see_pool: true }, { role: "agent", active: true, see_pool: true, instance_ids: ["b"] }], [], [{ id: "a", label: "Comercial" }])[0]).toContain("Comercial")
})
