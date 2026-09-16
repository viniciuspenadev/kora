import { beforeEach, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"
vi.mock("server-only", () => ({}))
const db = new MemoryDb()
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "agent", tenantId: "tenant", role: "agent" } }) }))
const { getViewerScope, canViewConversation, memberSeesUnassigned, scopeFromTenantUserRow } = await import("./visibility")
const conversation = { assigned_to: null, participants: [], department_id: null, instance_id: "number-a" }
const member = { role: "agent", see_pool: false, department_id: "sales", instance_ids: ["number-a"], supervises_departments: [] as string[] }
beforeEach(() => db.reset({ tenant_users: [{ tenant_id: "tenant", user_id: "agent", active: true, ...member }] }))
it.each([
  ["fila sem setor", {}, {}, false],
  ["fila do próprio setor mesmo desligado", {}, { department_id: "sales" }, true],
  ["fila de outro setor", {}, { department_id: "support" }, false],
  ["fila própria em número restrito", {}, { department_id: "sales", instance_id: "number-b" }, false],
  ["fila própria sem número", {}, { department_id: "sales", instance_id: null }, true],
  ["atribuição em número restrito", {}, { assigned_to: "agent", instance_id: "number-b" }, true],
  ["participação em número restrito", {}, { assigned_to: "other", participants: ["agent"], instance_id: "number-b" }, true],
  ["supervisão de setor bypassa pool e número", { supervises_departments: ["support"] }, { department_id: "support", assigned_to: "other", instance_id: "number-b" }, true],
  ["supervisão geral", { view_all: true }, { assigned_to: "other" }, true],
  ["fila geral ligada não libera outro setor", { see_pool: true }, { department_id: "support" }, false],
  ["fila própria permanece com geral ligada", { see_pool: true }, { department_id: "sales" }, true],
  ["sem departamento acessa geral autorizada", { see_pool: true, department_id: null }, {}, true],
])("regra efetiva: %s", (_label, flags: any, row: any, expected) => {
  const scope = scopeFromTenantUserRow("tenant", "agent", false, { ...member, ...flags })
  expect(canViewConversation(scope, { ...conversation, ...row })).toBe(expected)
})
it("admin continua vendo tudo com pool desligado", () => {
  expect(canViewConversation(scopeFromTenantUserRow("tenant", "agent", true, member), { ...conversation, assigned_to: "other" })).toBe(true)
})
it("push da fila própria é elegível com pool desligado", () => {
  expect(memberSeesUnassigned(member, { department_id: "sales", instance_id: "number-a" })).toBe(true)
})
it("erro ao ler permissões interrompe o acesso à fila geral", async () => {
  expect(canViewConversation(await getViewerScope(), conversation)).toBe(false)
  db.errors.tenant_users = "simulated permission read failure"
  await expect(getViewerScope()).rejects.toThrow("Não foi possível verificar")
})

it("vínculo ausente ou inativo não herda acesso padrão", async () => {
  db.tables.tenant_users = []
  await expect(getViewerScope()).rejects.toThrow("não está ativo")
  db.tables.tenant_users = [{tenant_id: "tenant", user_id: "agent", role: "admin", active: false}]
  await expect(getViewerScope()).rejects.toThrow("não está ativo")
})
it("papel atual do banco determina supervisão administrativa", async () => {
  db.tables.tenant_users[0].role = "admin"
  expect((await getViewerScope()).isAdmin).toBe(true)
  db.tables.tenant_users[0].role = "agent"
  expect((await getViewerScope()).isAdmin).toBe(false)
})
