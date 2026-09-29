import { beforeEach, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

// Nó Mover etapa: destino pelo ID; nome só no legado/IA, e resolvido dentro do kanban certo.
// Medido 28/09: "Proposta", "Triagem", "Perdido", "Pós venda" repetem entre kanbans.
vi.mock("server-only", () => ({}))
const db = new MemoryDb()
const move = vi.fn<(input: { stageId: string }) => Promise<{ patch: Record<string, unknown>; warning?: string }>>(async () => ({ patch: {} }))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
vi.mock("@/lib/modules", () => ({ hasModule: async () => true }))
vi.mock("@/lib/atendimento/move-conversation", () => ({ moveAttendanceConversation: move }))
const { moveStageCapability } = await import("./move-stage")

const ctx = { tenantId: "t", conversationId: "c" } as unknown as Parameters<typeof moveStageCapability.run>[0]
const movedTo = () => (move.mock.calls.at(-1)?.[0] as { stageId: string } | undefined)?.stageId

beforeEach(() => {
  move.mockClear()
  db.reset({
    pipeline_stages: [
      { id: "vendas-proposta",  tenant_id: "t", pipeline_id: "vendas",  name: "Proposta" },
      { id: "suporte-proposta", tenant_id: "t", pipeline_id: "suporte", name: "Proposta" },
      { id: "vendas-novo",      tenant_id: "t", pipeline_id: "vendas",  name: "Novo" },
      { id: "outro-tenant",     tenant_id: "x", pipeline_id: "vendas",  name: "Fechado" },
    ],
    chat_conversations: [{ id: "c", tenant_id: "t", pipeline_id: "suporte" }],
  })
})

it("destino pelo ID do nó, mesmo com o nome repetido em outro kanban", async () => {
  const r = await moveStageCapability.run(ctx, { stage: "Proposta", stage_id: "vendas-proposta", pipeline_id: "vendas" })
  expect(r.ok).toBe(true); expect(movedTo()).toBe("vendas-proposta")
})

it("etapa apagada: erro claro, nunca adivinha pelo nome", async () => {
  const r = await moveStageCapability.run(ctx, { stage: "Proposta", stage_id: "apagada" })
  expect(r.ok).toBe(false); expect(r.error).toContain("não existe mais"); expect(move).not.toHaveBeenCalled()
})

it("etapa de outra empresa não é alcançável pelo ID", async () => {
  const r = await moveStageCapability.run(ctx, { stage_id: "outro-tenant" })
  expect(r.ok).toBe(false); expect(move).not.toHaveBeenCalled()
})

it("nome ambíguo (legado/IA): vale o kanban em que a conversa já está", async () => {
  const r = await moveStageCapability.run(ctx, { stage: "proposta" })
  expect(r.ok).toBe(true); expect(movedTo()).toBe("suporte-proposta")
})

it("nome + kanban informado resolve dentro dele", async () => {
  const r = await moveStageCapability.run(ctx, { stage: "Proposta", pipeline_id: "vendas" })
  expect(r.ok).toBe(true); expect(movedTo()).toBe("vendas-proposta")
})

it("nome ambíguo e conversa em um terceiro kanban: recusa pedindo o kanban", async () => {
  db.tables.chat_conversations[0].pipeline_id = "outro"
  const r = await moveStageCapability.run(ctx, { stage: "Proposta" })
  expect(r.ok).toBe(false); expect(r.error).toContain("escolha o kanban"); expect(move).not.toHaveBeenCalled()
})

it("nome único continua funcionando como antes", async () => {
  const r = await moveStageCapability.run(ctx, { stage: "Novo" })
  expect(r.ok).toBe(true); expect(movedTo()).toBe("vendas-novo")
})
