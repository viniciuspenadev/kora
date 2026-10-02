import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

vi.mock("server-only", () => ({}))
const db = new MemoryDb()
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
const sendText = vi.fn(async () => ({ messageId: "wamid-1", recipientJid: "554798124471@s.whatsapp.net" }))
vi.mock("@/lib/providers", () => ({ getProvider: () => ({ sendText }) }))
const openConversation = vi.fn(async () => ({ id: "wa", status: "open", unread_count: 0, isNew: true, reopened: false }))
vi.mock("@/lib/channels/inbound-conversation", () => ({ createInboundConversation: openConversation }))
vi.mock("@/lib/contacts/identity", () => ({ adoptRecipientJid: async () => {} }))
const notify = vi.fn(async () => {})
vi.mock("@/lib/notifications", () => ({ createNotification: notify }))
const note = vi.fn(async () => {})
vi.mock("@/lib/ai-v2/outbound", () => ({ noteFlowSkip: note }))

const { runOutreach } = await import("./outreach")

const ctx = () => ({
  tenantId: "t", conversationId: "site-c", channel: "site",
  contact: { id: "contact", custom_name: "Marina" }, conversationMetadata: {}, departments: [], instance: {},
} as never)
const input = { channel: "baileys" as const, phoneRaw: "(47) 99812-4471", text: "Oi, Marina!", origin: "site" as const, flowId: "f" }

/** O banco de verdade: reserva vira linha `claimed`; recusa vira linha `throttled`. */
function guardAnswers(answer: { allowed: boolean; reason?: string; first?: boolean }) {
  db.rpcs.claim_outreach = (a) => {
    const id = `log-${db.tables.outreach_log.length + 1}`
    db.tables.outreach_log.push({ id, tenant_id: a.p_tenant_id, phone_key: a.p_phone_key, origin: a.p_origin,
      outcome: answer.allowed ? "claimed" : "throttled", reason: answer.reason ?? null })
    return { data: [{ log_id: id, allowed: answer.allowed, reason: answer.reason ?? null, first_cap_hit: answer.first ?? false }], error: null }
  }
}

beforeEach(() => {
  db.reset({
    tenant_config: [{ tenant_id: "t", default_country: "BR" }],
    whatsapp_instances: [{ id: "i1", tenant_id: "t", provider: "baileys" }],
    chat_contacts: [{ id: "contact", tenant_id: "t", phone_number: null, whatsapp_id: null, consent_at: null }],
    chat_conversations: [], chat_messages: [], outreach_log: [],
    tenant_users: [{ tenant_id: "t", user_id: "dono", role: "owner", active: true }],
  })
  sendText.mockClear(); openConversation.mockClear(); notify.mockClear(); note.mockClear()
})

describe("Disparar no WhatsApp — trava e atendimento", () => {
  it("envia, acerta o livro como enviado e devolve o fio WhatsApp", async () => {
    guardAnswers({ allowed: true })
    const out = await runOutreach(ctx(), input)
    expect(out).toEqual({ branch: "sent", conversationId: "wa" })
    expect(sendText).toHaveBeenCalledTimes(1)
    expect(db.tables.outreach_log[0]).toMatchObject({ outcome: "sent", conversation_id: "wa", phone_key: "554798124471", origin: "site" })
    expect(db.tables.chat_messages[0]).toMatchObject({ conversation_id: "wa", content: "Oi, Marina!" })
  })

  it("número já chamado nas últimas 24 h: nada sai, nenhuma conversa abre, a origem ganha nota", async () => {
    guardAnswers({ allowed: false, reason: "phone_window" })
    const out = await runOutreach(ctx(), input)
    expect(out).toEqual({ branch: "blocked", reason: "phone_window" })
    expect(sendText).not.toHaveBeenCalled()
    expect(openConversation).not.toHaveBeenCalled()
    expect(note).toHaveBeenCalledTimes(1)
    expect((note.mock.calls[0] as unknown[])[1]).toMatch(/últimas 24 h/)
    expect(notify).not.toHaveBeenCalled()
  })

  it("teto da empresa: a 1ª recusa da hora avisa o dono; as seguintes não", async () => {
    guardAnswers({ allowed: false, reason: "tenant_hourly_cap", first: true })
    await runOutreach(ctx(), input)
    expect(notify).toHaveBeenCalledTimes(1)
    guardAnswers({ allowed: false, reason: "tenant_hourly_cap", first: false })
    await runOutreach(ctx(), input)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(sendText).not.toHaveBeenCalled()
  })

  it("FAIL-CLOSED: trava fora do ar = não envia", async () => {
    const out = await runOutreach(ctx(), input)   // sem handler da RPC
    expect(out).toEqual({ branch: "blocked", reason: "guard_unavailable" })
    expect(sendText).not.toHaveBeenCalled()
    expect(openConversation).not.toHaveBeenCalled()
  })

  it("conversa com atendente: não manda por cima, avisa quem atende e anota nos dois fios", async () => {
    guardAnswers({ allowed: true })
    db.tables.chat_conversations.push({ id: "wa-old", tenant_id: "t", contact_id: "contact", instance_id: "i1",
      channel: "whatsapp", status: "open", assigned_to: "ana", ai_handling: false })
    const out = await runOutreach(ctx(), input)
    expect(out).toEqual({ branch: "blocked", reason: "human_attendance" })
    expect(sendText).not.toHaveBeenCalled()
    expect(db.tables.outreach_log).toHaveLength(0)   // nem reservou vaga
    const notedIn = note.mock.calls.map((c) => ((c as unknown[])[0] as { conversationId: string }).conversationId).sort()
    expect(notedIn).toEqual(["site-c", "wa-old"])
    expect(notify).toHaveBeenCalledTimes(1)
    expect((notify.mock.calls[0] as unknown as [{ recipientId: string; payload: { conversation_id: string } }])[0])
      .toMatchObject({ recipientId: "ana", payload: { conversation_id: "wa-old" } })
  })

  it("dono da carteira com o Studio na frente NÃO é atendimento: segue o disparo", async () => {
    guardAnswers({ allowed: true })
    db.tables.chat_conversations.push({ id: "wa-old", tenant_id: "t", contact_id: "contact", instance_id: "i1",
      channel: "whatsapp", status: "open", assigned_to: "ana", ai_handling: true })
    expect((await runOutreach(ctx(), input)).branch).toBe("sent")
    expect(sendText).toHaveBeenCalledTimes(1)
  })

  it("conversa concluída com atendente não segura o disparo (o cliente voltou)", async () => {
    guardAnswers({ allowed: true })
    db.tables.chat_conversations.push({ id: "wa-old", tenant_id: "t", contact_id: "contact", instance_id: "i1",
      channel: "whatsapp", status: "resolved", assigned_to: "ana", ai_handling: false })
    expect((await runOutreach(ctx(), input)).branch).toBe("sent")
  })

  it("falha no envio: sem WhatsApp, e o livro marca falha (não fecha a janela do número)", async () => {
    guardAnswers({ allowed: true })
    sendText.mockRejectedValueOnce(new Error("not on whatsapp"))
    const out = await runOutreach(ctx(), input)
    expect(out).toEqual({ branch: "no_whatsapp", reason: "send_failed" })
    expect(db.tables.outreach_log[0]).toMatchObject({ outcome: "failed", reason: "send_failed" })
  })

  it("número implausível nem pede vaga", async () => {
    const spy = vi.fn()
    db.rpcs.claim_outreach = spy
    expect(await runOutreach(ctx(), { ...input, phoneRaw: "123" })).toEqual({ branch: "no_whatsapp", reason: "invalid_phone" })
    expect(spy).not.toHaveBeenCalled()
  })

  it("simulador não transmite nem reserva", async () => {
    const spy = vi.fn()
    db.rpcs.claim_outreach = spy
    expect(await runOutreach({ ...(ctx() as object), dryRun: true } as never, input)).toEqual({ branch: "sent" })
    expect(spy).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
  })
})
