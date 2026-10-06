import { beforeEach, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"
vi.mock("server-only", () => ({}))
const db = new MemoryDb()
const execute = vi.fn()
let licensed = true
let decoupled = true
let history: {role: "user" | "assistant"; content: string}[] = []
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/auth", () => ({ auth: async () => null }))
vi.mock("@/lib/modules", () => ({ hasModule: async () => licensed }))
vi.mock("@/lib/ai-v2/studio-config", () => ({ loadStudioConfig: async () => ({ ai_control_decoupled: decoupled, ai_model: "test" }) }))
vi.mock("@/lib/ai-v2/flow/runtime", () => ({ runFlow: execute }))
vi.mock("@/lib/campaigns/engine", () => ({}))
vi.mock("@/lib/instagram/api", () => ({}))
vi.mock("@/lib/llm/context", () => ({ gatherPromptContext: async () => ({ history }), latestInboundAt: async () => null }))
vi.mock("@/lib/llm/pricing", () => ({ costOfTokens: () => 0 }))
vi.mock("@/lib/atendimento/events", () => ({ logConversationEvent: async () => {} }))
vi.mock("@/lib/commercial/entries", () => ({ emitCommercialEvent: async () => {} }))
const { runStudioTurn, resumeStudioRun } = await import("@/lib/ai-v2/run")
const { assertStudioControl } = await import("@/lib/ai-v2/control")
const conv = () => db.tables.chat_conversations[0]
const input = { tenantId: "t", conversationId: "c", incomingText: "Olá", instance: {} }
beforeEach(() => {
  licensed = true; decoupled = true; history = []; execute.mockReset()
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

it("turno após debounce conserva o gatilho de retorno do ciclo", async () => {
  conv().assigned_to=null; conv().metadata={attendance_cycle:"returned-cycle"}; conv().ai_handling=true
  db.tables.studio_flow_runs=[]
  const base=db.tables.studio_flows[0]
  db.tables.studio_flows=[{...base,id:"return",trigger:{type:"reopened"}},base]
  execute.mockResolvedValue({status:"responded",error:null,agent:null,departmentId:null})
  expect((await runStudioTurn({...input,signals:{isReopened:false}})).status).toBe("responded")
  expect(execute.mock.calls[0][1].id).toBe("return")
  expect(db.tables.studio_flow_runs[0].variables.__attendance_cycle).toBe("returned-cycle")
  db.tables.studio_flow_runs[0].status="done"
  await runStudioTurn({...input,signals:{isReopened:false}})
  expect(execute.mock.calls[1][1].id).toBe("f")
})

function firstEntry() {
  conv().assigned_to = null; conv().metadata = { studio_first_inbound: true }; conv().ai_handling = true
  db.tables.studio_flow_runs = []
  db.tables.studio_flows[0].trigger = { type: "new_contact" }
  execute.mockResolvedValue({ status: "responded", error: null, agent: null, departmentId: null })
}
it.each(["whatsapp", "meta_cloud", "site", "instagram"])("primeira entrada %s sobrevive à rajada e eco externo", async channel => {
  firstEntry(); conv().channel = channel
  history = [{ role: "user", content: "Olá" }, { role: "user", content: "Quero orçamento" }, { role: "assistant", content: "Recebido" }]
  expect((await runStudioTurn(input)).status).toBe("responded")
  expect(execute).toHaveBeenCalledOnce()
})
it("primeira entrada já executada não redispara novo contato", async () => {
  firstEntry(); await runStudioTurn(input)
  db.tables.studio_flow_runs[0].status = "done"
  expect((await runStudioTurn(input)).status).toBe("no_action")
  expect(execute).toHaveBeenCalledOnce()
})
it.each(["cycle", "signal", "human"])("marcador antigo não transforma %s em novo contato", async reason => {
  firstEntry()
  if (reason === "cycle") conv().metadata.attendance_cycle = "returned"
  if (reason === "human") conv().metadata.ai_routed = { via: "human_reply" }
  await runStudioTurn({ ...input, signals: { isReopened: reason === "signal" } })
  expect(execute).not.toHaveBeenCalled()
})
it("conversa legada sem marcador preserva a primeira mensagem", async () => {
  firstEntry(); conv().metadata = {}; history = [{ role: "user", content: "Olá" }]
  expect((await runStudioTurn(input)).status).toBe("responded")
})
it("histórico antigo sem marcador não vira novo contato", async () => {
  firstEntry(); conv().metadata = {}
  history = [{ role: "user", content: "Olá" }, { role: "assistant", content: "Atendido" }]
  expect((await runStudioTurn(input)).status).toBe("no_action")
  expect(execute).not.toHaveBeenCalled()
})
it("tomada humana continua vencendo o marcador de primeira entrada", async () => {
  firstEntry(); conv().ai_handling = false; conv().assigned_to = "agent"
  expect(await runStudioTurn(input)).toMatchObject({ status: "skipped", reason: "not_ai_controlled" })
  expect(execute).not.toHaveBeenCalled()
})
