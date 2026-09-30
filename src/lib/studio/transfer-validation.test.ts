import { beforeEach, expect, it, vi } from "vitest"
import { MemoryDb } from "@/test/supabase-memory"

vi.mock("server-only", () => ({}))
const db = new MemoryDb()
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: db }))
const { validateTransferPublish } = await import("./transfer-validation")
type Graph = Parameters<typeof validateTransferPublish>[1]

const MIUKY = "11111111-1111-4111-8111-111111111111"
const graph = (config: Record<string, unknown>, extra: { type: string }[] = []) =>
  ({ nodes: [{ id: "n", type: "transfer", config }, ...extra.map((e, i) => ({ id: `x${i}`, type: e.type, config: {} }))], edges: [] } as unknown as Graph)

beforeEach(() => db.reset({
  tenant_users: [{ tenant_id: "t", user_id: MIUKY, active: true }],
  studio_distribution_cursors: [],
}))

it("recusa “Manter a IA atendendo” — nem com Agente IA ela punha a IA pra conversar", async () => {
  for (const extra of [[], [{ type: "ai_agent" }]]) {
    expect(await validateTransferPublish("t", graph({ target: "department", department: "Setor", whenUnavailable: "keep_ai" }, extra)))
      .toContain("não está mais disponível")
  }
})

it("aceita variáveis do fluxo nas mensagens — agora elas são trocadas no envio", async () => {
  expect(await validateTransferPublish("t", graph({ target: "department", department: "Setor", handoff: "Oi {{nome}}!" }))).toBeNull()
  // Antes: "Use somente {{agente}}" recusava {{nome}} na apresentação do atendente.
  expect(await validateTransferPublish("t", graph({ target: "agent", agentId: MIUKY, handoff: "Oi {{nome}}, sou {{agente}}." }))).toBeNull()
})

it("{{agente}} só em destino que escolhe uma pessoa — na mensagem de espera também", async () => {
  expect(await validateTransferPublish("t", graph({ target: "pool", waitMessage: "Já te chamo, {{agente}}" })))
    .toContain("{{agente}} só funciona")
  expect(await validateTransferPublish("t", graph({ target: "department", department: "Setor", handoff: "Sou {{agente}}" })))
    .toContain("{{agente}} só funciona")
})

it("atendente desativado depois de configurado bloqueia a publicação", async () => {
  db.tables.tenant_users[0].active = false
  expect(await validateTransferPublish("t", graph({ target: "agent", agentId: MIUKY }))).toContain("removido ou desativado")
})
