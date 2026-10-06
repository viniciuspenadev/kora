import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

// Checagem de 5 min: "número caiu" só com o número fora em DUAS checagens seguidas.
vi.mock("server-only", () => ({}))
vi.mock("next/server", () => ({ NextResponse: { json: (b: unknown) => b } }))
const db = new MemoryDb()
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/lib/cron-auth", () => ({ requireCronSecret: () => null }))
vi.mock("@/lib/cron/run", () => ({ executarJob: async (_o: unknown, fn: () => Promise<unknown>) => ({ resultado: await fn() }) }))
vi.mock("@/lib/crypto/secrets", () => ({ decryptSecret: (s: string) => s }))
const notices = vi.hoisted(() => ({ notifyNumberDown: vi.fn(), clearNumberDown: vi.fn() }))
vi.mock("@/lib/atendimento/notices", () => notices)
const { GET } = await import("./route")

let state = "close"
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
const row = (extra: Record<string, unknown>) => ({ id: "n1", tenant_id: "t", evolution_url: "https://evo.invalid", evolution_key: "k",
  instance_name: "loja", webhook_url: null, phone_number: "+55 11 3000-0000", display_name: "Loja", last_connection_state: "open", ...extra })
const run = () => GET({} as never)
beforeEach(() => {
  Object.values(notices).forEach((f) => f.mockClear())
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("/connectionState/") ? json({ instance: { state } }) : json({})))
})
afterEach(() => { vi.unstubAllGlobals() })

it("fora na 1ª checagem: não avisa; fora de novo na seguinte: avisa (offline)", async () => {
  state = "close"; db.reset({ evolution_servers: [], whatsapp_instances: [row({})] })
  await run()
  expect(notices.notifyNumberDown).not.toHaveBeenCalled()
  await run()
  expect(notices.notifyNumberDown).toHaveBeenCalledWith({ tenantId: "t", instanceId: "n1", label: "Loja", reason: "offline" })
})
it("número nunca pareado (sem telefone), desconectado pelo cliente ou servidor fora do ar não é queda do número", async () => {
  state = "close"; db.reset({ evolution_servers: [], whatsapp_instances: [row({ phone_number: null, last_connection_state: "close" })] })
  await run()
  db.reset({ evolution_servers: [], whatsapp_instances: [row({ user_disconnected: true, last_connection_state: "close" })] })
  await run()
  state = "error"; db.reset({ evolution_servers: [], whatsapp_instances: [row({ last_connection_state: "error" })] })
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("fora do ar") }))
  await run()
  expect(notices.notifyNumberDown).not.toHaveBeenCalled()
})
it("voltou → encerra a queda (mesmo se o webhook se perdeu)", async () => {
  state = "open"; db.reset({ evolution_servers: [], whatsapp_instances: [row({ last_connection_state: "close" })] })
  await run()
  expect(notices.clearNumberDown).toHaveBeenCalledWith("t", "n1")
  notices.clearNumberDown.mockClear()
  await run()
  expect(notices.clearNumberDown).not.toHaveBeenCalled()
})
