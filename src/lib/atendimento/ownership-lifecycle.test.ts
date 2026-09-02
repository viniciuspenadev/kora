import { beforeEach, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"
vi.mock("server-only", () => ({}))
const db = new MemoryDb()
let studio = true
let available = true
const runTurn = vi.fn(async (_input: unknown) => ({ status: "no_action" }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/auth", () => ({ auth: async () => null }))
vi.mock("@/lib/modules", () => ({ hasModule: async () => studio }))
vi.mock("@/lib/llm/active", () => ({ tenantAiActive: async () => studio }))
vi.mock("@/lib/auth/tenant-serviceable", () => ({ checkTenantStatus: async () => ({ canSpend: true }) }))
vi.mock("@/lib/ai-v2/run", () => ({ runStudioTurn: runTurn }))
vi.mock("@/lib/atendimento/events", () => ({ logConversationEvent: async () => {} }))
vi.mock("@/lib/commercial/entries", () => ({ emitCommercialEvent: async () => {} }))
vi.mock("@/lib/ai-v2/agent", () => ({ runAgentTurn: vi.fn() }))
vi.mock("@/lib/ai-v2/flow/data-sources", () => ({}))
vi.mock("@/lib/ai-v2/flow/router", () => ({}))
vi.mock("@/lib/ai-v2/flow/schedule", () => ({}))
vi.mock("@/lib/ai-v2/flow/outreach", () => ({}))
vi.mock("@/lib/ai-v2/flow/dossier", () => ({ extractDossier: async () => [] }))
vi.mock("@/lib/atendimento/availability", () => ({ checkDestinationAvailability: async () => ({ available, reason: "off_hours" }) }))
vi.mock("@/lib/ai-v2/capabilities", () => ({ ensureCapabilitiesRegistered: () => {},
  getCapability: () => transferCapability, TRANSFER: "transfer", HTTP_REQUEST: "http", TAG: "tag", MOVE_STAGE: "move_stage" }))
vi.mock("@/lib/ai-v2/capabilities/update-contact", () => ({}))

const { transferCapability } = await import("@/lib/ai-v2/capabilities/transfer")
const { runFlow } = await import("@/lib/ai-v2/flow/runtime")
const { findFlowToStart } = await import("@/lib/ai-v2/flow/triggers")
const { findOrReopenConversation } = await import("@/lib/conversation-dedup")
const { routeAutomationTurn } = await import("@/lib/ai-v2/dispatch")
const { createInboundConversation } = await import("@/lib/channels/inbound-conversation")
const input = { tenantId: "t", contactId: "contact", instanceId: "n", channel: "whatsapp" }
const turn = { tenantId: "t", conversationId: "c", incomingText: "Olá", instance: {} }
const conv = () => db.tables.chat_conversations[0]
const execution = () => ({ ctx: { tenantId: "t", conversationId: "c", contact: { id: "contact" },
  conversationMetadata: structuredClone(conv().metadata), departments: [{ id: "d", name: "Setor" }],
  instance: {}, history: [] }, model: "test", persona: {}, history: [], incomingText: "Olá" } as any)
const flow = (type: string, config: any = {}) => ({ id: "f", tenant_id: "t", name: "Fluxo", version: 1,
  graph: { nodes: [{ id: "node", type, config }], edges: [] } } as any)
const run = () => ({ ...db.tables.studio_flow_runs[0] } as any)

beforeEach(() => {
  studio = true; available = true; runTurn.mockReset().mockResolvedValue({ status: "no_action" })
  db.reset({
    chat_conversations: [{ id: "c", tenant_id: "t", contact_id: "contact", instance_id: "n", channel: "whatsapp",
      assigned_to: "old-agent", department_id: "old-department", status: "resolved", ai_handling: false,
      metadata: { ai_routed: { via: "old" }, reopen_owner: "old-agent", ai_pinned_flow: "old-flow" },
      updated_at: "2026-01-02T00:00:00Z", resolved_at: "2026-01-02T00:00:00Z" }],
    chat_contacts: [{ id: "contact", tenant_id: "t", owner_id: "owner" }],
    tenant_users: [{ tenant_id: "t", user_id: "owner", active: true, role: "agent", view_all: false, instance_ids: ["n"], department_id: "sales" }],
    tenant_config: [{ tenant_id: "t", handoff_binding: "carteira" }],
    studio_flow_runs: [{ id: "run", tenant_id: "t", conversation_id: "c", flow_id: "f", current_node_id: "node",
      variables: {}, call_stack: [], status: "waiting", resume_at: "2026-01-02T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }],
    studio_flows: [], chat_messages: [],
  })
})

it.each(["carteira", "pool"])("retorno %s oferece entrada ao Studio antes de atribuir", async binding => {
  db.tables.tenant_config[0].handoff_binding = binding
  const result = await findOrReopenConversation(input)
  expect(result.found).toBe("reopened"); expect(conv().assigned_to).toBeNull()
  expect(conv().department_id).toBeNull(); expect(conv().ai_handling).toBe(true)
  expect(conv().metadata.ai_routed).toBeUndefined(); expect(conv().metadata.reopen_owner).toBeUndefined()
  expect(db.tables.studio_flow_runs[0].status).toBe("done")
  expect(db.tables.chat_contacts[0].owner_id).toBe("owner")
})
it("sem Studio retorna ao dono mesmo com carimbo desligado", async () => {
  studio = false; db.tables.tenant_config[0].handoff_binding = "pool"
  await findOrReopenConversation(input)
  expect(conv().assigned_to).toBe("owner"); expect(conv().ai_handling).toBe(false)
})
it("reabertura perdedora não apaga um novo run", async () => {
  db.beforeWrite = (table, patch) => {
    if (table === "chat_conversations" && patch.status === "open") {
      conv().status = "open"; conv().updated_at = "changed"; conv().assigned_to = "new-agent"
      Object.assign(db.tables.studio_flow_runs[0], { status: "waiting", updated_at: "2026-12-01T00:00:00Z" })
    }
  }
  const result = await findOrReopenConversation(input)
  expect(result.found).toBe("active"); expect(conv().assigned_to).toBe("new-agent")
  expect(db.tables.studio_flow_runs[0].status).toBe("waiting")
})
it("criação sem Studio também aplica o destino padrão", async () => {
  studio = false; db.tables.chat_conversations = []
  await createInboundConversation(input)
  expect(conv().assigned_to).toBe("owner"); expect(conv().ai_handling).toBe(false)
})
it("criação manual conserva o destino escolhido", async () => {
  db.tables.chat_conversations = []
  await createInboundConversation({ ...input, assignTo: "manual" })
  expect(conv().assigned_to).toBe("manual"); expect(conv().ai_handling).toBe(false)
})
it("sem fluxo aplicável o dispatcher entrega ao responsável", async () => {
  await findOrReopenConversation(input)
  await routeAutomationTurn(turn)
  expect(runTurn).toHaveBeenCalledOnce(); expect(conv().assigned_to).toBe("owner")
})
it("dispatcher preserva um fluxo que está esperando resposta", async () => {
  await findOrReopenConversation(input)
  db.tables.studio_flow_runs[0].status = "waiting"
  runTurn.mockResolvedValueOnce({ status: "responded" })
  await routeAutomationTurn(turn)
  expect(conv().assigned_to).toBeNull(); expect(conv().ai_handling).toBe(true)
})
it("dispatcher não reaplica fallback sem contexto depois de erro do runner", async () => {
  await findOrReopenConversation(input)
  runTurn.mockResolvedValueOnce({ status: "error" })
  await routeAutomationTurn(turn)
  expect(conv().assigned_to).toBeNull(); expect(conv().ai_handling).toBe(true)
})
it("fim do grafo aplica responsável sem backup de reabertura", async () => {
  Object.assign(conv(), { status: "open", assigned_to: null, metadata: {}, ai_handling: true })
  await runFlow(execution(), flow("end"), run())
  expect(conv().assigned_to).toBe("owner"); expect(conv().ai_handling).toBe(false)
})
it("transfer para fila seguido de fim não restaura o dono do snapshot", async () => {
  Object.assign(conv(), { status: "open", assigned_to: null, metadata: { reopen_owner: "owner" }, ai_handling: true })
  const result = await runFlow(execution(), flow("transfer", { target: "pool" }), run())
  expect(result.status).toBe("routed"); expect(conv().assigned_to).toBeNull(); expect(conv().ai_handling).toBe(false)
  expect(conv().metadata.reopen_owner).toBeUndefined()
})
it("keep_ai deixa execução viva e não dispara entrega humana", async () => {
  available = false
  Object.assign(conv(), { status: "open", assigned_to: null, metadata: {}, ai_handling: true })
  await runFlow(execution(), flow("transfer", { target: "pool", whenUnavailable: "keep_ai" }), run())
  expect(db.tables.studio_flow_runs[0].status).toBe("active")
  expect(conv().ai_handling).toBe(true); expect(conv().assigned_to).toBeNull()
})
it("nó resolver perde CAS para tomada humana", async () => {
  Object.assign(conv(), { status: "open", assigned_to: null, metadata: {}, ai_handling: true })
  db.beforeWrite = (table, patch) => { if (table === "chat_conversations" && patch.status === "resolved") {
    conv().updated_at = "changed"; conv().assigned_to = "human"
  } }
  await expect(runFlow(execution(), flow("resolve"), run())).rejects.toThrow("mudou")
  expect(conv().status).toBe("open"); expect(conv().assigned_to).toBe("human")
})
it("matcher real usa canal, número e precedência do retorno", async () => {
  const f = (id: string, trigger: any, active = true) => ({ id, tenant_id: "t", status: "published", active, trigger })
  db.tables.studio_flows = [f("any", { type: "any_message" }),
    f("site", { type: "reopened", channels: ["site"] }),
    f("number", { type: "reopened", channels: ["whatsapp"], instances: ["other"] }),
    f("off", { type: "reopened" }, false), f("keyword-empty", { type: "keyword", keywords: [] }),
    f("return", { type: "reopened", channels: ["whatsapp"], instances: ["n"] })]
  expect((await findFlowToStart("t", "Olá", false, { channel: "whatsapp", instanceId: "n", isReopened: true }))?.id).toBe("return")
  expect((await findFlowToStart("t", "Olá", false, { channel: "site", isReopened: true }))?.id).toBe("site")
  expect((await findFlowToStart("t", "Olá", false, { channel: "whatsapp", instanceId: "n" }))?.id).toBe("any")
})
