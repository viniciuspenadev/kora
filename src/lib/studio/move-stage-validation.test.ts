import { beforeEach, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

vi.mock("server-only", () => ({}))
const db = new MemoryDb()
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
const { validateMoveStagePublish } = await import("./move-stage-validation")
type Graph = Parameters<typeof validateMoveStagePublish>[1]
const graph = (config: Record<string, unknown>) => ({ nodes: [{ id: "n", type: "move_stage", config }], edges: [] } as unknown as Graph)

beforeEach(() => db.reset({
  pipeline_stages: [
    { id: "vp", tenant_id: "t", pipeline_id: "vendas",  name: "Proposta", show_in_kanban: true,  is_triage: false },
    { id: "sp", tenant_id: "t", pipeline_id: "suporte", name: "Proposta", show_in_kanban: true,  is_triage: false },
    { id: "oc", tenant_id: "t", pipeline_id: "vendas",  name: "Arquivo",  show_in_kanban: false, is_triage: false },
    { id: "tr", tenant_id: "t", pipeline_id: "vendas",  name: "Triagem",  show_in_kanban: false, is_triage: true },
  ],
}))

it("publica com etapa escolhida pelo ID", async () => {
  expect(await validateMoveStagePublish("t", graph({ pipelineId: "vendas", stageId: "vp" }))).toBeNull()
})
it("recusa etapa apagada ou de outro kanban", async () => {
  expect(await validateMoveStagePublish("t", graph({ stageId: "sumiu" }))).toContain("não existe mais")
  expect(await validateMoveStagePublish("t", graph({ pipelineId: "vendas", stageId: "sp" }))).toContain("não existe mais")
})
it("recusa etapa oculta no kanban; triagem oculta é aceita (mesma regra do motor)", async () => {
  expect(await validateMoveStagePublish("t", graph({ stageId: "oc" }))).toContain("oculta")
  expect(await validateMoveStagePublish("t", graph({ stageId: "tr" }))).toBeNull()
})
it("nó antigo só com nome: ambíguo entre kanbans não publica", async () => {
  expect(await validateMoveStagePublish("t", graph({ stage: "Proposta" }))).toContain("mais de um kanban")
  expect(await validateMoveStagePublish("t", graph({ stage: "Proposta", pipelineId: "vendas" }))).toBeNull()
})
it("nó sem destino não publica", async () => {
  expect(await validateMoveStagePublish("t", graph({}))).toContain("Escolha o kanban e a etapa")
})
