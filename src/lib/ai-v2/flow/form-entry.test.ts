import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

// Formulário → Studio (Fase 3): o trecho ANTES de existir conversa roda na hora, sem gravar
// run nem nota; o Disparar abre o fio WhatsApp e o fluxo nasce lá, no nó seguinte.
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
const tagRun = vi.fn(async () => ({ ok: true }))
vi.mock("@/lib/ai-v2/capabilities", () => ({
  ensureCapabilitiesRegistered: () => {}, getCapability: (id: string) => (id === "tag" ? { run: tagRun } : null),
  TRANSFER: "transfer", HTTP_REQUEST: "http", TAG: "tag", MOVE_STAGE: "move_stage",
}))
vi.mock("@/lib/atendimento/human-routing", () => ({ routeToHumanDefault: vi.fn(async () => {}) }))
const runOutreach = vi.fn()
vi.mock("@/lib/ai-v2/flow/outreach", () => ({ runOutreach }))

const { runFormEntry } = await import("./runtime")

const nodes = [
  { id: "start", type: "start", config: {} },
  // Box vai para outra etiqueta antes de chamar — o "separar por resposta" do desenho.
  { id: "sw", type: "switch", config: { variable: "resposta.servico", cases: [{ id: "box", equals: "Box" }] } },
  { id: "tag-box", type: "tag", config: { tag: "Box", action: "add" } },
  { id: "chamar", type: "outreach", config: { channel: "baileys", text: "Oi {{primeiro_nome}}! Recebemos: {{resposta.servico}}" } },
  { id: "esperar", type: "wait", config: { amount: 2, unit: "hours" } },
  { id: "fim", type: "end", config: {} },
  { id: "tag-sem", type: "tag", config: { tag: "Sem WhatsApp", action: "add" } },
]
const edges = [
  { from: "start", to: "sw" },
  { from: "sw", to: "tag-box", branch: "box" },
  { from: "sw", to: "chamar", branch: "else" },
  { from: "tag-box", to: "chamar" },
  { from: "chamar", to: "esperar", branch: "sent" },
  { from: "chamar", to: "tag-sem", branch: "no_whatsapp" },
  { from: "esperar", to: "fim" },
]
const flow = (g = { nodes, edges }) => ({ id: "f", tenant_id: "t", version: 2, graph: g }) as never
const formCtx = () => ({
  tenantId: "t", conversationId: "", channel: "form", contact: { id: "contact", custom_name: "Marina Lopes", phone_number: "5547998124471" },
  conversationMetadata: {}, departments: [], instance: null, history: [],
}) as never
const input = () => ({ ctx: formCtx(), model: "m", persona: {}, history: [], incomingText: "" }) as never
const seed = (servico = "Sacada") => ({
  variables: { nome: "Marina Lopes", primeiro_nome: "Marina", resposta: { servico }, formulario: "Orçamento", __run_started_at: "2026-10-05T12:00:00Z" },
  formId: "form-1", submissionId: "sub-1",
})
const runOf = (conversationId: string) => db.tables.studio_flow_runs.find((r) => r.conversation_id === conversationId)

beforeEach(() => {
  runOutreach.mockReset(); tagRun.mockClear()
  runOutreach.mockResolvedValue({ branch: "sent", conversationId: "wa" })
  db.reset({
    chat_conversations: [{ id: "wa", tenant_id: "t", status: "open", channel: "whatsapp", contact_id: "contact", instance_id: "i1",
      metadata: {}, updated_at: "t1", ai_handling: false, assigned_to: null }],
    whatsapp_instances: [{ id: "i1", tenant_id: "t", provider: "baileys", instance_name: "kora" }],
    studio_flow_runs: [],
    chat_contacts: [{ id: "contact", tenant_id: "t" }],
    chat_messages: [],
  })
})

describe("formulário enviado → o Kora chama no WhatsApp", () => {
  it("o Disparar sai para o número do formulário, com o texto interpolado e a origem 'form' na trava", async () => {
    const r = await runFormEntry(input(), flow(), seed())
    expect(r).toEqual({ outcome: "sent", conversationId: "wa" })
    expect(runOutreach).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      channel: "baileys", phoneRaw: "5547998124471", text: "Oi Marina! Recebemos: Sacada",
      origin: "form", flowId: "f", formId: "form-1", submissionId: "sub-1",
    }))
  })
  it("depois do Disparar o fluxo nasce no WhatsApp, no nó seguinte, e espera lá a resposta", async () => {
    await runFormEntry(input(), flow(), seed())
    const wa = runOf("wa")!
    expect(wa).toMatchObject({ flow_id: "f", status: "waiting", current_node_id: "fim" })
    expect(wa.variables.resposta).toEqual({ servico: "Sacada" })
    expect(wa.variables.__handoff_from).toMatchObject({ form_submission_id: "sub-1", node_id: "chamar" })
    expect(db.tables.chat_conversations[0].ai_handling).toBe(true)
  })
  it("separar por resposta antes de chamar: Box ganha a etiqueta e segue para o Disparar", async () => {
    await runFormEntry(input(), flow(), seed("Box"))
    expect(tagRun).toHaveBeenCalledWith(expect.anything(), { tag: "Box", action: "add" })
    expect(runOutreach).toHaveBeenCalledTimes(1)
  })
  it("sem WhatsApp: segue pela saída da recusa SEM conversa — nenhum run, nenhuma nota", async () => {
    runOutreach.mockResolvedValue({ branch: "no_whatsapp", reason: "send_failed" })
    const r = await runFormEntry(input(), flow(), seed())
    expect(r).toEqual({ outcome: "no_whatsapp", reason: "send_failed" })
    expect(tagRun).toHaveBeenCalledWith(expect.anything(), { tag: "Sem WhatsApp", action: "add" })
    expect(db.tables.studio_flow_runs).toHaveLength(0)
    expect(db.tables.chat_messages).toHaveLength(0)
  })
  it("a nota do pedido entra na conversa ANTES de o fluxo seguir lá (vem antes de um Transferir)", async () => {
    const order: string[] = []
    const onConversation = vi.fn(async (id: string) => { order.push(`nota:${id}`) })
    runOutreach.mockImplementation(async () => { order.push("enviou"); return { branch: "sent", conversationId: "wa" } })
    await runFormEntry(input(), flow(), { ...seed(), onConversation })
    expect(order).toEqual(["enviou", "nota:wa"])
    expect(runOf("wa")).toBeDefined()
  })
  it("já com atendente: nada é enviado, mas o pedido é anotado na conversa dele", async () => {
    runOutreach.mockResolvedValue({ branch: "blocked", reason: "human_attendance", conversationId: "wa-ana" })
    const onConversation = vi.fn(async () => {})
    expect(await runFormEntry(input(), flow(), { ...seed(), onConversation }))
      .toEqual({ outcome: "blocked", reason: "human_attendance", conversationId: "wa-ana" })
    expect(onConversation).toHaveBeenCalledWith("wa-ana")
  })
  it("nota que falha não para o fluxo", async () => {
    await runFormEntry(input(), flow(), { ...seed(), onConversation: async () => { throw new Error("banco") } })
    expect(runOf("wa")).toMatchObject({ status: "waiting" })
  })
  it("trava segurou: o motivo volta para a situação do comprovante", async () => {
    runOutreach.mockResolvedValue({ branch: "blocked", reason: "phone_window" })
    expect(await runFormEntry(input(), flow(), seed())).toEqual({ outcome: "blocked", reason: "phone_window" })
  })
  it("🔴 nó que fala com a pessoa antes do Disparar NÃO roda (fluxo antigo/importado): para, sem enviar nada", async () => {
    const g = { nodes: [{ id: "start", type: "start", config: {} }, { id: "msg", type: "message", config: { text: "Oi" } }, nodes[3]],
      edges: [{ from: "start", to: "msg" }, { from: "msg", to: "chamar" }] }
    expect(await runFormEntry(input(), flow(g as never), seed())).toEqual({ outcome: "stopped", reason: "node:message" })
    expect(runOutreach).not.toHaveBeenCalled()
    expect(db.tables.chat_messages).toHaveLength(0)
  })
  it("fluxo sem Disparar termina como 'ended' (ninguém foi chamado)", async () => {
    const g = { nodes: [{ id: "start", type: "start", config: {} }, { id: "fim", type: "end", config: {} }], edges: [{ from: "start", to: "fim" }] }
    expect(await runFormEntry(input(), flow(g as never), seed())).toEqual({ outcome: "ended" })
  })
  it("Disparar enviado sem nada depois: não nasce run no WhatsApp (a conversa segue o atendimento)", async () => {
    const g = { nodes: [nodes[0], nodes[3]], edges: [{ from: "start", to: "chamar" }] }
    expect(await runFormEntry(input(), flow(g as never), seed())).toEqual({ outcome: "sent", conversationId: "wa" })
    expect(runOf("wa")).toBeUndefined()
  })
})
