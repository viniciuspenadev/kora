import { beforeEach, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }))
const rpc = vi.fn(async (_name: string, _args: unknown): Promise<{ error: { code: string; message: string } | null }> => ({ error: null }))
const db = new MemoryDb()
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: db.from, rpc } }))
vi.mock("@/auth", () => ({ auth: vi.fn() }))
const id = "00000000-0000-4000-8000-000000000001"
let admin = true
vi.mock("@/lib/visibility", async original => ({ ...await original<typeof import("@/lib/visibility")>(),
  getViewerScope: async () => ({ tenantId: "tenant", userId: id, isAdmin: admin, viewAll: false, seePool: true,
    departmentId: null, instanceIds: null, supervisesDepartments: [] }),
}))
const { saveMemberConversationAccess } = await import("./team-conversation-access")
const { reconcileConversationAccess } = await import("./conversation-access")
const input = { role: "agent" as const, departmentId: null, viewAll: false, seePool: true, instanceIds: [], supervisesDepartments: [] }
beforeEach(() => { admin = true; rpc.mockReset(); rpc.mockResolvedValue({ error: null }); db.reset({ chat_conversations: [] }) })
it("envia um único conjunto allow-listed à RPC com tenant e ator do servidor", async () => {
  await expect(saveMemberConversationAccess(id, { ...input, tenantId: "other" } as typeof input)).resolves.toEqual({})
  expect(rpc).toHaveBeenCalledTimes(1)
  expect(rpc).toHaveBeenCalledWith("save_member_conversation_access", { p_tenant_id: "tenant", p_actor_id: id, p_user_id: id,
    p_role: "agent", p_department_id: null, p_view_all: false, p_see_pool: true, p_instance_ids: [], p_supervises_departments: [] })
})
it("agente não pode chamar a gravação de permissões", async () => {
  admin = false
  expect((await saveMemberConversationAccess(id, input)).error).toMatch(/administradores/)
  expect(rpc).not.toHaveBeenCalled()
})
it.each([{ seePool: "false" }, { instanceIds: ["invalid"] }, { role: "root" }, { viewAll: true, supervisesDepartments: [id] }])("rejeita entrada inválida antes da escrita: %j", async patch => {
  expect((await saveMemberConversationAccess(id, { ...input, ...patch } as typeof input)).error).toBeTruthy()
  expect(rpc).not.toHaveBeenCalled()
})
it("erro de infraestrutura não vaza detalhes do banco", async () => {
  rpc.mockResolvedValue({ error: { code: "XX000", message: "secret database detail" } })
  const result = await saveMemberConversationAccess(id, input)
  expect(result.error).not.toContain("secret")
  expect(result.error).toContain("Nenhuma permissão")
})
it("reconciliação remove acesso perdido e nunca inclui outro tenant", async () => {
  admin = false
  db.tables.chat_conversations = [
    { id: "general", tenant_id: "tenant", assigned_to: null, department_id: null },
    { id: "department", tenant_id: "tenant", assigned_to: null, department_id: "sales" },
    { id: "other", tenant_id: "other", assigned_to: id },
  ]
  expect((await reconcileConversationAccess(["general", "department", "other"])).visibleIds).toEqual(["general"])
  db.tables.chat_conversations[0].assigned_to = "someone"
  expect((await reconcileConversationAccess(["general"])).visibleIds).toEqual([])
})
it("reconciliação não transforma erro em lista de acesso válida", async () => {
  db.errors.chat_conversations = "unavailable"
  await expect(reconcileConversationAccess([id])).rejects.toThrow("Não foi possível confirmar")
})
it("limita o lote de revalidação", async () => {
  await expect(reconcileConversationAccess(Array(501).fill(id))).rejects.toThrow("inválida")
})
