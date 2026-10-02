import { beforeEach, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

// Bastão do Disparar (F2b): o fluxo roda no chat do site, o Disparar abre o fio WhatsApp
// e o resto do fluxo continua LÁ — inclusive a espera "respondeu / sem resposta".
vi.mock("server-only", () => ({}))
const db = new MemoryDb()
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/auth", () => ({ auth: async () => null }))
vi.mock("@/lib/modules", () => ({ hasModule: async () => true }))
vi.mock("@/lib/atendimento/events", () => ({ logConversationEvent: async () => {} }))
vi.mock("@/lib/commercial/entries", () => ({ emitCommercialEvent: async () => {} }))
vi.mock("@/lib/llm/openai", () => ({ runChat: vi.fn() }))
vi.mock("@/lib/ai-v2/agent", () => ({ runAgentTurn: vi.fn() }))
vi.mock("@/lib/ai-v2/flow/data-sources", () => ({ resolveConnectedSources: () => ({ tools: [], toolConfig: {} }) }))
vi.mock("@/lib/ai-v2/flow/router", () => ({}))
vi.mock("@/lib/ai-v2/flow/schedule", () => ({}))
vi.mock("@/lib/ai-v2/flow/dossier", () => ({ extractDossier: async () => [] }))
vi.mock("@/lib/ai-v2/capabilities", () => ({
  ensureCapabilitiesRegistered: () => {}, getCapability: () => null,
  TRANSFER: "transfer", HTTP_REQUEST: "http", TAG: "tag", MOVE_STAGE: "move_stage",
}))
const handBack = vi.fn(async () => {})
vi.mock("@/lib/atendimento/human-routing", () => ({ routeToHumanDefault: handBack }))
const runOutreach = vi.fn()
vi.mock("@/lib/ai-v2/flow/outreach", () => ({ runOutreach }))

const { runFlow } = await import("./runtime")

const graph = (withNext: boolean) => ({
  nodes: [
    { id: "o1", type: "outreach", config: { channel: "baileys", text: "Oi {{nome}}" } },
    { id: "w1", type: "wait", config: { amount: 2, unit: "hours" } },
    { id: "sem-resposta", type: "end", config: {} },
    { id: "respondeu", type: "end", config: {} },
  ],
  edges: withNext ? [
    { from: "o1", to: "w1", branch: "sent" },
    { from: "w1", to: "sem-resposta" },
    { from: "w1", to: "respondeu", branch: "returned" },
  ] : [],
})
const flow = (withNext = true) => ({ id: "f", tenant_id: "t", version: 3, graph: graph(withNext) }) as never
const conv = (id: string) => db.tables.chat_conversations.find((c) => c.id === id)!
const runOf = (conversationId: string) => db.tables.studio_flow_runs.find((r) => r.conversation_id === conversationId)
const siteCtx = () => ({
  tenantId: "t", conversationId: "c", channel: "site", contact: { id: "contact", custom_name: "Marina" },
  conversationMetadata: structuredClone(conv("c").metadata), departments: [], instance: {}, history: [],
}) as never
const input = (ctx: unknown, incomingText = "") => ({ ctx, model: "m", persona: {}, history: [], incomingText }) as never

beforeEach(() => {
  handBack.mockClear(); runOutreach.mockReset()
  runOutreach.mockResolvedValue({ branch: "sent", conversationId: "wa" })
  db.reset({
    chat_conversations: [
      { id: "c", tenant_id: "t", status: "open", channel: "site", contact_id: "contact", instance_id: null,
        metadata: { attendance_cycle: "ciclo-site" }, updated_at: "t0", ai_handling: true, assigned_to: null },
      { id: "wa", tenant_id: "t", status: "open", channel: "whatsapp", contact_id: "contact", instance_id: "i1",
        metadata: {}, updated_at: "t1", ai_handling: false, assigned_to: null },
    ],
    whatsapp_instances: [{ id: "i1", tenant_id: "t", provider: "baileys", instance_name: "kora" }],
    studio_flow_runs: [{ id: "run-site", tenant_id: "t", conversation_id: "c", flow_id: "f", current_node_id: "o1",
      status: "active", variables: { resposta: "Sacada", __run_generation: "g-site" }, call_stack: [] }],
    chat_contacts: [{ id: "contact", tenant_id: "t" }],
    chat_messages: [],
  })
})

it("depois do Disparar, o fluxo continua no WhatsApp e dorme lá esperando a resposta", async () => {
  const result = await runFlow(input(siteCtx()), flow(), structuredClone(runOf("c")) as never)
  expect(result.status).toBe("responded")

  const wa = runOf("wa")!
  expect(wa).toMatchObject({ flow_id: "f", flow_version: 3, status: "waiting", current_node_id: "sem-resposta" })
  expect(wa.resume_at).toBeTruthy()
  expect(wa.variables.__wait_node__).toBe("w1")
  // As variáveis do fluxo vão junto; o estado interno do fio de origem, não.
  expect(wa.variables.resposta).toBe("Sacada")
  expect(wa.variables["outreach:o1"]).toEqual({ branch: "sent", reason: null })
  expect(wa.variables.__handoff_from).toMatchObject({ conversation_id: "c", run_id: "run-site", node_id: "o1" })
  expect(wa.variables.__run_generation).not.toBe("g-site")

  // O Studio virou a linha de frente do fio WhatsApp, com entrada nova (o despertador confere).
  expect(conv("wa").ai_handling).toBe(true)
  expect(conv("wa").metadata.studio_entry).toBeTruthy()
  expect(wa.variables.__studio_entry).toBe(conv("wa").metadata.studio_entry)

  // O fio de origem terminou com o motivo certo e seguiu o destino de sempre.
  expect(runOf("c")).toMatchObject({ status: "done" })
  expect(runOf("c")!.variables.__ended_reason).toBe("outreach_handoff")
  expect(handBack).toHaveBeenCalledWith("t", "c", "studio_finished", expect.anything())
  expect(handBack).not.toHaveBeenCalledWith("t", "wa", expect.anything(), expect.anything())
})

it("a pessoa responde antes do prazo: o fluxo sai por 'Respondeu' no WhatsApp", async () => {
  await runFlow(input(siteCtx()), flow(), structuredClone(runOf("c")) as never)
  const waCtx = {
    tenantId: "t", conversationId: "wa", channel: "whatsapp", contact: { id: "contact", custom_name: "Marina" },
    conversationMetadata: structuredClone(conv("wa").metadata), departments: [], instance: {}, history: [],
  } as never
  await runFlow(input(waCtx, "Pode sim!"), flow(), structuredClone(runOf("wa")) as never)
  expect(runOf("wa")).toMatchObject({ status: "done" })
  expect(runOf("wa")!.variables.__ended_reason).toBe("end_node")
  expect(runOf("wa")!.variables.__wait_node__).toBeUndefined()
})

it("sem nada depois do Disparar, tudo segue como hoje: o fluxo de origem termina e não nasce run no WhatsApp", async () => {
  await runFlow(input(siteCtx()), flow(false), structuredClone(runOf("c")) as never)
  expect(runOf("wa")).toBeUndefined()
  expect(runOf("c")!.variables.__ended_reason).toBe("flow_end")
  expect(conv("wa").ai_handling).toBe(false)
  expect(handBack).toHaveBeenCalledWith("t", "c", "studio_finished", expect.anything())
})

it("disparo recusado segue pela saída da recusa, no fio de origem, sem bastão", async () => {
  runOutreach.mockResolvedValue({ branch: "blocked", reason: "phone_window" })
  await runFlow(input(siteCtx()), flow(), structuredClone(runOf("c")) as never)
  expect(runOf("wa")).toBeUndefined()
  expect(runOf("c")!.variables["outreach:o1"]).toEqual({ branch: "blocked", reason: "phone_window" })
  expect(runOf("c")!.variables.__ended_reason).toBe("flow_end")
})

it("fio WhatsApp de OUTRO contato nunca recebe o fluxo: para com nota no fio de origem", async () => {
  conv("wa").contact_id = "outra-pessoa"
  await runFlow(input(siteCtx()), flow(), structuredClone(runOf("c")) as never)
  expect(runOf("wa")).toBeUndefined()
  expect(conv("wa").ai_handling).toBe(false)
  const nota = db.tables.chat_messages.find((m) => m.conversation_id === "c" && m.is_private_note)
  expect(nota?.metadata).toMatchObject({ reason: "handoff_failed" })
  expect(runOf("c")!.variables.__ended_reason).toBe("flow_end")
})

it("se a origem for substituída no meio da passagem, o WhatsApp segue mesmo assim", async () => {
  // Outro turno troca o run do site no instante em que a passagem tenta encerrá-lo.
  db.beforeWrite = (table, patch) => {
    if (table === "studio_flow_runs" && (patch.variables as Record<string, unknown> | undefined)?.__ended_reason === "outreach_handoff") {
      runOf("c")!.variables = { substituido: true }
    }
  }
  const result = await runFlow(input(siteCtx()), flow(), structuredClone(runOf("c")) as never)
  expect(result.status).toBe("responded")
  expect(runOf("wa")).toMatchObject({ status: "waiting", current_node_id: "sem-resposta" })
  expect(runOf("c")!.variables).toEqual({ substituido: true })   // o turno novo da origem ficou intacto
})

it("fio WhatsApp que mudou de mãos no meio do caminho não é sequestrado", async () => {
  conv("wa").status = "resolved"
  await runFlow(input(siteCtx()), flow(), structuredClone(runOf("c")) as never)
  expect(runOf("wa")).toBeUndefined()
  expect(db.tables.chat_messages.some((m) => m.metadata?.reason === "handoff_failed")).toBe(true)
})
