import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  from: vi.fn(),
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/auth", () => ({ auth: async () => null }))
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => h.from(...args) },
}))
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: (...args: unknown[]) => h.setVapidDetails(...args),
    sendNotification: (...args: unknown[]) => h.sendNotification(...args),
  },
}))

process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-public-key"
process.env.VAPID_PRIVATE_KEY = "test-private-key"

const { notifyInboundMessage, sendPushToUsers } = await import("./send")

type Conversation = {
  assigned_to: string | null
  participants: string[]
  instance_id: string | null
  department_id: string | null
}

type Member = {
  user_id: string
  role: string
  view_all?: boolean | null
  see_pool?: boolean | null
  instance_ids?: string[] | null
  department_id?: string | null
  supervises_departments?: string[] | null
}

function resultBuilder(data: unknown, error: unknown = null) {
  const query: Record<string, unknown> = {}
  query.select = vi.fn(() => query)
  query.eq = vi.fn(() => query)
  query.in = vi.fn(async () => ({ data, error }))
  return query as {
    select: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    in: ReturnType<typeof vi.fn>
  }
}

function conversationBuilder(data: Conversation | null, error: unknown = null) {
  const query: Record<string, unknown> = {}
  query.select = vi.fn(() => query)
  query.eq = vi.fn(() => query)
  query.maybeSingle = vi.fn(async () => ({ data, error }))
  return query as {
    select: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    maybeSingle: ReturnType<typeof vi.fn>
  }
}

function membersBuilder(data: Member[], error: unknown = null) {
  const query: Record<string, unknown> = {}
  query.select = vi.fn(() => query)
  query.eq = vi.fn(() => query)
  query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(resolve, reject)
  return query as {
    select: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    then: PromiseLike<unknown>["then"]
  }
}

function subscription(id: string) {
  return { id, endpoint: `https://push.test/${id}`, p256dh: `key-${id}`, auth: `auth-${id}` }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.sendNotification.mockResolvedValue(undefined)
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("sendPushToUsers", () => {
  it("consulta inscrições pelo tenant e remove ids duplicados", async () => {
    const push = resultBuilder([subscription("sub-1")])
    h.from.mockReturnValue(push)

    await sendPushToUsers("tenant-blue", ["user-1", "user-1"], {
      title: "Nova mensagem",
      body: "Olá",
    })

    expect(push.eq).toHaveBeenCalledWith("tenant_id", "tenant-blue")
    expect(push.in).toHaveBeenCalledWith("user_id", ["user-1"])
    expect(h.sendNotification).toHaveBeenCalledTimes(1)
  })
})

describe("notifyInboundMessage", () => {
  it("notifica somente responsável e participantes que continuam ativos", async () => {
    const conversation = conversationBuilder({
      assigned_to: "assigned",
      participants: ["participant", "inactive"],
      instance_id: null,
      department_id: null,
    })
    const members = membersBuilder([
      { user_id: "assigned", role: "agent" },
      { user_id: "participant", role: "agent" },
      { user_id: "admin", role: "admin" },
    ])
    const push = resultBuilder([])
    h.from.mockImplementation((table: string) => {
      if (table === "chat_conversations") return conversation
      if (table === "tenant_users") return members
      if (table === "push_subscriptions") return push
      throw new Error(`Tabela inesperada: ${table}`)
    })

    await notifyInboundMessage({ tenantId: "tenant-blue", conversationId: "conv-1", title: "Nova", preview: "Olá" })

    expect(conversation.eq).toHaveBeenCalledWith("tenant_id", "tenant-blue")
    expect(push.in).toHaveBeenCalledWith("user_id", ["assigned", "participant"])
  })

  it("respeita pool, fila por setor, supervisão e participante ativo", async () => {
    const conversation = conversationBuilder({
      assigned_to: null,
      participants: ["participant", "inactive"],
      instance_id: "number-1",
      department_id: "sales",
    })
    const members = membersBuilder([
      { user_id: "owner", role: "owner" },
      { user_id: "pool", role: "agent", see_pool: true, instance_ids: ["number-1"] },
      { user_id: "wrong-number", role: "agent", see_pool: true, instance_ids: ["number-2"] },
      { user_id: "sales", role: "agent", see_pool: false, department_id: "sales", instance_ids: ["number-1"] },
      { user_id: "supervisor", role: "agent", see_pool: false, supervises_departments: ["sales"] },
      { user_id: "participant", role: "agent", see_pool: false, department_id: "support" },
    ])
    const push = resultBuilder([])
    h.from.mockImplementation((table: string) => {
      if (table === "chat_conversations") return conversation
      if (table === "tenant_users") return members
      if (table === "push_subscriptions") return push
      throw new Error(`Tabela inesperada: ${table}`)
    })

    await notifyInboundMessage({ tenantId: "tenant-blue", conversationId: "conv-2", title: "Nova", preview: "Olá" })

    expect(push.in).toHaveBeenCalledWith("user_id", ["owner", "sales", "supervisor", "participant"])
  })

  it("não consulta membros nem dispositivos quando a conversa não pertence ao tenant", async () => {
    const conversation = conversationBuilder(null)
    h.from.mockImplementation((table: string) => {
      if (table === "chat_conversations") return conversation
      throw new Error(`Consulta indevida: ${table}`)
    })

    await notifyInboundMessage({ tenantId: "tenant-blue", conversationId: "foreign", title: "Nova", preview: "Olá" })

    expect(conversation.eq).toHaveBeenCalledWith("tenant_id", "tenant-blue")
    expect(h.from).toHaveBeenCalledTimes(1)
    expect(h.sendNotification).not.toHaveBeenCalled()
  })
})

describe("ingressos do site", () => {
  it("webchat e formulário usam o produtor de push depois de persistir a mensagem", async () => {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const chat = readFileSync(join(process.cwd(), "src/app/api/site/message/route.ts"), "utf8")
    const lead = readFileSync(join(process.cwd(), "src/app/api/site/lead/route.ts"), "utf8")

    expect(chat).toContain("notifyInboundMessage({")
    expect(chat.indexOf("if (messageError)")).toBeLessThan(chat.indexOf("notifyInboundMessage({"))
    expect(lead).toContain("notifyInboundMessage({")
    expect(lead.indexOf("if (messagesError)")).toBeLessThan(lead.indexOf("notifyInboundMessage({"))
    expect(lead).toContain('preview: "Um novo formulário foi recebido."')
  })
})
