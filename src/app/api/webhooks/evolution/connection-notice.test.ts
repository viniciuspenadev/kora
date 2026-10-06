import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

// "Número caiu" pelo webhook: só a queda DE VEZ avisa na hora; piscada de reconexão não.
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
const notices = vi.hoisted(() => ({ notifyInbound: vi.fn(), notifyNumberDown: vi.fn(), clearNumberDown: vi.fn() }))
vi.mock("@/lib/atendimento/notices", () => notices)
const { dispatchEvolutionEvent } = await import("./route")

const instance = { id: "n1", tenant_id: "t", evolution_url: "https://test.invalid", evolution_key: "fake", instance_name: "loja" }
const update = (data: Record<string, unknown>) => dispatchEvolutionEvent(instance, { event: "connection.update", data }, false)
const seed = (extra: Record<string, unknown>) => db.reset({ whatsapp_instances: [{ ...instance, status: "connected", display_name: "Loja", phone_number: "+55 11 3000-0000", ...extra }] })
beforeEach(() => { Object.values(notices).forEach((f) => f.mockClear()) })

describe("webhook Evolution: número caiu", () => {
  it("deslogado (401) avisa na hora, com o nome do número", async () => {
    seed({})
    await update({ state: "close", statusReason: 401 })
    expect(notices.notifyNumberDown).toHaveBeenCalledWith({ tenantId: "t", instanceId: "n1", label: "Loja", reason: "logged_out" })
    expect(db.tables.whatsapp_instances[0].status).toBe("disconnected")
  })
  it("piscada (close comum, a Evolution reconecta sozinha) não avisa — quem confirma é a checagem de 5 min", async () => {
    seed({})
    await update({ state: "close", statusReason: 428 })
    await update({ state: "close" })
    expect(notices.notifyNumberDown).not.toHaveBeenCalled()
  })
  it("pareamento novo (sem telefone) não é queda; mesmo estado de novo não avisa", async () => {
    seed({ phone_number: null })
    await update({ state: "close", statusReason: 401 })
    seed({ status: "disconnected" })
    await update({ state: "close", statusReason: 401 })
    expect(notices.notifyNumberDown).not.toHaveBeenCalled()
  })
  it("desconexão pedida pelo cliente (botão Desconectar) não é \"o número caiu\"", async () => {
    seed({ user_disconnected: true })
    await update({ state: "close", statusReason: 401 })
    expect(notices.notifyNumberDown).not.toHaveBeenCalled()
  })
  it("reconectou → encerra a queda", async () => {
    seed({ status: "disconnected" })
    await update({ state: "open" })
    expect(notices.clearNumberDown).toHaveBeenCalledWith("t", "n1")
  })
})
