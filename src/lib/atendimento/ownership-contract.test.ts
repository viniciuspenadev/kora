import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"
import type { ViewerScope } from "@/lib/visibility"

vi.mock("server-only", () => ({}))
const db = new MemoryDb()
const events: Record<string, unknown>[] = []
const accepted = vi.fn(async () => ({ messageId: "accepted" }))
let session: any
let scope: ViewerScope
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/auth", () => ({ auth: async () => session }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/atendimento/events", () => ({ logConversationEvent: async (e: any) => { events.push(e) } }))
vi.mock("@/lib/commercial/entries", () => ({ emitCommercialEvent: async (_t: string, kind: string, e: any) => { events.push({ kind, ...e }) } }))
vi.mock("@/lib/visibility", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/visibility")>(), getViewerScope: async () => scope,
}))
vi.mock("@/lib/actions/deals", () => ({ canAccessDeal: async () => true }))
vi.mock("@/lib/commercial/documents", () => ({ docCode: () => "COT/1", markDocumentSent: async () => {} }))
vi.mock("@/lib/providers", () => ({ getProvider: () => ({ providerName: "baileys", sendText: accepted,
  sendTemplate: accepted, sendMedia: accepted, sendVoiceNote: accepted, sendLocation: accepted, sendContacts: accepted,
  sendSticker: accepted, sendReaction: accepted }) }))
vi.mock("@/lib/auth/tenant-serviceable", () => ({ assertAtendimentoLiberado: async () => {},
  atendimentoBloqueado: () => false, checkTenantStatus: async () => ({ canSpend: true }) }))
vi.mock("@/lib/modules", () => ({ requireModule: async () => {}, hasModule: async () => false }))
vi.mock("@/lib/contacts/identity", () => ({ adoptRecipientJid: async () => {} }))
vi.mock("@/lib/whatsapp/provisioning", () => ({}))
vi.mock("@/lib/crypto/secrets", () => ({}))
vi.mock("@/lib/media/transcode", () => ({}))
vi.mock("@/lib/atendimento/followup", () => ({ moveFollowUpOwner: async () => {} }))
vi.mock("@/lib/instagram/api", () => ({ getInstagramSender: async () => ({ igAccountId: "ig", token: "test" }), sendInstagramText: accepted }))
vi.mock("@/lib/ai-v2/http-guard", () => ({}))
vi.mock("@/lib/rate-limit", () => ({}))
vi.mock("@/lib/limits", () => ({}))
vi.mock("@/lib/conversation-dedup", () => ({}))
vi.mock("@/lib/notifications", () => ({ createNotification: async () => {} }))
vi.mock("@/lib/ai-v2/flow/dossier", () => ({ extractDossier: async () => [] }))
vi.mock("@/lib/atendimento/availability", () => ({ checkDestinationAvailability: async () => ({ available: true }) }))
vi.mock("@/lib/channels/reply", () => ({ sendChannelText: accepted, sendChannelMedia: accepted,
  sendChannelRich: accepted, sendChannelInteractive: accepted }))

const { prepareHumanReply } = await import("./attendance-claim")
const { routeToHumanDefault } = await import("./human-routing")
const { assertStudioControl, beginStudioControl } = await import("@/lib/ai-v2/control")
const { sendBotText } = await import("@/lib/ai-v2/outbound")
const { transferCapability } = await import("@/lib/ai-v2/capabilities/transfer")
const chat = await import("@/lib/actions/chat")
const { sendQuoteInChat } = await import("@/lib/actions/documents")

const conv = () => db.tables.chat_conversations[0]
const contact = () => db.tables.chat_contacts[0]
const ctx = () => ({ tenantId: "t", conversationId: "c", conversationMetadata: structuredClone(conv().metadata),
  contact: { id: "contact", phone_number: "5511999999999", primary_channel: "whatsapp" }, instance: {},
  departments: [{ id: "finance", name: "Financeiro" }], history: [] } as any)

beforeEach(() => {
  vi.restoreAllMocks(); events.length = 0; accepted.mockReset().mockResolvedValue({ messageId: "accepted" })
  vi.spyOn(console, "error").mockImplementation(() => {})
  session = { user: { id: "agent", tenantId: "t", role: "agent" } }
  scope = { tenantId: "t", userId: "agent", isAdmin: false, viewAll: false,
    instanceIds: null, departmentId: "sales", seePool: true, supervisesDepartments: [] } as unknown as ViewerScope
  db.reset({
    chat_conversations: [{ id: "c", tenant_id: "t", contact_id: "contact", assigned_to: null, participants: [],
      department_id: null, instance_id: "number", status: "open", ai_handling: true, channel: "whatsapp",
      updated_at: "2026-01-01T00:00:00Z", metadata: {}, last_inbound_at: new Date().toISOString(),
      whatsapp_instances: { provider: "baileys" }, chat_contacts: { phone_number: "5511999999999", primary_external_id: "igsid" } }],
    chat_contacts: [{ id: "contact", tenant_id: "t", owner_id: null }],
    tenant_config: [{ tenant_id: "t", handoff_binding: "carteira" }],
    tenant_users: ["agent", "owner", "other"].map(user_id => ({ tenant_id: "t", user_id,
      active: true, department_id: "sales", role: "agent", view_all: false, instance_ids: ["number"] })),
    whatsapp_instances: [{ id: "number", tenant_id: "t", provider: "baileys" }], profiles: [], chat_messages: [],
    tenant_departments: [{ id: "finance", tenant_id: "t", name: "Financeiro" }],
  })
})

describe("resposta aceita forma carteira; atribuição e destino são independentes", () => {
  it.each([null, "agent"])("texto aceito carimba, inclusive atribuição prévia %s", async assigned => {
    conv().assigned_to = assigned
    accepted.mockImplementationOnce(async () => { expect(contact().owner_id).toBeNull(); return { messageId: "accepted" } })
    await chat.sendMessage("c", "Olá")
    expect(contact().owner_id).toBe("agent"); expect(conv().ai_handling).toBe(false)
    expect(db.tables.chat_messages[0].status).toBe("sent")
  })
  it("provider rejeitado mantém contato sem dono e registra falha", async () => {
    accepted.mockRejectedValueOnce(new Error("provider failed"))
    await expect(chat.sendMessage("c", "Olá")).rejects.toThrow("provider failed")
    expect(contact().owner_id).toBeNull(); expect(db.tables.chat_messages[0].status).toBe("failed")
  })
  it.each(["pool", "error"])("config %s não autoriza carimbo", async binding => {
    if (binding === "error") db.errors.tenant_config = "offline"
    else db.tables.tenant_config[0].handoff_binding = binding
    await chat.sendMessage("c", "Olá")
    expect(contact().owner_id).toBeNull(); expect(conv().assigned_to).toBe("agent")
  })
  it("não rouba carteira preexistente nem como participante", async () => {
    contact().owner_id = "owner"; conv().assigned_to = "other"; conv().participants = ["agent"]
    await chat.sendMessage("c", "Posso ajudar")
    expect(contact().owner_id).toBe("owner"); expect(conv().assigned_to).toBe("other")
  })
  it("participante não carimba um contato vazio em conversa de outro", async () => {
    conv().assigned_to = "other"; conv().participants = ["agent"]
    await chat.sendMessage("c", "Posso ajudar")
    expect(contact().owner_id).toBeNull()
  })
  it("nota privada não toma controle nem cria vínculo", async () => {
    await chat.sendMessage("c", "Nota", true)
    expect(contact().owner_id).toBeNull(); expect(conv().assigned_to).toBeNull()
    expect(conv().ai_handling).toBe(true); expect(accepted).not.toHaveBeenCalled()
  })
  it("reação não cria vínculo", async () => {
    await chat.reactToMessage("c", "message", "👍")
    expect(contact().owner_id).toBeNull(); expect(conv().assigned_to).toBeNull()
  })
  it.each(["site", "instagram"])("texto público do canal %s carimba", async channel => {
    conv().channel = channel
    await chat.sendMessage("c", "Olá")
    expect(contact().owner_id).toBe("agent")
  })
  it("template aceito carimba", async () => {
    await chat.sendOfficialTemplate("c", "hello", "pt_BR", [], "Olá")
    expect(contact().owner_id).toBe("agent")
  })
  it.each(["location", "contact", "sticker", "media"])("envio %s falho não carimba", async kind => {
    accepted.mockRejectedValueOnce(new Error("rejected"))
    const form = new FormData(); form.set("file", new File(["image"], "image.webp", { type: "image/webp" })); form.set("conversationId", "c")
    const result = kind === "location" ? await chat.sendLocationMessage("c", { latitude: -23, longitude: -46 })
      : kind === "contact" ? await chat.sendContactMessage("c", { name: "Teste", phone: "5511999999999" })
      : kind === "sticker" ? await chat.sendStickerMessage("c", form) : await chat.sendChatMedia("c", form)
    expect(result).toHaveProperty("error"); expect(contact().owner_id).toBeNull()
    expect(db.tables.chat_messages[0].status).toBe("failed")
  })
  it("janela fechada recusa localização antes de atribuir ou enviar", async () => {
    conv().whatsapp_instances.provider = "meta_cloud"; conv().last_inbound_at = "2020-01-01T00:00:00Z"
    expect(await chat.sendLocationMessage("c", { latitude: 0, longitude: 0 })).toHaveProperty("error")
    expect(accepted).not.toHaveBeenCalled(); expect(conv().assigned_to).toBeNull()
  })
  it("duas tomadas simultâneas têm um vencedor e um evento", async () => {
    const results = await Promise.allSettled([prepareHumanReply("t", "c", "agent", null, scope),
      prepareHumanReply("t", "c", "other", null, { ...scope, userId: "other" })])
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1)
    expect(events.filter(e => e.type === "assigned")).toHaveLength(1)
  })
  it("remoção de participante revoga a permissão antes do CAS", async () => {
    conv().assigned_to = "other"; conv().participants = []
    await expect(prepareHumanReply("t", "c", "agent", "other", scope)).rejects.toThrow("permissão")
  })
  it("troca de setor com assigned_to nulo revoga acesso à fila antiga", async () => {
    scope.seePool = false; conv().department_id = "finance"
    await expect(prepareHumanReply("t", "c", "agent", null, scope)).rejects.toThrow("permissão")
    expect(conv().assigned_to).toBeNull()
  })
  it.each(["location", "contact", "sticker", "media"])("%s aceito carimba após persistência pending", async kind => {
    accepted.mockImplementationOnce(async () => {
      expect(db.tables.chat_messages[0].status).toBe("pending"); expect(contact().owner_id).toBeNull()
      return { messageId: "accepted" }
    })
    const form = new FormData(); form.set("file", new File(["image"], "image.webp", { type: "image/webp" }))
    const result = kind === "location" ? await chat.sendLocationMessage("c", { latitude: 0, longitude: 0 })
      : kind === "contact" ? await chat.sendContactMessage("c", { name: "Teste", phone: "5511999999999" })
      : kind === "sticker" ? await chat.sendStickerMessage("c", form) : await chat.sendChatMedia("c", form)
    expect(result).toHaveProperty("id"); expect(contact().owner_id).toBe("agent")
  })
  it("falha ao persistir impede envio da localização", async () => {
    db.errors.chat_messages = "offline"
    expect(await chat.sendLocationMessage("c", { latitude: 0, longitude: 0 })).toHaveProperty("error")
    expect(accepted).not.toHaveBeenCalled(); expect(contact().owner_id).toBeNull()
  })
  it("transferência manual pelo dono mantém a carteira", async () => {
    contact().owner_id = "agent"; conv().assigned_to = "agent"
    const result = await chat.transferConversation("c", { mode: "agent", agentId: "other" })
    expect(result).not.toHaveProperty("error"); expect(conv().assigned_to).toBe("other")
    expect(contact().owner_id).toBe("agent")
  })
  it("mudança concorrente na escrita impede envio e vínculo", async () => {
    db.beforeWrite = (table) => { if (table === "chat_conversations") { conv().assigned_to = "other"; conv().updated_at = "changed" } }
    await expect(chat.sendMessage("c", "Olá")).rejects.toThrow("mudou")
    expect(accepted).not.toHaveBeenCalled(); expect(contact().owner_id).toBeNull()
  })
  it.each([true, false])("cotação só carimba com aceite do provider: %s", async success => {
    db.tables.commercial_documents = [{ id: "doc", tenant_id: "t", deal_id: "deal", contact_id: "contact", pdf_path: "t/doc.pdf", kind: "quote", status: "ready" }]
    db.tables.tenant_deals = [{ id: "deal", tenant_id: "t", contact_id: "contact", assigned_to: "agent" }]
    if (!success) accepted.mockRejectedValueOnce(new Error("rejected"))
    const result = await sendQuoteInChat("doc", "Cotação")
    expect(contact().owner_id).toBe(success ? "agent" : null)
    expect(result).toHaveProperty(success ? "ok" : "error")
    expect(db.tables.chat_messages[0].status).toBe(success ? "sent" : "failed")
  })
  it("tenant diferente não toma conversa nem cria vínculo", async () => {
    await expect(prepareHumanReply("other-tenant", "c", "agent", null, scope)).rejects.toThrow()
    expect(db.writes).toHaveLength(0)
  })
})

describe("destino humano e Studio", () => {
  it.each(["carteira", "pool"])("padrão prefere dono elegível independente de %s", async binding => {
    contact().owner_id = "owner"; db.tables.tenant_config[0].handoff_binding = binding
    await routeToHumanDefault("t", "c", "no_match")
    expect(conv().assigned_to).toBe("owner"); expect(conv().ai_handling).toBe(false)
  })
  it.each(["inactive", "number", "missing"])("dono %s cai na fila e conserva carteira", async kind => {
    contact().owner_id = "owner"
    const owner = db.tables.tenant_users.find(r => r.user_id === "owner")!
    if (kind === "inactive") owner.active = false
    if (kind === "number") owner.instance_ids = ["other-number"]
    if (kind === "missing") db.tables.tenant_users = []
    await routeToHumanDefault("t", "c", "no_match")
    expect(conv().assigned_to).toBeNull(); expect(conv().ai_handling).toBe(false); expect(contact().owner_id).toBe("owner")
  })
  it("entrega explícita à fila não é desfeita por backup antigo", async () => {
    contact().owner_id = "owner"; conv().metadata = { ai_routed: { via: "studio_transfer" }, reopen_owner: "owner" }
    await routeToHumanDefault("t", "c", "end")
    expect(conv().assigned_to).toBeNull(); expect(db.writes).toHaveLength(0)
  })
  it("fim com atendente atribuído devolve controle preservando-o", async () => {
    conv().assigned_to = "agent"
    await routeToHumanDefault("t", "c", "end")
    expect(conv().ai_handling).toBe(false); expect(conv().assigned_to).toBe("agent")
  })
  it("default perde corrida para tomada humana", async () => {
    contact().owner_id = "owner"
    db.beforeWrite = () => { conv().assigned_to = "agent"; conv().updated_at = "changed" }
    await routeToHumanDefault("t", "c", "no_match")
    expect(conv().assigned_to).toBe("agent"); expect(events).toHaveLength(0)
  })
  it("execução antiga não encerra nem envia no novo ciclo", async () => {
    const stale = ctx(); conv().metadata.attendance_cycle = "new"
    await expect(assertStudioControl(stale)).rejects.toThrow("controle")
    await routeToHumanDefault("t", "c", "old_end", stale.conversationMetadata)
    expect(db.writes).toHaveLength(0)
  })
  it("bot não fala depois da tomada humana", async () => {
    const stale = ctx(); await prepareHumanReply("t", "c", "agent", null, scope)
    await expect(sendBotText(stale, "Resposta antiga")).rejects.toThrow("controle")
    expect(accepted).not.toHaveBeenCalled(); expect(conv().ai_handling).toBe(false)
  })
  it("disparo explícito adquire controle e fim devolve para o atendente", async () => {
    conv().assigned_to = "agent"; conv().ai_handling = false; conv().metadata.ai_routed = { via: "manual_assign" }
    const context = ctx()
    await beginStudioControl(context)
    expect(conv().ai_handling).toBe(true); expect(conv().metadata.ai_routed).toBeUndefined()
    await assertStudioControl(context)
    await routeToHumanDefault("t", "c", "end", context.conversationMetadata)
    expect(conv().assigned_to).toBe("agent"); expect(conv().ai_handling).toBe(false)
  })
  it("transfer iniciada depois da tomada humana não a sobrescreve", async () => {
    const stale = ctx(); await prepareHumanReply("t", "c", "agent", null, scope)
    expect((await transferCapability.run(stale, { target: "pool", byAI: false })).ok).toBe(false)
    expect(conv().assigned_to).toBe("agent")
  })
  it.each(["owner", "pool", "department", "agent"])("transfer Studio %s muda somente atendimento", async target => {
    contact().owner_id = "owner"
    const r = await transferCapability.run(ctx(), { target, department: "Financeiro", agent_id: "other", byAI: false })
    expect(r.ok).toBe(true); expect(contact().owner_id).toBe("owner")
    expect(conv().assigned_to).toBe(target === "owner" ? "owner" : target === "agent" ? "other" : null)
    await routeToHumanDefault("t", "c", "end")
    expect(conv().assigned_to).toBe(target === "owner" ? "owner" : target === "agent" ? "other" : null)
  })
})
