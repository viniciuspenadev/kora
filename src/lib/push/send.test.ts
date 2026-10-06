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

const { sendPushToUsers } = await import("./send")

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

// Quem recebe aviso de mensagem (dono, participantes, fila) é regra de
// lib/atendimento/notices.ts — os testes moraram para notices.test.ts.
describe("ingressos do site", () => {
  it("webchat e formulário avisam pela regra do atendimento depois de gravar a mensagem", async () => {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const chat = readFileSync(join(process.cwd(), "src/app/api/site/message/route.ts"), "utf8")
    const lead = readFileSync(join(process.cwd(), "src/app/api/site/lead/route.ts"), "utf8")

    expect(chat).toContain("notifyInbound({")
    expect(chat.indexOf("if (messageError)")).toBeLessThan(chat.indexOf("notifyInbound({"))
    expect(lead).toContain("notifyInbound({")
    expect(lead.indexOf("if (messagesError)")).toBeLessThan(lead.indexOf("notifyInbound({"))
  })
})
