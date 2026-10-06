import { beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

// Formulário enviado → fluxo do Studio. Nunca um pedido parado calado: se o Kora não chamou,
// donos e admins são avisados; e cada resposta dispara no máximo UMA vez.
vi.mock("server-only", () => ({}))
const db = new MemoryDb()
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
let studioOn = true
vi.mock("@/lib/modules", () => ({ hasModule: async (_t: string, slug: string) => (slug === "ai_studio" ? studioOn : true) }))
let serviceable = true
vi.mock("@/lib/auth/tenant-serviceable", () => ({ isTenantServiceable: async () => serviceable }))
vi.mock("@/lib/ai-v2/studio-config", () => ({ loadStudioConfig: async () => ({ ai_model: "gpt-x", ai_name: "Bia", ai_tone: null, ai_language: "pt", identity_text: null, communication_style_text: null, anti_patterns_text: null }) }))
const runFormEntry = vi.fn()
vi.mock("@/lib/ai-v2/flow/runtime", () => ({ runFormEntry }))
type Aviso = { recipientId: string; type: string; body: string; payload: Record<string, unknown> }
const notify = vi.fn<(n: Aviso) => Promise<void>>(async () => {})
vi.mock("@/lib/notifications", () => ({ createNotification: notify }))

const { startFormAutomation } = await import("./automation")
const { templateDefinition } = await import("./templates")

const T = "11111111-1111-4111-8111-111111111111"
const F = "33333333-3333-4333-8333-333333333333"
const sub = (over: Record<string, unknown> = {}) => ({
  id: "s-1", tenant_id: T, form_id: F, version_id: "v-1", contact_id: "c-1", contact_name: "Marina Lopes",
  phone_e164: "5547998124471", answers: { servico: "orcamento_novo" }, source: { kind: "link" }, outcome: "received",
  created_at: "2026-10-05T12:00:00Z", conversation_id: null, ...over,
})
const flowRow = (over: Record<string, unknown> = {}) => ({
  id: "flow-1", tenant_id: T, name: "Orçamento → chamar", version: 1, status: "published", active: true, updated_at: "2026-10-01",
  trigger: { type: "form_submitted", formId: F }, graph: { nodes: [], edges: [] }, ...over,
})

beforeEach(() => {
  studioOn = true; serviceable = true
  runFormEntry.mockReset(); notify.mockClear()
  runFormEntry.mockResolvedValue({ outcome: "sent", conversationId: "wa-1" })
  db.reset({
    form_submissions: [sub()],
    forms: [{ id: F, tenant_id: T, name: "Orçamento guiado" }],
    form_versions: [{ id: "v-1", tenant_id: T, form_id: F, definition: templateDefinition("quote_guided") }],
    studio_flows: [flowRow()],
    chat_contacts: [{ id: "c-1", tenant_id: T, custom_name: "Marina", push_name: null, phone_number: "554799999999", lifecycle_stage: "lead" }],
    tenant_users: [
      { tenant_id: T, user_id: "dono", role: "owner", active: true },
      { tenant_id: T, user_id: "adm", role: "admin", active: true },
      { tenant_id: T, user_id: "atendente", role: "agent", active: true },
      { tenant_id: T, user_id: "ex", role: "admin", active: false },
    ],
    tenant_departments: [], tags: [], pipeline_stages: [], tenant_services: [], tenant_resources: [],
  })
})

describe("o Kora chama quem enviou", () => {
  it("roda o fluxo do formulário sem conversa, para o número DIGITADO, com as respostas legíveis", async () => {
    expect(await startFormAutomation(T, "s-1")).toBe("sent")
    const [input, flow, seed] = runFormEntry.mock.calls[0]
    expect(flow.id).toBe("flow-1")
    expect(input.ctx).toMatchObject({ tenantId: T, conversationId: "", channel: "form", contact: { id: "c-1", phone_number: "5547998124471" } })
    expect(seed).toMatchObject({ formId: F, submissionId: "s-1",
      variables: { primeiro_nome: "Marina", resposta: { servico: "Orçamento novo" }, formulario: "Orçamento guiado", origem: "link próprio" } })
    expect(db.tables.form_submissions[0]).toMatchObject({ outcome: "sent", conversation_id: "wa-1" })
    expect(notify).not.toHaveBeenCalled()
  })
  it("quem atende vê o pedido inteiro: nota interna na conversa, que o cliente não vê", async () => {
    runFormEntry.mockImplementation(async (_i: unknown, _f: unknown, s: { onConversation: (id: string) => Promise<void> }) => {
      await s.onConversation("wa-1")
      return { outcome: "sent", conversationId: "wa-1" }
    })
    db.tables.chat_messages = []
    await startFormAutomation(T, "s-1")
    expect(db.tables.chat_messages).toHaveLength(1)
    expect(db.tables.chat_messages[0]).toMatchObject({ conversation_id: "wa-1", tenant_id: T, is_private_note: true, sender_type: "system",
      metadata: { form: { form_id: F, submission_id: "s-1", formName: "Orçamento guiado",
        items: [expect.objectContaining({ value: "Orçamento novo" })], origin: { label: "link próprio", page: "", campaign: "" } } } })
    expect(db.tables.chat_messages[0].content).toContain("📝 Pedido pelo formulário “Orçamento guiado”")
  })
  it("já em atendimento: a resposta guarda a conversa do atendente (para abrir dali)", async () => {
    runFormEntry.mockResolvedValue({ outcome: "blocked", reason: "human_attendance", conversationId: "wa-ana" })
    expect(await startFormAutomation(T, "s-1")).toBe("in_attendance")
    expect(db.tables.form_submissions[0]).toMatchObject({ outcome: "in_attendance", conversation_id: "wa-ana" })
  })
  it("cada resposta dispara uma vez só (a segunda chamada não faz nada)", async () => {
    await startFormAutomation(T, "s-1")
    expect(await startFormAutomation(T, "s-1")).toBeNull()
    expect(runFormEntry).toHaveBeenCalledTimes(1)
  })
  it("trava segurou → 'segurada' e donos/admins ATIVOS são avisados, com o link das respostas", async () => {
    runFormEntry.mockResolvedValue({ outcome: "blocked", reason: "phone_window" })
    expect(await startFormAutomation(T, "s-1")).toBe("throttled")
    expect(notify.mock.calls.map((c) => c[0].recipientId).sort()).toEqual(["adm", "dono"])
    expect(notify.mock.calls[0][0]).toMatchObject({ type: "form_needs_contact", payload: { url: `/formularios/${F}?aba=respostas` } })
    expect(notify.mock.calls[0][0].body).toContain("(47) 99812-4471")
  })
  it("já em atendimento: não avisa os donos (o responsável já foi avisado pelo Disparar)", async () => {
    runFormEntry.mockResolvedValue({ outcome: "blocked", reason: "human_attendance" })
    expect(await startFormAutomation(T, "s-1")).toBe("in_attendance")
    expect(notify).not.toHaveBeenCalled()
  })
})

describe("o Kora NÃO chama — e avisa", () => {
  it("sem fluxo ligado ao formulário", async () => {
    db.tables.studio_flows = [flowRow({ trigger: { type: "form_submitted", formId: "outro-form" } })]
    expect(await startFormAutomation(T, "s-1")).toBe("no_flow")
    expect(runFormEntry).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledTimes(2)
  })
  it("fluxo pausado ou rascunho não conta", async () => {
    db.tables.studio_flows = [flowRow({ active: false }), flowRow({ id: "rascunho", status: "draft" })]
    expect(await startFormAutomation(T, "s-1")).toBe("no_flow")
  })
  it("sem o módulo Studio ou com a empresa fora do ar para gasto", async () => {
    studioOn = false
    expect(await startFormAutomation(T, "s-1")).toBe("no_flow")
    db.tables.form_submissions[0].outcome = "received"; studioOn = true; serviceable = false
    expect(await startFormAutomation(T, "s-1")).toBe("no_flow")
    expect(runFormEntry).not.toHaveBeenCalled()
  })
  it("resposta sem ficha ou fluxo que quebrou: 'o fluxo parou', e avisa", async () => {
    db.tables.form_submissions[0].contact_id = null
    expect(await startFormAutomation(T, "s-1")).toBe("flow_error")
    expect(notify).toHaveBeenCalled()
    db.tables.form_submissions[0] = sub({ id: "s-2" })
    runFormEntry.mockRejectedValue(new Error("boom"))
    expect(await startFormAutomation(T, "s-2")).toBe("flow_error")
  })
  it("de outra empresa não roda", async () => {
    expect(await startFormAutomation("22222222-2222-4222-8222-222222222222", "s-1")).toBeNull()
    expect(runFormEntry).not.toHaveBeenCalled()
  })
})
