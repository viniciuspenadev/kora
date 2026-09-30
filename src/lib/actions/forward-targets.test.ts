import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

// Janela "Encaminhar para…": o que aparece como destino (a regra de visibilidade em si é a do
// inbox — `applyVisibilityFilter`, a real, aqui com escopo de admin).
vi.mock("server-only", () => ({}))
const T = "0d907fdd-f4eb-435b-ae9d-d20d4e3f4fc5", OTHER_T = "11111111-1111-4111-8111-111111111111"
const db = new MemoryDb()
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "owner-1", tenantId: T, role: "owner" } }) }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/lib/visibility", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/visibility")>()),
  getViewerScope: async () => ({ tenantId: T, userId: "owner-1", isAdmin: true, viewAll: false, seePool: true, departmentId: null, supervisesDepartments: [], instanceIds: null }),
}))
const { searchForwardTargets } = await import("./conversations")

const recent = new Date().toISOString()
const conv = (id: string, over: Record<string, unknown> = {}) => ({
  id, tenant_id: T, is_group: false, status: "open", channel: "whatsapp", instance_id: "num", last_inbound_at: recent, archived_at: null,
  last_message_at: recent, whatsapp_instances: { provider: "baileys", display_name: null },
  chat_contacts: { custom_name: null, push_name: `Cliente ${id}`, phone_number: "5511999998888", bsuid: null, profile_pic_url: null }, ...over,
})

beforeEach(() => {
  db.reset({ chat_conversations: [
    conv("aberta"),
    conv("arquivada", { archived_at: "2026-09-10T12:00:00.000Z", status: "resolved" }),
    conv("concluida", { status: "resolved" }),
    conv("oficial-fechada", { channel: "meta_cloud", whatsapp_instances: { provider: "meta_cloud", display_name: "Oficial" }, last_inbound_at: "2026-09-01T00:00:00.000Z" }),
    conv("sem-numero", { instance_id: null }),
    conv("grupo", { is_group: true }),
    conv("outro-cliente", { tenant_id: OTHER_T }),
  ] })
})

describe("destinos do encaminhar", () => {
  it("arquivada aparece como destino, com o selo; concluída também", async () => {
    const list = await searchForwardTargets("")
    const byId = Object.fromEntries(list.map((t) => [t.id, t]))
    expect(byId.arquivada).toMatchObject({ archived: true, blocked: null, status: "resolved" })
    expect(byId.concluida).toMatchObject({ archived: false, blocked: null, status: "resolved" })
    expect(byId.aberta).toMatchObject({ archived: false, blocked: null, name: "Cliente aberta", phone: expect.stringContaining("99999") })
  })

  it("quem não pode receber agora aparece bloqueado, com o motivo", async () => {
    const byId = Object.fromEntries((await searchForwardTargets("")).map((t) => [t.id, t]))
    expect(byId["oficial-fechada"]).toMatchObject({ blocked: expect.stringContaining("Janela fechada"), numberName: "Oficial" })
    expect(byId["sem-numero"]).toMatchObject({ blocked: "Sem número de WhatsApp" })
  })

  it("grupo e conversa de outro cliente do Kora nunca aparecem", async () => {
    const ids = (await searchForwardTargets("")).map((t) => t.id)
    expect(ids).not.toContain("grupo")
    expect(ids).not.toContain("outro-cliente")
  })
})
