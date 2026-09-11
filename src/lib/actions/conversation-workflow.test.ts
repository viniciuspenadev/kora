import { beforeEach, describe, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({ lifecycle: "contact", denied: false, failWrite: false, failCAS: false, tables: [] as string[], writes: [] as Record<string, unknown>[], filters: [] as Array<[string, unknown]> }))
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/modules", () => ({ hasModule: vi.fn() }))
vi.mock("@/lib/visibility", () => ({ assertConversationAccess: async () => { if (state.denied) throw new Error("Sem acesso"); return { scope: { tenantId: "t1", userId: "a1" } } } }))
vi.mock("@/lib/actions/tags", () => ({ applyTag: vi.fn(), removeTag: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from(table: string) {
  let patch: Record<string, unknown> | undefined; const filters: Array<[string, unknown]> = []
  const builder = { select: () => builder, eq: (k: string, v: unknown) => { filters.push([k, v]); return builder },
    update: (p: Record<string, unknown>) => { patch = p; state.tables.push(table); return builder }, maybeSingle: async () => {
      state.filters.push(...filters)
      if (table === "chat_conversations") return { data: { contact_id: "ct1", is_group: false }, error: null }
      if (state.failWrite) return { data: null, error: { message: "failure" } }
      if (patch && state.failCAS) return { data: null, error: null }
      if (filters.some(([k, v]) => k === "lifecycle_stage" && v !== state.lifecycle)) return { data: null, error: null }
      if (patch) { state.writes.push(patch); state.lifecycle = String(patch.lifecycle_stage) }
      return { data: { id: "ct1", lifecycle_stage: state.lifecycle, updated_at: "v1", qualified_at: null }, error: null }
    } }
  return builder
} } }))
const { qualifyConversationContact, classifyConversationContact, updateConversationContactTags } = await import("./conversation-workflow")
const { applyTag, removeTag } = await import("./tags")
beforeEach(() => { state.lifecycle = "contact"; state.denied = false; state.failWrite = false; state.failCAS = false; state.tables = []; state.writes = []; state.filters = []; vi.clearAllMocks() })
describe("ações do contato via conversa", () => {
  it("qualifica somente o contato, com filtro de tenant e estado", async () => {
    await qualifyConversationContact("c1")
    expect(state.writes).toHaveLength(1)
    expect(state.writes[0]).toMatchObject({ lifecycle_stage: "lead", qualified_by: "a1" })
    expect(state.writes[0]).not.toHaveProperty("pipeline_id")
    expect(state.filters).toContainEqual(["tenant_id", "t1"])
    expect(state.filters).toContainEqual(["lifecycle_stage", "contact"])
  })
  it.each(["customer", "won", "lead", "unfit"])("não rebaixa/requalifica automaticamente %s", async stage => {
    state.lifecycle = stage
    await expect(qualifyConversationContact("c1")).rejects.toThrow("classificação")
    expect(state.writes).toHaveLength(0)
  })
  it("falha de gravação não informa sucesso", async () => {
    state.failWrite = true
    await expect(qualifyConversationContact("c1")).rejects.toThrow("Não foi possível")
  })
  it("aplica só diferenças explícitas de etiquetas", async () => {
    await updateConversationContactTags("c1", ["new", "new"], ["old"])
    expect(applyTag).toHaveBeenCalledExactlyOnceWith("new", "contact", "ct1")
    expect(removeTag).toHaveBeenCalledExactlyOnceWith("old", "contact", "ct1")
  })
  it("nega etiquetas quando a conversa não é acessível", async () => {
    state.denied = true
    await expect(updateConversationContactTags("c1", ["new"], [])).rejects.toThrow("Sem acesso")
    expect(applyTag).not.toHaveBeenCalled()
  })
})

describe("classificação explícita", () => {
  it.each(["lead", "customer", "unfit"] as const)("salva %s somente no contato", async stage => {
    await classifyConversationContact("c1", { stage, expectedUpdatedAt: "v1", reason: " Sem perfil " })
    expect(state.tables).toEqual(["chat_contacts"])
    expect(state.writes[0]).toMatchObject({ lifecycle_stage: stage, unfit_reason: stage === "unfit" ? "Sem perfil" : null })
    expect(state.filters).toContainEqual(["tenant_id", "t1"])
    expect(state.filters).toContainEqual(["id", "ct1"])
    expect(state.filters).toContainEqual(["updated_at", "v1"])
  })
  it("permite reavaliar Sem fit como Lead", async () => {
    state.lifecycle = "unfit"
    await classifyConversationContact("c1", { stage: "lead", expectedUpdatedAt: "v1" })
    expect(state.writes[0]).toMatchObject({ lifecycle_stage: "lead", unfit_reason: null })
  })
  it.each(["customer", "won"])("protege %s contra rebaixamento", async lifecycle => {
    state.lifecycle = lifecycle
    await expect(classifyConversationContact("c1", { stage: "unfit", expectedUpdatedAt: "v1" })).rejects.toThrow("rebaixado")
    expect(state.tables).toEqual([])
  })
  it("recusa revisão desatualizada antes de escrever", async () => {
    await expect(classifyConversationContact("c1", { stage: "lead", expectedUpdatedAt: "v0" })).rejects.toThrow("mudou")
    expect(state.tables).toEqual([])
  })
  it("detecta alteração entre leitura e escrita", async () => {
    state.failCAS = true
    await expect(classifyConversationContact("c1", { stage: "lead", expectedUpdatedAt: "v1" })).rejects.toThrow("durante")
    expect(state.writes).toEqual([])
  })
  it("nega classificação sem acesso", async () => {
    state.denied = true
    await expect(classifyConversationContact("c1", { stage: "lead", expectedUpdatedAt: "v1" })).rejects.toThrow("Sem acesso")
    expect(state.tables).toEqual([])
  })
  it("recusa valor não permitido recebido do navegador", async () => {
    await expect(classifyConversationContact("c1", { stage: "admin" as "lead", expectedUpdatedAt: "v1" })).rejects.toThrow("inválida")
    expect(state.tables).toEqual([])
  })
})
