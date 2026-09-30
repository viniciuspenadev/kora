import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"
vi.mock("server-only", () => ({}))
const db = new MemoryDb(), sendText = vi.fn(), sendMedia = vi.fn(), voice = vi.fn()
const user = { id: "agent", tenantId: "blue", role: "owner" }
vi.mock("@/auth", () => ({ auth: async () => ({ user }) }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/lib/visibility", () => ({ getViewerScope: async () => ({ tenantId: user.tenantId, userId: user.id, isAdmin: true }), canViewConversation: () => true }))
vi.mock("@/lib/atendimento/attendance-claim", () => ({ prepareHumanReply: vi.fn(), claimAfterAcceptedReply: vi.fn() }))
vi.mock("@/lib/providers", () => ({ getProvider: () => ({ providerName: "baileys", sendText, sendMedia, sendVoiceNote: voice }) }))
vi.mock("@/lib/auth/tenant-serviceable", () => ({ assertAtendimentoLiberado: vi.fn(), checkTenantStatus: vi.fn(), atendimentoBloqueado: () => false }))
vi.mock("@/lib/contacts/identity", () => ({ adoptRecipientJid: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
const { sendMessage, sendChatMedia } = await import("./chat")
beforeEach(() => {
  vi.clearAllMocks()
  db.reset({ tenant_config: [{ tenant_id: "blue", agent_signature: { enabled: true, departments: {}, agents: {} } }],
    profiles: [{ id: "agent", full_name: "Ana" }],
    chat_conversations: [{ id: "conv", tenant_id: "blue", is_group: false, instance_id: "number", assigned_to: "agent", department_id: null,
      channel: "whatsapp", last_inbound_at: new Date().toISOString(), chat_contacts: { phone_number: "5511999999999" }, whatsapp_instances: { provider: "baileys" } }],
    whatsapp_instances: [{ id: "number", tenant_id: "blue", provider: "baileys" }], chat_messages: [] })
  sendText.mockResolvedValue({ messageId: "wa-text" }); sendMedia.mockResolvedValue({ messageId: "wa-media" }); voice.mockResolvedValue({ messageId: "wa-voice" })
})
describe("assinatura na entrega individual", () => {
  it.each(["baileys", "meta_cloud"])("texto manual %s: provedor, registro e retorno recebem o mesmo conteúdo", async provider => {
    db.tables.whatsapp_instances[0].provider = provider
    db.tables.chat_conversations[0].whatsapp_instances.provider = provider
    const result = await sendMessage("conv", "Olá")
    expect(sendText).toHaveBeenCalledWith("5511999999999", "*Ana*\n\nOlá", undefined)
    expect(result.content).toBe(db.tables.chat_messages[0].content)
    expect(result.signature?.name).toBe("Ana")
  })
  it("nota interna e webchat não recebem assinatura", async () => {
    expect((await sendMessage("conv", "Nota", true)).content).toBe("Nota")
    db.tables.chat_conversations[0].channel = "site"
    expect((await sendMessage("conv", "Olá no site")).content).toBe("Olá no site")
    expect(sendText).not.toHaveBeenCalled()
  })
  it("legenda é assinada e arquivo sem legenda permanece sem assinatura", async () => {
    const fd = new FormData(); fd.set("file", new File(["fixture"], "image.png", { type: "image/png" })); fd.set("caption", "Foto")
    const result = await sendChatMedia("conv", fd)
    expect(result).toMatchObject({ content: "*Ana*\n\nFoto" })
    expect(sendMedia).toHaveBeenCalledWith("5511999999999", expect.any(String), "image", "*Ana*\n\nFoto", "image.png", undefined)
    fd.delete("caption"); expect(await sendChatMedia("conv", fd)).toMatchObject({ content: "", signature: null })
  })
  it("áudio não dispara texto extra", async () => {
    const fd = new FormData(); fd.set("file", new File(["fixture"], "voice.ogg", { type: "audio/ogg" })); fd.set("ptt", "1")
    expect(await sendChatMedia("conv", fd)).toMatchObject({ content: "", signature: null })
    expect(voice).toHaveBeenCalledTimes(1); expect(sendText).not.toHaveBeenCalled()
  })
})
