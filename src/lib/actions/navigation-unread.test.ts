import { beforeEach, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

vi.mock("server-only", () => ({}))
const db = new MemoryDb()
let role = "agent"
let loggedIn = true
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/auth", () => ({ auth: async () => loggedIn ? { user: { id: "agent", tenantId: "tenant", role } } : null }))
const { getNavigationUnread } = await import("./navigation-unread")
beforeEach(() => {
  role = "agent"; loggedIn = true
  const row = { tenant_id: "tenant", status: "open", unread_count: 1, assigned_to: "agent", participants: [], department_id: null, instance_id: "number-a", archived_at: null }
  db.reset({
    tenant_users: [{ tenant_id: "tenant", user_id: "agent", role: "agent", active: true, see_pool: false, instance_ids: ["number-a"] }],
    chat_conversations: [
      { ...row, id: "a", pipeline_id: "sales" }, { ...row, id: "b", pipeline_id: "support", unread_count: 8 },
      { ...row, id: "c", pipeline_id: null }, { ...row, id: "d", pipeline_id: "other-tenant", tenant_id: "other" },
      { ...row, id: "e", pipeline_id: "read", unread_count: 0 }, { ...row, id: "f", pipeline_id: "resolved", status: "resolved" },
      { ...row, id: "g", pipeline_id: "hidden", assigned_to: "someone" },
    ],
  })
})
it("separa fluxos, considera sem fluxo e não soma a quantidade de mensagens", async () => {
  expect(await getNavigationUnread()).toEqual({ unread: 3, unreadByPipeline: { sales: 1, support: 1 }, unreadWithoutPipeline: 1 })
})
it("admin vê outros atendentes somente do próprio tenant", async () => {
  role = "admin"
  db.tables.tenant_users[0].role = "admin"
  expect((await getNavigationUnread()).unreadByPipeline).toEqual({ sales: 1, support: 1, hidden: 1 })
})
it("mensagem arquivada não acende um fluxo cujo quadro não mostra arquivados", async () => {
  db.tables.chat_conversations[0].archived_at = "2026-09-15T10:00:00Z"
  expect(await getNavigationUnread()).toEqual({ unread: 3, unreadByPipeline: { support: 1 }, unreadWithoutPipeline: 1 })
})
it("pool bloqueado e outro número não vazam nos indicadores", async () => {
  db.tables.chat_conversations[0].assigned_to = null
  expect((await getNavigationUnread()).unreadByPipeline).not.toHaveProperty("sales")
  db.tables.tenant_users[0].see_pool = true
  db.tables.chat_conversations[0].instance_id = "number-b"
  expect((await getNavigationUnread()).unreadByPipeline).not.toHaveProperty("sales")
})
it("participação explícita permite indicador mesmo em outro número", async () => {
  Object.assign(db.tables.chat_conversations[6], { participants: ["agent"], instance_id: "number-b" })
  expect((await getNavigationUnread()).unreadByPipeline.hidden).toBe(1)
})
it("supervisor de setor vê o fluxo de outro atendente do setor", async () => {
  db.tables.tenant_users[0].supervises_departments = ["support"]
  db.tables.chat_conversations[6].department_id = "support"
  expect((await getNavigationUnread()).unreadByPipeline.hidden).toBe(1)
})
it("sem sessão não retorna contadores", async () => {
  loggedIn = false
  await expect(getNavigationUnread()).rejects.toThrow("Não autenticado")
})
it("falha no banco não se disfarça de ausência de mensagens", async () => {
  db.errors.chat_conversations = "unavailable"
  await expect(getNavigationUnread()).rejects.toThrow("Não foi possível atualizar")
})
