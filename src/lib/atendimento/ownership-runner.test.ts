import { beforeEach, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"
vi.mock("server-only", () => ({}))
const db = new MemoryDb()
const execute = vi.fn()
let licensed = true
let decoupled = true
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/auth", () => ({ auth: async () => null }))
vi.mock("@/lib/modules", () => ({ hasModule: async () => licensed }))
vi.mock("@/lib/ai-v2/studio-config", () => ({ loadStudioConfig: async () => ({ ai_control_decoupled: decoupled, ai_model: "test" }) }))
vi.mock("@/lib/ai-v2/flow/runtime", () => ({ runFlow: execute }))
vi.mock("@/lib/campaigns/engine", () => ({}))
vi.mock("@/lib/instagram/api", () => ({}))
vi.mock("@/lib/llm/context", () => ({ gatherPromptContext: async () => ({ history: [] }), latestInboundAt: async () => null }))
vi.mock("@/lib/llm/pricing", () => ({ costOfTokens: () => 0 }))
vi.mock("@/lib/atendimento/events", () => ({ logConversationEvent: async () => {} }))
vi.mock("@/lib/commercial/entries", () => ({ emitCommercialEvent: async () => {} }))
const { runStudioTurn, resumeStudioRun } = await import("@/lib/ai-v2/run")
const { assertStudioControl } = await import("@/lib/ai-v2/control")
const conv = () => db.tables.chat_conversations[0]
const input = { tenantId: "t", conversationId: "c", incomingText: "Olá", instance: {} }
beforeEach(() => {
  licensed = true; decoupled = true; execute.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
  db.reset({
    chat_conversations: [{ id: "c", tenant_id: "t", status: "open", contact_id: "contact", instance_id: null,
      channel: "site", assigned_to: "agent", department_id: null, metadata: { ai_routed: { via: "manual" } },
      updated_at: "2026-01-01T00:00:00Z", ai_handling: false, chat_contacts: { id: "contact" } }],
    studio_flows: [{ id: "f", tenant_id: "t", status: "published", active: true, version: 1,
      trigger: { type: "any_message" }, graph: { nodes: [{ id: "start", type: "start" }], edges: [] } }],
    studio_flow_runs: [{ id: "run", tenant_id: "t", conversation_id: "c", flow_id: "f", status: "waiting", variables: {} }],
    chat_contacts: [{ id: "contact", tenant_id: "t", owner_id: null }],
  })
})
it("falha depois do disparo manual devolve controle sem depender do dispatcher", async () => {
  execute.mockRejectedValueOnce(new Error("provider offline"))
  expect((await runStudioTurn(input, { forceFlowId: "f" })).status).toBe("error")
  expect(conv().ai_handling).toBe(false); expect(conv().assigned_to).toBe("agent")
  expect(conv().metadata.studio_entry).toBeUndefined()
})
it("turno invalidado por nova entrada não desliga o Studio novo", async () => {
  execute.mockImplementationOnce(async ({ ctx }) => {
    conv().metadata.studio_entry = "new-entry"
    await assertStudioControl(ctx)
  })
  expect(await runStudioTurn(input, { forceFlowId: "f" })).toMatchObject({ status: "skipped", reason: "control_changed" })
  expect(conv().ai_handling).toBe(true); expect(conv().metadata.studio_entry).toBe("new-entry")
})
it("erro operacional antigo também respeita a nova geração", async () => {
  execute.mockImplementationOnce(async () => { conv().metadata.studio_entry = "new-entry"; throw new Error("provider offline") })
  expect((await runStudioTurn(input, { forceFlowId: "f" })).status).toBe("error")
  expect(conv().ai_handling).toBe(true); expect(conv().metadata.studio_entry).toBe("new-entry")
})
it.each([false, true])("disparo explícito continua com atribuição no modo decoupled=%s", async value => {
  decoupled = value
  execute.mockResolvedValue({ status: "responded", error: null, agent: null, departmentId: null })
  expect((await runStudioTurn(input, { forceFlowId: "f" })).status).toBe("responded")
  expect((await runStudioTurn(input)).status).toBe("responded")
  expect(conv().assigned_to).toBe("agent"); expect(execute).toHaveBeenCalledTimes(2)
})
it.each(["module", "paused"])("retomada %s devolve ao humano e encerra run", async reason => {
  conv().assigned_to = null; conv().metadata = {}; conv().ai_handling = true
  if (reason === "module") licensed = false
  else db.tables.studio_flows[0].active = false
  expect((await resumeStudioRun("t", "c")).status).toBe("skipped")
  expect(conv().ai_handling).toBe(false); expect(db.tables.studio_flow_runs[0].status).toBe("done")
  expect(execute).not.toHaveBeenCalled()
})
