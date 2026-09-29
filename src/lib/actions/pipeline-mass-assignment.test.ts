import { beforeEach, describe, expect, it, vi } from "vitest"

const TENANT = "11111111-1111-1111-1111-111111111111"
const writes: Array<{ table: string; payload: Record<string, unknown> }> = []

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "owner-1", tenantId: TENANT, role: "owner" } }),
}))
vi.mock("@/lib/modules", () => ({ requireModule: vi.fn(async () => {}) }))
vi.mock("@/lib/auth/assert-tenant", () => ({ assertSessionTenant: vi.fn(async () => {}) }))
vi.mock("@/lib/visibility", () => ({
  getViewerScope: vi.fn(), applyVisibilityFilter: vi.fn(), canViewConversation: vi.fn(), assertConversationAccess: vi.fn(),
}))
vi.mock("@/lib/lifecycle-stage", () => ({ resolveLifecycle: vi.fn() }))
vi.mock("@/lib/templates/funnels", () => ({ getBlueprint: vi.fn() }))
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => {
        writes.push({ table, payload })
        const builder = {
          error: null,
          eq() { return builder },
        }
        return builder
      },
    }),
  },
}))

const { updatePipeline, updateStage } = await import("./pipeline")
const { updateDealPipeline, updateDealStage } = await import("./deal-pipelines")

beforeEach(() => { writes.length = 0 })

function expectForbiddenKeysAbsent(payload: Record<string, unknown>) {
  expect(payload).not.toHaveProperty("tenant_id")
  expect(payload).not.toHaveProperty("pipeline_id")
  expect(payload).not.toHaveProperty("created_by")
  expect(payload).not.toHaveProperty("active")
}

describe("Server Actions de funis — allow-list em runtime", () => {
  it("remove campos extras no funil de atendimento", async () => {
    await updatePipeline("p1", {
      name: "Nome seguro",
      tenant_id: "tenant-atacante",
      active: false,
    } as never)

    expect(writes[0].table).toBe("pipelines")
    expect(writes[0].payload.name).toBe("Nome seguro")
    expectForbiddenKeysAbsent(writes[0].payload)
  })

  it("remove campos extras na etapa de atendimento", async () => {
    await updateStage("s1", {
      color: "#004add",
      tenant_id: "tenant-atacante",
      pipeline_id: "pipeline-atacante",
    } as never)

    expect(writes).toEqual([{ table: "pipeline_stages", payload: { color: "#004add" } }])
  })

  it("remove campos extras no funil de vendas", async () => {
    await updateDealPipeline("dp1", {
      description: "Descrição segura",
      tenant_id: "tenant-atacante",
      created_by: "outro-owner",
    } as never)

    expect(writes[0].table).toBe("deal_pipelines")
    expect(writes[0].payload.description).toBe("Descrição segura")
    expectForbiddenKeysAbsent(writes[0].payload)
  })

  it("remove campos extras na etapa de vendas", async () => {
    await updateDealStage("ds1", {
      probability_pct: 75,
      tenant_id: "tenant-atacante",
      pipeline_id: "pipeline-atacante",
    } as never)

    expect(writes).toEqual([{ table: "deal_pipeline_stages", payload: { probability_pct: 75 } }])
  })
})
