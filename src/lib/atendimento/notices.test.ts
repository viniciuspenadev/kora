import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

// Avisos do atendimento (notices.ts): quem recebe, o que diz, quando vai ao celular e a rajada.
vi.mock("server-only", () => ({}))
vi.mock("@/auth", () => ({ auth: async () => null }))
const db = new MemoryDb()
// O banco carimba `created_at`/`read_at` no insert — o fake não; a rajada depende disso.
const baseFrom = db.from
db.from = ((table: string) => {
  const q = baseFrom(table)
  if (table === "notifications") {
    const insert = q.insert
    q.insert = (v: Record<string, unknown> | Record<string, unknown>[]) =>
      insert((Array.isArray(v) ? v : [v]).map((r) => ({ created_at: new Date().toISOString(), read_at: null, ...r })))
  }
  return q
}) as typeof db.from
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
type Push = { title: string; body: string; url: string; tag: string }
const push = vi.hoisted(() => vi.fn<(tenantId: string, userIds: string[], p: Push) => Promise<void>>(async () => {}))
vi.mock("@/lib/push/send", () => ({ sendPushToUsers: push }))
const scope = vi.hoisted(() => ({ tenantId: "t", userId: "ana" }))
vi.mock("@/lib/visibility", async (original) => ({ ...await original<typeof import("@/lib/visibility")>(), getViewerScope: async () => scope }))
const tenant = vi.hoisted(() => ({ degraded: false, canAccess: true }))
vi.mock("@/lib/auth/tenant-serviceable", () => ({ checkTenantStatus: async () => tenant }))

const notices = await import("./notices")
const { getUnreadCount, markConversationNotificationsRead } = await import("@/lib/actions/notifications")

const CONV = "11111111-1111-4111-8111-111111111111"
const DEPT = "dept-vendas"
const member = (user_id: string, extra: Record<string, unknown> = {}) =>
  ({ tenant_id: "t", user_id, role: "agent", active: true, view_all: false, see_pool: true, instance_ids: null, department_id: null, supervises_departments: null, ...extra })
const conv = (extra: Record<string, unknown> = {}) => ({
  id: CONV, tenant_id: "t", contact_id: "ct", instance_id: "i1", channel: "whatsapp", assigned_to: null, department_id: null,
  ai_handling: false, status: "open", participants: [], last_message_preview: "Quero o preço da sacada de vidro", from_ad_meta: null, ...extra,
})
const at = (iso: string) => vi.setSystemTime(new Date(iso))
const notes = (type?: string) => db.tables.notifications.filter((n) => !type || n.type === type)
const pushedTo = () => push.mock.calls.flatMap((c) => c[1])

function seed(convExtra: Record<string, unknown> = {}, more: Record<string, Record<string, unknown>[]> = {}) {
  db.reset({
    chat_conversations: [conv(convExtra)],
    chat_contacts: [{ id: "ct", tenant_id: "t", custom_name: "Marina Lopes", push_name: null, phone_number: "5511999990000", created_at: "2026-01-01T00:00:00Z" }],
    whatsapp_instances: [{ id: "i1", tenant_id: "t", display_name: "Loja", phone_number: "551130000000", instance_name: "loja" }],
    chat_messages: [], notifications: [], user_sessions: [],
    tenant_users: [
      member("dona", { role: "owner" }), member("gerente", { role: "admin" }), member("super", { view_all: true }),
      member("ana", { department_id: DEPT }), member("bia"), member("caio", { see_pool: false }),
      member("duda", { instance_ids: ["i2"] }), member("edu", { active: false }),
      member("fabi", { supervises_departments: [DEPT], see_pool: false }),
    ],
    ...more,
  })
}

beforeEach(() => { vi.useFakeTimers(); at("2026-10-06T12:00:00Z"); push.mockClear(); Object.assign(tenant, { degraded: false, canAccess: true }); seed() })

describe("quem recebe a conversa sem dono", () => {
  it("fila do setor: quem é do setor e quem o supervisiona — não o dono nem a fila geral", async () => {
    expect((await notices.queueRecipients("t", "i1", DEPT)).sort()).toEqual(["ana", "fabi"])
  })
  it("fila geral: quem atende a fila daquele número (see_pool), nunca quem desligou a fila ou é de outro número", async () => {
    expect((await notices.queueRecipients("t", "i1", null)).sort()).toEqual(["ana", "bia"])
  })
  it("ninguém atende aquela fila → donos, admins e supervisor geral (nunca some calado)", async () => {
    expect((await notices.queueRecipients("t", "i1", "dept-sem-ninguem")).sort()).toEqual(["dona", "gerente", "super"])
  })
})

describe("sem dono na fila", () => {
  it("avisa a fila do setor; o celular só de quem não está com o Kora aberto, e sem o conteúdo", async () => {
    seed({ department_id: DEPT }, { user_sessions: [{ user_id: "ana", last_seen_at: "2026-10-06T11:59:30Z" }] })
    await notices.notifyQueue({ tenantId: "t", conversationId: CONV, departmentName: "Vendas" })
    expect(notes().map((n) => n.recipient_user_id).sort()).toEqual(["ana", "fabi"])
    expect(notes()[0].title).toBe("Marina Lopes está sem dono na fila de Vendas")
    expect(notes()[0].body).toContain("Quero o preço da sacada")
    expect(pushedTo()).toEqual(["fabi"])
    const p = push.mock.calls[0][2]
    expect(p).toMatchObject({ title: "Cliente esperando na fila", body: "Marina · WhatsApp (Loja)" })
    expect(p.body).not.toContain("sacada")
  })
  it("quem devolveu a conversa para a fila não é avisado; conversa com dono não avisa a fila", async () => {
    await notices.notifyQueue({ tenantId: "t", conversationId: CONV, excludeUserId: "bia" })
    expect(notes().map((n) => n.recipient_user_id)).toEqual(["ana"])
    seed({ assigned_to: "bia" })
    await notices.notifyQueue({ tenantId: "t", conversationId: CONV })
    expect(notes()).toHaveLength(0)
  })
  it("rajada: o cliente insiste e ninguém viu → o MESMO aviso conta mais uma, sem novo toque no celular", async () => {
    await notices.notifyInbound({ tenantId: "t", conversationId: CONV })
    expect(notes()).toHaveLength(2)
    expect(push).toHaveBeenCalledTimes(2)
    // A mensagem que criou o aviso não conta como "mais uma".
    at("2026-10-06T12:00:20Z"); await notices.notifyInbound({ tenantId: "t", conversationId: CONV })
    expect(notes()[0].body).not.toContain("mandou mais")
    at("2026-10-06T12:03:00Z"); await notices.notifyInbound({ tenantId: "t", conversationId: CONV })
    at("2026-10-06T12:04:00Z"); await notices.notifyInbound({ tenantId: "t", conversationId: CONV })
    expect(notes()).toHaveLength(2)
    expect(notes()[0].body).toMatch(/ · e mandou mais 2 mensagens$/)
    expect(notes()[0].payload.more).toBe(2)
    expect(push).toHaveBeenCalledTimes(2)
  })
  it("passou a janela da rajada → aviso novo (e toca de novo)", async () => {
    await notices.notifyInbound({ tenantId: "t", conversationId: CONV })
    at("2026-10-06T12:20:00Z"); await notices.notifyInbound({ tenantId: "t", conversationId: CONV })
    expect(notes()).toHaveLength(4)
    expect(push).toHaveBeenCalledTimes(4)
  })
})

describe("cliente respondeu", () => {
  it("vai ao dono e a quem participa (ativo); o celular não mostra o conteúdo", async () => {
    seed({ assigned_to: "bia", participants: ["ana", "edu"] })
    await notices.notifyInbound({ tenantId: "t", conversationId: CONV })
    expect(notes("client_replied").map((n) => n.recipient_user_id).sort()).toEqual(["ana", "bia"])
    expect(notes()[0]).toMatchObject({ title: "Marina Lopes respondeu", body: "Quero o preço da sacada de vidro" })
    const p = push.mock.calls[0][2]
    expect(p).toMatchObject({ title: "Mensagem nova", body: "Marina respondeu na sua conversa" })
  })
  it("várias seguidas viram 1 aviso: \"Marina mandou 3 mensagens\"", async () => {
    seed({ assigned_to: "bia" })
    await notices.notifyInbound({ tenantId: "t", conversationId: CONV })
    at("2026-10-06T12:02:00Z"); await notices.notifyInbound({ tenantId: "t", conversationId: CONV })
    at("2026-10-06T12:03:00Z"); await notices.notifyInbound({ tenantId: "t", conversationId: CONV })
    expect(notes()).toHaveLength(1)
    expect(notes()[0].title).toBe("Marina mandou 3 mensagens")
    expect(push).toHaveBeenCalledTimes(1)
  })
  it("com o robô atendendo ou conversa concluída: ninguém é avisado", async () => {
    seed({ assigned_to: "bia", ai_handling: true })
    await notices.notifyInbound({ tenantId: "t", conversationId: CONV })
    seed({ status: "resolved" })
    await notices.notifyInbound({ tenantId: "t", conversationId: CONV })
    expect(notes()).toHaveLength(0)
    expect(push).not.toHaveBeenCalled()
  })
  it("mensagem logo depois de receber a conversa soma no aviso de entrega (não vira outro)", async () => {
    seed({ assigned_to: "bia" })
    await notices.notifyDelivered({ tenantId: "t", conversationId: CONV, agentId: "bia", via: "studio" })
    at("2026-10-06T12:02:00Z"); await notices.notifyInbound({ tenantId: "t", conversationId: CONV })
    expect(notes()).toHaveLength(1)
    expect(notes()[0].body).toMatch(/ · e mandou mais 1 mensagem$/)
  })
})

describe("conversa entregue a você", () => {
  it("transferência à mão diz quem transferiu; quem entrega a si mesmo não é avisado", async () => {
    await notices.notifyDelivered({ tenantId: "t", conversationId: CONV, agentId: "bia", via: "manual", byUserId: "bia", byName: "Bia" })
    expect(notes()).toHaveLength(0)
    await notices.notifyDelivered({ tenantId: "t", conversationId: CONV, agentId: "bia", via: "manual", byUserId: "ana", byName: "Ana" })
    expect(notes()[0]).toMatchObject({ recipient_user_id: "bia", type: "conversation_delivered", title: "Ana transferiu Marina Lopes para você" })
    expect(push.mock.calls[0][2].title).toBe("Nova conversa para você")
  })
  it("a mesma entrega duas vezes não vira dois avisos", async () => {
    await notices.notifyDelivered({ tenantId: "t", conversationId: CONV, agentId: "bia", via: "rodizio" })
    await notices.notifyDelivered({ tenantId: "t", conversationId: CONV, agentId: "bia", via: "rodizio" })
    expect(notes()).toHaveLength(1)
    expect(notes()[0].title).toBe("Nova conversa para você: Marina Lopes")
  })
  it("carteira e formulário: de onde veio, cliente novo e o que pediu", async () => {
    seed({}, {
      chat_contacts: [{ id: "ct", tenant_id: "t", custom_name: null, push_name: "Marina", phone_number: "5511999990000", created_at: "2026-10-06T10:00:00Z" }],
      chat_messages: [{ tenant_id: "t", conversation_id: CONV, is_private_note: true, created_at: "2026-10-06T11:30:00Z",
        metadata: { form: { formName: "Orçamento guiado", items: [{ value: "Sacada" }, { value: "12 m²" }, { value: "Urgente" }] } } }],
    })
    await notices.notifyDelivered({ tenantId: "t", conversationId: CONV, agentId: "bia", via: "carteira" })
    expect(notes()[0]).toMatchObject({ title: "Cliente da sua carteira: Marina", body: "formulário “Orçamento guiado” · cliente novo · Sacada · 12 m²" })
    expect(push.mock.calls[0][2].body).toBe("Marina · formulário “Orçamento guiado”")
  })
})

describe("número caiu", () => {
  it("donos e admins, sempre no celular; UM aviso por queda; reconectou → some, e a próxima queda avisa", async () => {
    await notices.notifyNumberDown({ tenantId: "t", instanceId: "i1", label: "Loja", reason: "logged_out" })
    expect(notes().map((n) => n.recipient_user_id).sort()).toEqual(["dona", "gerente"])
    expect(notes()[0]).toMatchObject({ title: "O número Loja desconectou", payload: { url: "/integracoes", reason: "logged_out" } })
    expect(notes()[0].body).toContain("QR")
    expect(pushedTo().sort()).toEqual(["dona", "gerente"])
    // Mesma queda: nem a checagem de 5 min nem horas depois (mesmo já visto) avisam de novo.
    db.tables.notifications.forEach((n) => { n.read_at = "2026-10-06T12:01:00Z" })
    at("2026-10-06T20:00:00Z"); await notices.notifyNumberDown({ tenantId: "t", instanceId: "i1", label: "Loja", reason: "offline" })
    expect(notes()).toHaveLength(2)
    await notices.clearNumberDown("t", "i1")
    expect(notes().every((n) => n.read_at && n.payload.cleared)).toBe(true)
    expect(notes()[0].read_at).toBe("2026-10-06T12:01:00Z")
    await notices.notifyNumberDown({ tenantId: "t", instanceId: "i1", label: "Loja", reason: "offline" })
    expect(notes()).toHaveLength(4)
    expect(notes()[3].body).toContain("internet")
  })
  it("empresa suspensa: canal pausado de propósito não é queda; consulta falhou → avisa mesmo assim", async () => {
    Object.assign(tenant, { degraded: false, canAccess: false })
    await notices.notifyNumberDown({ tenantId: "t", instanceId: "i1", label: "Loja", reason: "logged_out" })
    expect(notes()).toHaveLength(0)
    Object.assign(tenant, { degraded: true, canAccess: false })
    await notices.notifyNumberDown({ tenantId: "t", instanceId: "i1", label: "Loja", reason: "logged_out" })
    expect(notes()).toHaveLength(2)
  })
  it("a queda de um número não segura o aviso de outro", async () => {
    await notices.notifyNumberDown({ tenantId: "t", instanceId: "i1", label: "Loja", reason: "offline" })
    await notices.notifyNumberDown({ tenantId: "t", instanceId: "i2", label: "Vendas", reason: "offline" })
    expect(notes()).toHaveLength(4)
  })
})

it("ninguém disponível na distribuição: o aviso dos donos chega também ao celular", async () => {
  await notices.pushUnassigned("t", CONV)
  expect(pushedTo().sort()).toEqual(["dona", "gerente"])
  expect(push.mock.calls[0][2].url).toBe(`/inbox?conversation=${CONV}`)
})

describe("o sininho se arruma sozinho", () => {
  it("\"sem dono na fila\" que alguém já assumiu deixa de contar", async () => {
    await notices.notifyQueue({ tenantId: "t", conversationId: CONV })
    expect(await getUnreadCount()).toBe(1)
    db.tables.chat_conversations[0].assigned_to = "bia"
    expect(await getUnreadCount()).toBe(0)
  })
  it("abrir a conversa dá como vistos só os avisos DELA e só os meus", async () => {
    await notices.notifyQueue({ tenantId: "t", conversationId: CONV })
    db.tables.notifications.push({ tenant_id: "t", recipient_user_id: "ana", type: "client_replied", read_at: null, payload: { conversation_id: "outra" } })
    expect(await markConversationNotificationsRead("nao-e-uuid")).toEqual({ error: "Conversa inválida." })
    await markConversationNotificationsRead(CONV)
    const mine = db.tables.notifications.filter((n) => n.recipient_user_id === "ana")
    expect(mine.find((n) => n.payload.conversation_id === CONV)?.read_at).toBeTruthy()
    expect(mine.find((n) => n.payload.conversation_id === "outra")?.read_at).toBeNull()
    expect(db.tables.notifications.find((n) => n.recipient_user_id === "bia")?.read_at).toBeNull()
  })
})
