import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

vi.mock("server-only", () => ({}))
vi.mock("next/server", () => ({ after: vi.fn(), NextResponse: {} }))
const db = new MemoryDb()
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/lib/providers", () => ({ getProvider: () => { throw new Error("Provider access forbidden in isolated test") } }))
vi.mock("@/lib/automation/dispatch", () => ({ dispatchAutomations: vi.fn() }))
vi.mock("@/lib/automation/keyword-engine", () => ({ evaluateKeywordTriggers: vi.fn() }))
vi.mock("@/lib/agenda/interceptor", () => ({ handleAgendaReply: vi.fn() }))
vi.mock("@/lib/ai-v2/dispatch", () => ({ routeAutomationTurn: vi.fn(), channelDispatchesAI: () => false }))
vi.mock("@/lib/llm/context", () => ({ latestInboundAt: vi.fn() }))
vi.mock("@/lib/llm/transcribe", () => ({ transcribeStoredAudio: vi.fn() }))
vi.mock("@/lib/llm/active", () => ({ tenantAiActive: async () => false }))
vi.mock("@/lib/atendimento/unprocessed-inbound", () => ({ routeUnprocessedInbound: vi.fn() }))
vi.mock("@/lib/atendimento/human-routing", () => ({ routeToHumanDefault: vi.fn() }))
vi.mock("@/lib/conversation-dedup", () => ({ findOrReopenConversation: vi.fn() }))
vi.mock("@/lib/campaigns/engine", () => ({ handleCampaignInbound: vi.fn() }))
vi.mock("@/lib/contacts/identity", () => ({ resolveOrCreateContact: async () => ({ id: "contact" }) }))
vi.mock("@/lib/push/send", () => ({ notifyInboundMessage: vi.fn() }))
const { dispatchEvolutionEvent } = await import("./route")
const at = "2026-09-12T14:02:00.000Z"
const now = "2026-09-12T14:05:00.000Z"
const instance = { id: "number-a", tenant_id: "t", evolution_url: "https://test.invalid", evolution_key: "fake", instance_name: "fake" }
const payload = () => ({ key: { id: "wa-id", remoteJid: "5511999999999@s.whatsapp.net", fromMe: true }, messageTimestamp: Date.parse(at) / 1000, message: { conversation: "Resposta" } })
const dispatch = (data: unknown = payload()) => dispatchEvolutionEvent(instance, { event: "messages.upsert", data }, false)
const conv = () => db.tables.chat_conversations.find(row => row.id === "c")!
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(now)); vi.clearAllMocks()
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in isolated test") }))
  db.reset({ chat_messages: [], chat_contacts: [{ id: "contact", tenant_id: "t", whatsapp_id: payload().key.remoteJid, profile_pic_fetched_at: now }],
    chat_conversations: [{ id: "c", tenant_id: "t", contact_id: "contact", instance_id: "number-a", channel: "whatsapp", status: "open",
      updated_at: "2026-09-12T14:00:00.000Z", last_message_at: "2026-09-12T14:00:00.000Z", last_inbound_at: "2026-09-12T14:00:00.000Z",
      last_message_dir: "in", flagged_pending: true, unread_count: 2, assigned_to: "ana" }], whatsapp_instances: [instance] })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe("webhook Evolution: resposta externa persistida e refletida no Inbox", () => {
  it("persiste a origem, horário real e encerra pendência no mesmo fio", async () => {
    await dispatch()
    expect(db.tables.chat_messages).toHaveLength(1)
    expect(db.tables.chat_messages[0]).toMatchObject({ conversation_id: "c", sender_id: null, created_at: at, metadata: { via_celular: true, whatsapp_sent_at: at } })
    expect(conv()).toMatchObject({ last_message_dir: "out_phone", flagged_pending: false, assigned_to: "ana", unread_count: 2 })
  })
  it("reentrega não duplica mensagem nem apaga uma pendência criada depois", async () => {
    await dispatch(); conv().flagged_pending = true; await dispatch()
    expect(db.tables.chat_messages).toHaveLength(1)
    expect(conv().flagged_pending).toBe(true)
  })
  it("timestamp ausente fica no histórico sem encerrar a pendência", async () => {
    await dispatch({ ...payload(), messageTimestamp: undefined })
    expect(db.tables.chat_messages).toHaveLength(1)
    expect(conv()).toMatchObject({ last_message_dir: "in", flagged_pending: true })
  })
  it("mídia externa conta sem baixar arquivo quando gasto está bloqueado", async () => {
    await dispatch({ ...payload(), message: { audioMessage: { mimetype: "audio/ogg", ptt: true } } })
    expect(db.tables.chat_messages[0]).toMatchObject({ content_type: "audio", metadata: { media_skipped_reason: "billing" } })
    expect(conv().flagged_pending).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
  it("não altera outra conversa do contato em outro número", async () => {
    const other = { ...structuredClone(conv()), id: "other", instance_id: "number-b" }
    db.tables.chat_conversations.unshift(other)
    await dispatch()
    expect(other).toMatchObject({ flagged_pending: true })
    expect(conv().flagged_pending).toBe(false)
    expect(db.tables.chat_messages[0].conversation_id).toBe("c")
  })
  it("eco do app no mesmo segundo não gera mensagem externa duplicada", async () => {
    db.tables.chat_messages.push({ id: "local", tenant_id: "t", conversation_id: "c", sender_type: "agent", sender_id: "ana",
      is_private_note: false, status: "pending", content_type: "text", content: "Resposta", whatsapp_msg_id: null, created_at: "2026-09-12T14:02:00.850Z" })
    await dispatch()
    expect(db.tables.chat_messages).toHaveLength(1)
    expect(db.tables.chat_messages[0]).toMatchObject({ id: "local", whatsapp_msg_id: "wa-id", sender_id: "ana", status: "sent" })
  })
  it.each([{ is_private_note: true }, { content: "Outro texto" }, { conversation_id: "other" }, { status: "failed" }])("não confunde mensagem pendente incompatível com eco: %j", async patch => {
    db.tables.chat_messages.push({ id: "local", tenant_id: "t", conversation_id: "c", sender_type: "agent", sender_id: "ana",
      is_private_note: false, status: "pending", content_type: "text", content: "Resposta", whatsapp_msg_id: null, created_at: at, ...patch })
    await dispatch()
    expect(db.tables.chat_messages).toHaveLength(2)
    expect(db.tables.chat_messages[0].whatsapp_msg_id).toBeNull()
    expect(conv().flagged_pending).toBe(false)
  })
})
