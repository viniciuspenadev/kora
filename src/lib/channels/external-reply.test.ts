import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

vi.mock("server-only", () => ({}))
const db = new MemoryDb()
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
const reopen = vi.fn()
const routeHuman = vi.fn()
vi.mock("@/lib/conversation-dedup", () => ({ findOrReopenConversation: (...args: unknown[]) => reopen(...args) }))
vi.mock("@/lib/atendimento/human-routing", () => ({ routeToHumanDefault: (...args: unknown[]) => routeHuman(...args) }))
vi.mock("@/lib/llm/active", () => ({ tenantAiActive: async () => true }))
vi.mock("@/lib/ai-v2/dispatch", () => ({ channelDispatchesAI: () => true }))
const { applyExternalReply, evolutionSentAt } = await import("./external-reply")
const { createInboundConversation } = await import("./inbound-conversation")
const { bumpConversationInbound } = await import("./inbound-bump")

const received = "2026-09-12T14:00:00.000Z"
const sent = "2026-09-12T14:02:00.000Z"
const now = "2026-09-12T14:05:00.000Z"
const input = { tenantId: "t", instanceId: "number-a", messageId: "m" }
const conv = () => db.tables.chat_conversations[0]
const msg = () => db.tables.chat_messages[0]
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(now)); vi.clearAllMocks()
  db.reset({
    chat_messages: [{ id: "m", tenant_id: "t", conversation_id: "c", sender_type: "agent", sender_id: null,
      content_type: "text", content: "Sim, podemos seguir.", status: "sent", is_private_note: false,
      metadata: { via_celular: true, whatsapp_sent_at: sent } }],
    chat_conversations: [{ id: "c", tenant_id: "t", contact_id: "contact", instance_id: "number-a", channel: "whatsapp",
      status: "open", archived_at: null, assigned_to: "ana", department_id: "sales", stage_id: "stage", pipeline_id: "pipeline",
      updated_at: received, last_message_at: received, last_inbound_at: received, last_message_dir: "in",
      flagged_pending: true, unread_count: 2, metadata: { keep: true }, follow_up_at: now }],
    chat_contacts: [{ id: "contact", tenant_id: "t", owner_id: "crm-owner", attendance_owner_id: "return-owner" }],
    tenant_config: [],
  })
})
afterEach(() => vi.useRealTimers())

describe("resposta externa aceita", () => {
  it("encerra o sinal de espera sem assumir autoria ou mudar posse/follow-up/leitura", async () => {
    const before = structuredClone(conv())
    expect(await applyExternalReply(input)).toBe(true)
    expect(conv()).toEqual({ ...before, last_message_at: sent, last_message_preview: "Sim, podemos seguir.",
      last_message_dir: "out_phone", flagged_pending: false, updated_at: now })
    expect(msg().sender_id).toBeNull()
    expect(db.tables.chat_contacts[0]).toMatchObject({ owner_id: "crm-owner", attendance_owner_id: "return-owner" })
  })
  it.each(["sent", "delivered", "read"])("aceita status %s", async status => {
    msg().status = status
    expect(await applyExternalReply(input)).toBe(true)
  })
  it.each(["image", "audio", "video", "document", "sticker", "location", "contact", "poll", "interactive", "album"])("aceita resposta de mídia %s sem legenda", async type => {
    msg().content_type = type; msg().content = null
    expect(await applyExternalReply(input)).toBe(true)
  })
  it.each(["resolved", "snoozed", "pending"])("preserva estado %s e arquivamento", async status => {
    conv().status = status; conv().archived_at = received
    await applyExternalReply(input)
    expect(conv()).toMatchObject({ status, archived_at: received, assigned_to: "ana" })
  })
  it("não encerra um novo sinal de pendência ao repetir a mesma mensagem", async () => {
    await applyExternalReply(input)
    conv().flagged_pending = true
    expect(await applyExternalReply(input)).toBe(false)
    expect(conv().flagged_pending).toBe(true)
  })
  it("reentrega recupera falha de leitura/projeção após mensagem salva", async () => {
    db.errors.chat_conversations = "unavailable"
    await expect(applyExternalReply(input)).rejects.toThrow("Falha ao ler atendimento")
    delete db.errors.chat_conversations
    expect(await applyExternalReply(input)).toBe(true)
    expect(db.tables.chat_messages).toHaveLength(1)
  })
})

describe("não apagar espera indevidamente", () => {
  it.each(["pending", "failed"])("ignora envio %s", async status => {
    msg().status = status; expect(await applyExternalReply(input)).toBe(false)
    expect(db.writes).toHaveLength(0)
  })
  it.each(["reaction", "deleted", "unsupported"])("ignora evento %s", async type => {
    msg().content_type = type; expect(await applyExternalReply(input)).toBe(false)
  })
  it.each([
    { metadata: { via_celular: true } },
    { metadata: { via_celular: true, whatsapp_sent_at: "invalid" } },
    { metadata: { via_celular: true, whatsapp_sent_at: "2026-10-01T00:00:00Z" } },
    { metadata: { via_celular: true, whatsapp_sent_at: sent, edited: true } },
    { metadata: { whatsapp_sent_at: sent } },
    { sender_type: "contact" }, { sender_type: "system" }, { is_private_note: true }, { content: "  " },
  ])("ignora mensagem não elegível %j", async patch => {
    Object.assign(msg(), patch); expect(await applyExternalReply(input)).toBe(false)
    expect(db.writes).toHaveLength(0)
  })
  it("outro tenant não encontra nem altera a mensagem", async () => {
    expect(await applyExternalReply({ ...input, tenantId: "other" })).toBe(false)
    expect(db.writes).toHaveLength(0)
  })
  it.each([{ instance_id: "number-b" }, { channel: "site" }, { tenant_id: "other" }])("exige o mesmo fio %j", async patch => {
    Object.assign(conv(), patch); expect(await applyExternalReply(input)).toBe(false)
    expect(db.writes).toHaveLength(0)
  })
  it("resposta mais velha que nova entrada não mexe no preview ou pendência", async () => {
    conv().last_message_at = now; conv().last_inbound_at = now
    const before = structuredClone(conv())
    expect(await applyExternalReply(input)).toBe(false); expect(conv()).toEqual(before)
  })
  it("protege também o carimbo inbound quando o preview tem data antiga", async () => {
    conv().last_inbound_at = now
    expect(await applyExternalReply(input)).toBe(false)
  })
  it("uma entrada concorrente vence a projeção da resposta mais velha", async () => {
    let once = true
    db.beforeWrite = table => {
      if (table === "chat_conversations" && once) { once = false; Object.assign(conv(), { last_message_at: now, last_inbound_at: now, updated_at: now, unread_count: 3 }) }
    }
    expect(await applyExternalReply(input)).toBe(false)
    expect(conv()).toMatchObject({ last_message_at: now, last_message_dir: "in", flagged_pending: true, unread_count: 3 })
  })
  it("respostas simultâneas convergem para a mais nova", async () => {
    db.tables.chat_messages.push({ ...structuredClone(msg()), id: "new", content: "Nova resposta", metadata: { via_celular: true, whatsapp_sent_at: "2026-09-12T14:03:00.000Z" } })
    await Promise.all([applyExternalReply(input), applyExternalReply({ ...input, messageId: "new" })])
    expect(conv()).toMatchObject({ last_message_at: "2026-09-12T14:03:00.000Z", last_message_preview: "Nova resposta" })
  })
})

describe("timestamp do provedor", () => {
  it("aceita segundos numéricos e texto numérico", () => {
    const seconds = Date.parse(sent) / 1000
    expect(evolutionSentAt(seconds)).toBe(sent)
    expect(evolutionSentAt(String(seconds))).toBe(sent)
  })
  it.each([null, undefined, 0, -1, NaN, Infinity, {}, "", "abc", 1.1, 9999999999999])("rejeita %s sem substituir por agora", raw => {
    expect(evolutionSentAt(raw)).toBeNull()
  })
})

describe("resolução da conversa externa", () => {
  it("prefere o atendimento ativo mesmo havendo resolvido atualizado depois", async () => {
    db.tables.chat_conversations.unshift({ ...structuredClone(conv()), id: "old", status: "resolved", updated_at: now })
    expect(await createInboundConversation({ tenantId: "t", contactId: "contact", instanceId: "number-a", origin: "external_reply" })).toMatchObject({ id: "c" })
  })
  it.each(["open", "pending", "snoozed", "resolved"])("reusa %s sem reabrir, desarquivar ou mudar atendente", async status => {
    conv().status = status; conv().archived_at = received
    const before = structuredClone(conv())
    expect(await createInboundConversation({ tenantId: "t", contactId: "contact", instanceId: "number-a", origin: "external_reply" })).toMatchObject({ id: "c", reopened: false, isNew: false })
    expect(conv()).toEqual(before); expect(reopen).not.toHaveBeenCalled(); expect(routeHuman).not.toHaveBeenCalled()
  })
  it("seleciona somente conversa do mesmo número e canal", async () => {
    db.tables.chat_conversations.unshift({ ...structuredClone(conv()), id: "wrong", instance_id: "number-b" })
    const result = await createInboundConversation({ tenantId: "t", contactId: "contact", instanceId: "number-a", origin: "external_reply" })
    expect(result.id).toBe("c")
  })
  it("nascimento externo não atribui agente nem ativa Studio", async () => {
    db.tables.chat_conversations = []
    await createInboundConversation({ tenantId: "t", contactId: "contact", instanceId: "number-a", origin: "external_reply" })
    expect(conv()).toMatchObject({ assigned_to: null, ai_handling: false, unread_count: 0 })
    expect(reopen).not.toHaveBeenCalled(); expect(routeHuman).not.toHaveBeenCalled()
  })
})

describe("ordem de chegada diferente da ordem de envio no WhatsApp", () => {
  it("entrada recebida com atraso ainda permite resposta enviada depois dela", async () => {
    await bumpConversationInbound({ tenantId: "t", conversationId: "c", preview: "Pergunta", occurredAt: received, lastInboundAt: received })
    expect(conv().last_message_at).toBe(received)
    expect(await applyExternalReply(input)).toBe(true)
    expect(conv()).toMatchObject({ last_message_dir: "out_phone", last_message_at: sent })
  })
  it("entrada antiga chegando depois da resposta preserva o preview mais recente", async () => {
    await applyExternalReply(input)
    await bumpConversationInbound({ tenantId: "t", conversationId: "c", preview: "Pergunta atrasada", occurredAt: received, lastInboundAt: received })
    expect(conv()).toMatchObject({ last_message_dir: "out_phone", last_message_at: sent, unread_count: 3 })
  })
  it("nova pergunta depois da resposta volta a aparecer como entrada", async () => {
    await applyExternalReply(input)
    await bumpConversationInbound({ tenantId: "t", conversationId: "c", preview: "Outra pergunta", occurredAt: now, lastInboundAt: now })
    expect(conv()).toMatchObject({ last_message_dir: "in", last_message_at: now, last_inbound_at: now })
    expect(await applyExternalReply(input)).toBe(false)
  })
  it("entrada atrasada não recua a âncora de outra entrada mais recente", async () => {
    conv().last_inbound_at = sent; conv().last_message_at = sent
    await bumpConversationInbound({ tenantId: "t", conversationId: "c", preview: "Antiga", occurredAt: received, lastInboundAt: received })
    expect(conv().last_inbound_at).toBe(sent)
  })
  it("em empate de segundos mantém a pergunta pendente por precaução", async () => {
    conv().last_message_at = sent; conv().last_inbound_at = sent
    expect(await applyExternalReply(input)).toBe(false)
    expect(conv().flagged_pending).toBe(true)
  })
})
