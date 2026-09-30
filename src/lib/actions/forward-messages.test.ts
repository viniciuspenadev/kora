import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

// Encaminhar: SÓ ENTREGA (decisão do dono 30/09/2026) — nada de assumir a conversa de destino.
vi.mock("server-only", () => ({}))
const T = "0d907fdd-f4eb-435b-ae9d-d20d4e3f4fc5", OTHER_T = "11111111-1111-4111-8111-111111111111"
const SRC = "20000000-0000-4000-8000-000000000001"
const BAILEYS = "20000000-0000-4000-8000-000000000002", META = "20000000-0000-4000-8000-000000000003"
const META_CLOSED = "20000000-0000-4000-8000-000000000004", HIDDEN = "20000000-0000-4000-8000-000000000005"
const FOREIGN = "20000000-0000-4000-8000-000000000006", ARCHIVED = "20000000-0000-4000-8000-000000000007"
const CONTACT_A = "30000000-0000-4000-8000-00000000000a"
const id = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const [TEXT, PHOTO, NOTE, PLACE, CARD, VOICE, ELSEWHERE, OLD_FILE, FOREIGN_FILE] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(id)

const db = new MemoryDb()
const user = { id: "agent-ana", tenantId: T, role: "agent" }
const hidden = new Set<string>()
const calls: string[] = []
const provider = (name: string) => ({
  providerName: name,
  sendText: vi.fn(async (_p: string, text: string) => { calls.push(`${name}:text:${text}`); return { messageId: "wa", recipientJid: "5511999990000@s.whatsapp.net" } }),
  sendMedia: vi.fn(async (_p: string, url: string, type: string, caption?: string) => { calls.push(`${name}:${type}:${caption ?? ""}`); return { messageId: "wa", url } }),
  sendVoiceNote: vi.fn(async () => { calls.push(`${name}:voice`); return { messageId: "wa" } }),
  sendLocation: vi.fn(async () => { calls.push(`${name}:location`); return { messageId: "wa" } }),
  sendContacts: vi.fn(async () => { calls.push(`${name}:contact`); return { messageId: "wa" } }),
  sendSticker: vi.fn(async () => { calls.push(`${name}:sticker`); return { messageId: "wa" } }),
})
const providers = { baileys: provider("baileys"), meta_cloud: provider("meta_cloud") }
const claim = { prepareHumanReply: vi.fn(), claimAfterAcceptedReply: vi.fn() }
const transcode = vi.fn()
vi.mock("@/auth", () => ({ auth: async () => ({ user }) }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/lib/visibility", () => ({
  getViewerScope: async () => ({ tenantId: user.tenantId, userId: user.id, isAdmin: false }),
  canViewConversation: (_scope: unknown, conv: { id?: string }) => !hidden.has(conv.id ?? ""),
}))
vi.mock("@/lib/atendimento/attendance-claim", () => claim)
vi.mock("@/lib/providers", () => ({ getProvider: (row: { provider: keyof typeof providers }) => providers[row.provider] }))
vi.mock("@/lib/auth/tenant-serviceable", () => ({ assertAtendimentoLiberado: vi.fn(), checkTenantStatus: vi.fn(), atendimentoBloqueado: () => false }))
vi.mock("@/lib/contacts/identity", () => ({ adoptRecipientJid: vi.fn() }))
vi.mock("@/lib/media/transcode", () => ({ transcodeForMeta: transcode }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
const { forwardMessages } = await import("./chat")

const stored = new Map<string, Uint8Array>()
const bucket = {
  copy: vi.fn(async (from: string, to: string) => stored.has(from) ? (stored.set(to, stored.get(from)!), { data: { path: to }, error: null }) : { data: null, error: { message: "not found" } }),
  createSignedUrl: vi.fn(async (path: string) => ({ data: { signedUrl: `https://signed.test/${path}` }, error: null })),
  download: vi.fn(async (path: string) => ({ data: new Blob([new Uint8Array(stored.get(path)!)]), error: null })),
  upload: vi.fn(async (path: string, buf: Uint8Array) => { stored.set(path, buf); return { error: null } }),
  remove: vi.fn(async (paths: string[]) => { paths.forEach((p) => stored.delete(p)); return { data: paths.map((name) => ({ name })), error: null } }),
}
db.storage = { from: () => bucket } as never

const signature = { version: 1, name: "Carlos", prefix: "*Carlos*\n\n" }
const at = (s: number) => `2026-09-30T18:00:${String(s).padStart(2, "0")}.000Z`
const message = (n: string, s: number, over: Record<string, unknown>) => ({
  id: n, conversation_id: SRC, tenant_id: T, sender_type: "contact", sender_id: null, content_type: "text", content: null,
  media_url: null, media_mime_type: null, media_file_name: null, status: "delivered", is_private_note: false, metadata: {},
  deleted_at: null, created_at: at(s), ...over,
})
const conv = (cid: string, over: Record<string, unknown> = {}) => ({
  id: cid, tenant_id: T, is_group: false, contact_id: `contact-${cid.slice(-1)}`, instance_id: "num-baileys", assigned_to: null, participants: [],
  department_id: null, channel: "whatsapp", last_inbound_at: new Date().toISOString(), status: "open", ai_handling: true, flagged_pending: true,
  whatsapp_instances: { provider: "baileys" }, chat_contacts: { phone_number: `55119999${cid.slice(-4)}`, bsuid: null }, ...over,
})

beforeEach(() => {
  vi.clearAllMocks(); calls.length = 0; hidden.clear(); stored.clear()
  for (const path of [`${T}/${SRC}/foto.jpg`, `${T}/${SRC}/voz.webm`, `${OTHER_T}/x/segredo.pdf`]) stored.set(path, Uint8Array.from([1, 2, 3]))
  transcode.mockResolvedValue({ buffer: Buffer.from([9, 9]), mime: "audio/ogg", ext: "ogg" })
  db.reset({
    tenant_config: [{ tenant_id: T, agent_signature: { enabled: true, departments: {}, agents: {} } }],
    profiles: [{ id: "agent-ana", full_name: "Ana" }],
    whatsapp_instances: [{ id: "num-baileys", tenant_id: T, provider: "baileys" }, { id: "num-meta", tenant_id: T, provider: "meta_cloud" }],
    chat_conversations: [
      conv(SRC, { contact_id: CONTACT_A }),
      conv(BAILEYS),
      conv(META, { instance_id: "num-meta", channel: "meta_cloud", whatsapp_instances: { provider: "meta_cloud" } }),
      conv(META_CLOSED, { instance_id: "num-meta", channel: "meta_cloud", whatsapp_instances: { provider: "meta_cloud" }, last_inbound_at: "2026-09-01T00:00:00Z" }),
      conv(HIDDEN),
      conv(FOREIGN, { tenant_id: OTHER_T }),
      conv(ARCHIVED, { archived_at: "2026-09-10T12:00:00.000Z", status: "resolved" }),
    ],
    chat_messages: [
      message(TEXT, 1, { sender_type: "agent", sender_id: "agent-carlos", content: "*Carlos*\n\nPromoção de outubro", status: "read", metadata: { agent_signature: signature } }),
      message(PHOTO, 2, { content_type: "image", content: "olha a infiltração", media_mime_type: "image/jpeg", media_file_name: "foto.jpg", metadata: { storage_path: `${T}/${SRC}/foto.jpg` } }),
      message(NOTE, 3, { sender_type: "agent", content: "cliente chato", is_private_note: true }),
      message(PLACE, 4, { content_type: "location", content: "-23.5505,-46.6333", metadata: { location_name: "Obra", location_address: "Rua A, 10" } }),
      message(CARD, 5, { content_type: "contact", content: "Pedreiro", metadata: { contacts: [{ name: "Pedreiro", vcard: "BEGIN:VCARD\nTEL;type=CELL:+55 11 98888-7777\nEND:VCARD" }] } }),
      message(VOICE, 6, { content_type: "audio", media_mime_type: "audio/webm", media_file_name: "voz.webm", metadata: { storage_path: `${T}/${SRC}/voz.webm`, is_voice_note: true } }),
      message(ELSEWHERE, 7, { conversation_id: BAILEYS, content: "de outra conversa" }),
      message(OLD_FILE, 8, { content_type: "document", media_url: "https://antigo.example/a.pdf", media_file_name: "a.pdf" }),
      message(FOREIGN_FILE, 9, { content_type: "document", media_file_name: "segredo.pdf", metadata: { storage_path: `${OTHER_T}/x/segredo.pdf` } }),
    ],
  })
})
const forwarded = (target: string) => db.tables.chat_messages.filter((m) => m.conversation_id === target && m.metadata?.forwarded)

describe("encaminhar SÓ entrega", () => {
  it("texto, foto, localização e contato chegam em ordem, com a assinatura de quem encaminhou", async () => {
    const r = await forwardMessages({ sourceConversationId: SRC, messageIds: [CARD, TEXT, PLACE, PHOTO], targetConversationIds: [BAILEYS] })
    expect(r).toEqual({ ok: true, skipped: 0, results: [{ conversationId: BAILEYS, sent: 4, failed: 0 }] })
    expect(calls).toEqual(["baileys:text:*Ana*\n\nPromoção de outubro", "baileys:image:*Ana*\n\nolha a infiltração", "baileys:location", "baileys:contact"])
    const rows = forwarded(BAILEYS)
    expect(rows.map((m) => [m.content_type, m.status])).toEqual([["text", "sent"], ["image", "sent"], ["location", "sent"], ["contact", "sent"]])
    // Registro: quem, de onde, de quem era o conteúdo.
    expect(rows[1].metadata.forwarded_from).toMatchObject({ conversation_id: SRC, message_id: PHOTO, contact_id: CONTACT_A, sender_type: "contact", by: "agent-ana" })
    // O arquivo foi COPIADO para a conversa de destino; o original continua.
    expect(rows[1].metadata.storage_path).toMatch(new RegExp(`^${T}/${BAILEYS}/f_\\d+_[a-f0-9]{8}_foto\\.jpg$`))
    expect(stored.has(rows[1].metadata.storage_path)).toBe(true)
    expect(stored.has(`${T}/${SRC}/foto.jpg`)).toBe(true)
  })

  it("a conversa de destino NÃO muda: responsável, IA, pendência e status ficam como estavam", async () => {
    await forwardMessages({ sourceConversationId: SRC, messageIds: [TEXT], targetConversationIds: [BAILEYS] })
    const target = db.tables.chat_conversations.find((c) => c.id === BAILEYS)!
    expect(target).toMatchObject({ assigned_to: null, ai_handling: true, flagged_pending: true, status: "open", last_message_dir: "out" })
    expect(target.last_message_preview).toBe("*Ana*\n\nPromoção de outubro")
    expect(claim.prepareHumanReply).not.toHaveBeenCalled()
    expect(claim.claimAfterAcceptedReply).not.toHaveBeenCalled()
  })

  it("Chat interno, mensagem de outra conversa, arquivo antigo e arquivo de outro cliente não vão", async () => {
    const r = await forwardMessages({ sourceConversationId: SRC, messageIds: [NOTE, TEXT, ELSEWHERE, OLD_FILE, FOREIGN_FILE], targetConversationIds: [BAILEYS] })
    expect(r).toMatchObject({ ok: true, skipped: 4, results: [{ sent: 1 }] })
    expect(calls).toEqual(["baileys:text:*Ana*\n\nPromoção de outubro"])
    expect(bucket.copy).not.toHaveBeenCalled()
    expect(await forwardMessages({ sourceConversationId: SRC, messageIds: [NOTE], targetConversationIds: [BAILEYS] }))
      .toEqual({ error: "Nenhuma das mensagens selecionadas pode ser encaminhada." })
  })

  it("cada destino é conferido: janela fechada, conversa que ele não vê e de outro cliente ficam de fora", async () => {
    hidden.add(HIDDEN)
    const r = await forwardMessages({ sourceConversationId: SRC, messageIds: [TEXT], targetConversationIds: [META, META_CLOSED, HIDDEN, FOREIGN] })
    if (!("ok" in r)) throw new Error(r.error)
    expect(r.results).toEqual([
      { conversationId: META, sent: 1, failed: 0 },
      { conversationId: META_CLOSED, sent: 0, failed: 0, error: expect.stringContaining("Janela") },
      { conversationId: HIDDEN, sent: 0, failed: 0, error: "Conversa não encontrada." },
      { conversationId: FOREIGN, sent: 0, failed: 0, error: "Conversa não encontrada." },
    ])
    expect(calls).toEqual(["meta_cloud:text:*Ana*\n\nPromoção de outubro"])
  })

  it("conversa arquivada recebe e CONTINUA arquivada (só entrega; o cliente respondendo desarquiva, como sempre)", async () => {
    const r = await forwardMessages({ sourceConversationId: SRC, messageIds: [TEXT], targetConversationIds: [ARCHIVED] })
    expect(r).toMatchObject({ ok: true, results: [{ conversationId: ARCHIVED, sent: 1, failed: 0 }] })
    expect(db.tables.chat_conversations.find((c) => c.id === ARCHIVED)).toMatchObject({ archived_at: "2026-09-10T12:00:00.000Z", status: "resolved", assigned_to: null })
    expect(forwarded(ARCHIVED)).toHaveLength(1)
  })

  it("sem ver a conversa de origem, nada sai", async () => {
    hidden.add(SRC)
    expect(await forwardMessages({ sourceConversationId: SRC, messageIds: [TEXT], targetConversationIds: [BAILEYS] })).toEqual({ error: "Conversa não encontrada." })
    expect(calls).toEqual([])
  })

  it("limites: até 5 conversas e 10 mensagens por vez", async () => {
    const six = [BAILEYS, META, META_CLOSED, HIDDEN, FOREIGN, id(99)]
    expect(await forwardMessages({ sourceConversationId: SRC, messageIds: [TEXT], targetConversationIds: six })).toMatchObject({ error: expect.stringContaining("até 5") })
    const eleven = Array.from({ length: 11 }, (_, i) => id(100 + i))
    expect(await forwardMessages({ sourceConversationId: SRC, messageIds: eleven, targetConversationIds: [BAILEYS] })).toMatchObject({ error: expect.stringContaining("até 10") })
    expect(await forwardMessages({ sourceConversationId: SRC, messageIds: [], targetConversationIds: [BAILEYS] })).toMatchObject({ error: expect.stringContaining("ao menos") })
  })

  it("se uma mensagem falhar, as outras seguem e a falha fica registrada", async () => {
    providers.baileys.sendLocation.mockRejectedValueOnce(new Error("instabilidade"))
    const r = await forwardMessages({ sourceConversationId: SRC, messageIds: [TEXT, PLACE, CARD], targetConversationIds: [BAILEYS] })
    expect(r).toMatchObject({ ok: true, results: [{ sent: 2, failed: 1 }] })
    expect(forwarded(BAILEYS).map((m) => [m.content_type, m.status])).toEqual([["text", "sent"], ["location", "failed"], ["contact", "sent"]])
  })

  it("nota de voz para o Oficial é convertida e continua nota de voz; a cópia intermediária não sobra", async () => {
    const r = await forwardMessages({ sourceConversationId: SRC, messageIds: [VOICE], targetConversationIds: [META] })
    expect(r).toMatchObject({ ok: true, results: [{ sent: 1, failed: 0 }] })
    expect(calls).toEqual(["meta_cloud:voice"])
    const row = forwarded(META)[0]
    expect(row).toMatchObject({ content_type: "audio", media_mime_type: "audio/ogg", media_file_name: "voz.ogg", metadata: { is_voice_note: true } })
    expect(row.metadata.storage_path).toMatch(/_tc\.ogg$/)
    expect([...stored.keys()].filter((p) => p.startsWith(`${T}/${META}/`))).toEqual([row.metadata.storage_path])
  })
})
