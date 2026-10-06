import { beforeEach, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"
import type { ViewerScope } from "@/lib/visibility"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/auth", () => ({ auth: vi.fn() }))
const db = new MemoryDb()
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
const user = "00000000-0000-4000-8000-000000000001"
const guest = "00000000-0000-4000-8000-000000000002"
const other = "00000000-0000-4000-8000-000000000003"
let scope: ViewerScope
vi.mock("@/lib/visibility", async original => ({ ...await original<typeof import("@/lib/visibility")>(), getViewerScope: async () => scope }))
const { addParticipant, removeParticipant, getConversationParticipants } = await import("./conversation-participants")
const conv = () => db.tables.chat_conversations[0]
beforeEach(() => {
  scope = { tenantId: "tenant", userId: user, isAdmin: false, viewAll: false, seePool: false, departmentId: null, instanceIds: ["number-a"], supervisesDepartments: [] } as unknown as ViewerScope
  db.reset({ chat_conversations: [{ id: "conversation", tenant_id: "tenant", assigned_to: user, participants: [], department_id: null, instance_id: "number-b", updated_at: "2026-09-16T10:00:00Z" }],
    tenant_users: [{ tenant_id: "tenant", user_id: user, active: true, profiles: { full_name: "Responsável" } },
      { tenant_id: "tenant", user_id: guest, active: true, profiles: { full_name: "Convidada" } },
      { tenant_id: "other-tenant", user_id: other, active: true, profiles: { full_name: "Outra empresa" } }],
    profiles: [{ id: guest, full_name: "Convidada" }], chat_messages: [] })
})
it("responsável adiciona pessoa e convite libera só a conversa de outro número", async () => {
  expect((await addParticipant("conversation", guest)).participants).toEqual([guest])
  scope.userId = guest
  const panel = await getConversationParticipants("conversation")
  expect(panel.canManage).toBe(false)
  expect(panel.participants).toEqual([guest])
  expect(panel.members.map(m => m.id)).not.toContain(other)
  db.tables.chat_conversations.push({ ...conv(), id: "uninvited", participants: [] })
  await expect(getConversationParticipants("uninvited")).rejects.toThrow(/sem acesso/)
})
it("remover o próprio convite informa perda de acesso fora dos números permitidos", async () => {
  conv().participants = [guest]; scope.userId = guest
  expect(await removeParticipant("conversation", guest)).toMatchObject({ participants: [], stillVisible: false })
})
it("remover convite mantém acesso concedido por supervisão", async () => {
  conv().participants = [guest]; scope.userId = guest; scope.viewAll = true
  expect((await removeParticipant("conversation", guest)).stillVisible).toBe(true)
})
it("convidado não adiciona nem remove outra pessoa", async () => {
  conv().participants = [guest, other]; scope.userId = guest
  await expect(addParticipant("conversation", user)).rejects.toThrow(/Somente/)
  await expect(removeParticipant("conversation", other)).rejects.toThrow(/Somente/)
  expect(db.writes).toEqual([])
})
it.each(["other-tenant", "inactive"])("rejeita convidado %s", async mode => {
  if (mode === "inactive") db.tables.tenant_users[1].active = false
  await expect(addParticipant("conversation", mode === "inactive" ? guest : other)).rejects.toThrow(/ativa desta empresa/)
  expect(db.writes).toEqual([])
})
it("não cria convite redundante para quem atende", async () => {
  await addParticipant("conversation", user)
  expect(conv().participants).toEqual([])
  expect(db.writes).toEqual([])
})
it("adição repetida e remoção ausente não duplicam histórico", async () => {
  conv().participants = [guest]
  await addParticipant("conversation", guest); await removeParticipant("conversation", other)
  expect(db.tables.chat_messages).toEqual([])
  expect(db.writes).toEqual([])
})
it("erro de gravação não apresenta sucesso nem publica histórico", async () => {
  db.beforeWrite = () => { throw new Error("write failed") }
  await expect(addParticipant("conversation", guest)).rejects.toThrow()
  expect(conv().participants).toEqual([])
  expect(db.tables.chat_messages).toEqual([])
})
it.each(["participants", "assigned_to"])("conflito em %s não sobrescreve alteração simultânea, mesmo com data igual", async field => {
  db.beforeWrite = () => { if (field === "participants") conv().participants = [other]; else conv().assigned_to = other }
  await expect(addParticipant("conversation", guest)).rejects.toThrow(/mudou durante/)
  expect(db.writes[0].count).toBe(0)
  expect(db.tables.chat_messages).toEqual([])
})
it("erro no histórico preserva o resultado do convite e retorna aviso", async () => {
  db.errors.chat_messages = "history failure"
  expect(await addParticipant("conversation", guest)).toMatchObject({ participants: [guest], warning: expect.stringContaining("histórico") })
})
it("falha na listagem de membros não vira lista vazia", async () => {
  db.errors.tenant_users = "read failure"
  await expect(getConversationParticipants("conversation")).rejects.toThrow(/carregar os convidados/)
})
it("nega conversa de outra empresa antes de ler membros", async () => {
  conv().tenant_id = "other-tenant"
  await expect(getConversationParticipants("conversation")).rejects.toThrow(/sem acesso/)
})
