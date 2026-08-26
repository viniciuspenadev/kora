import { readFileSync } from "node:fs"
import { describe, expect, it, beforeEach, vi } from "vitest"

const state = vi.hoisted(() => ({
  writes: [] as { table: string; kind: "insert" | "update"; payload: Record<string, unknown> }[],
  removals: [] as { tenantId: string; expectedPlanId: string | null }[],
  applications: [] as { tenantId: string; planId: string; guard: Record<string, unknown> }[],
  rpcs: [] as { name: string; payload: Record<string, unknown> }[],
}))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "platform_1", email: "admin@kora.test", isPlatformAdmin: true } }),
}))
vi.mock("@/lib/billing/gateway-limits", () => ({ abaixoDoMinimoDoCartao: () => false }))
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }))
vi.mock("@/lib/plans", () => ({
  applyPlan: vi.fn(async (tenantId: string, planId: string, guard: Record<string, unknown>) => {
    state.applications.push({ tenantId, planId, guard })
    return { ok: true }
  }),
  removePlan: vi.fn(async (tenantId: string, expectedPlanId: string | null) => {
    state.removals.push({ tenantId, expectedPlanId })
    return { ok: true, previousPlanId: expectedPlanId }
  }),
}))

function selectChain(table: string, columns?: string) {
  const response = () => {
    if (table === "module_catalog") return { data: [], error: null }
    if (table === "tenants") return { data: { plan_id: "plan_old" }, error: null }
    if (table === "plans" && columns === "included_modules") {
      return { data: { included_modules: [] }, error: null }
    }
    return {
      data: { name: "Anterior", price_cents: 10_000, active: true, updated_at: "2026-08-21T12:00:00.000Z" },
      error: null,
    }
  }
  const chain = {
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    maybeSingle: async () => response(),
    then: (resolve: (value: ReturnType<typeof response>) => unknown) => Promise.resolve(response()).then(resolve),
  }
  return chain
}

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    rpc: async (name: string, payload: Record<string, unknown>) => {
      state.rpcs.push({ name, payload })
      return { data: [{ atualizado: true, tenants_reaplicados: 2 }], error: null }
    },
    from: (table: string) => ({
      select: (columns?: string) => selectChain(table, columns),
      insert: (payload: Record<string, unknown>) => {
        state.writes.push({ table, kind: "insert", payload })
        return {
          select: () => ({ single: async () => ({ data: { id: "plan_new" }, error: null }) }),
        }
      },
      update: (payload: Record<string, unknown>) => {
        state.writes.push({ table, kind: "update", payload })
        const chain = {
          eq: () => chain,
          in: async () => ({ error: null }),
          then: (resolve: (value: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve),
        }
        return chain
      },
    }),
  },
}))

const { assignPlanToTenant, createPlan, updatePlan } = await import("./admin-plans")

const validInput = {
  name: "Plano Sob Medida 2026",
  description: null,
  price_cents: 10_000,
  user_quota: 3,
  extra_user_price_cents: 2_000,
  included_modules: [],
  pro_modules: [],
  limits: {},
  trial_days: 0,
  trial_activation_mode: "manual",
  active: true,
}

beforeEach(() => {
  state.writes.length = 0
  state.removals.length = 0
  state.applications.length = 0
  state.rpcs.length = 0
})

describe("nomes livres de planos", () => {
  it("preserva nome livre no create sem derivar tier ou plan", async () => {
    const result = await createPlan({ ...validInput, name: "  Plano Sob Medida 2026  " })

    expect(result.error).toBeUndefined()
    const write = state.writes.find((item) => item.table === "plans" && item.kind === "insert")
    expect(write?.payload.name).toBe("Plano Sob Medida 2026")
    expect(write?.payload).not.toHaveProperty("tier")
    expect(write?.payload).not.toHaveProperty("plan")
  })

  it("preserva nome livre no update sem derivar tier ou plan", async () => {
    const result = await updatePlan("plan_1", { ...validInput, name: "Essencial Anual" })

    expect(result.error).toBeUndefined()
    const rpc = state.rpcs.find((item) => item.name === "atualizar_plano_atomico")
    expect(rpc?.payload.p_name).toBe("Essencial Anual")
    expect(rpc?.payload.p_expected_updated_at).toBe("2026-08-21T12:00:00.000Z")
    expect(rpc?.payload).not.toHaveProperty("tier")
    expect(rpc?.payload).not.toHaveProperty("plan")
    expect(state.writes.find((item) => item.table === "plans" && item.kind === "update")).toBeUndefined()
  })

  it.each([
    ["vazio", "   "],
    ["mais de 120 caracteres", "x".repeat(121)],
    ["quebra LF", "Plano\nInjetado"],
    ["quebra CR", "Plano\rInjetado"],
    ["tab", "Plano\tInjetado"],
    ["controle C1", `Plano${String.fromCharCode(0x85)}Injetado`],
    ["separador Unicode", `Plano${String.fromCharCode(0x2028)}Injetado`],
  ])("recusa nome %s antes de escrever", async (_case, name) => {
    const created = await createPlan({ ...validInput, name })
    const updated = await updatePlan("plan_1", { ...validInput, name })

    expect(created.error).toBeTruthy()
    expect(updated.error).toBeTruthy()
    expect(state.writes).toHaveLength(0)
    expect(state.rpcs).toHaveLength(0)
  })
})

describe("contratos administrativos de plano", () => {
  it("remove plano pela RPC atômica e não mantém writers fragmentados", async () => {
    const result = await assignPlanToTenant("tenant_1", null)

    expect(result.error).toBeUndefined()
    expect(state.removals).toEqual([{ tenantId: "tenant_1", expectedPlanId: "plan_old" }])
    expect(state.writes.filter((item) => ["tenants", "tenant_modules"].includes(item.table))).toEqual([])
  })

  it("atribui plano com CAS do plano anterior", async () => {
    const result = await assignPlanToTenant("tenant_1", "plan_new")

    expect(result.error).toBeUndefined()
    expect(state.applications).toEqual([{
      tenantId: "tenant_1",
      planId: "plan_new",
      guard: { expectedCurrentPlanId: "plan_old" },
    }])
  })

  it("criação de tenant recebe plan_id, valida plano ativo e aplica antes do vínculo", () => {
    const source = readFileSync("src/lib/actions/admin.ts", "utf8")
    const validatePlan = source.indexOf('.from("plans")')
    const insertTenant = source.indexOf('.from("tenants")\n    // `plan` não vem')
    const apply = source.indexOf("await applyPlan(tenant.id, planId)")
    const grantOwner = source.indexOf('.from("tenant_users").insert')

    expect(source).toContain('formData.get("plan_id")')
    expect(source).not.toContain('formData.get("plan")')
    expect(source).toContain('.eq("active", true)')
    expect(validatePlan).toBeGreaterThan(-1)
    expect(insertTenant).toBeGreaterThan(validatePlan)
    expect(apply).toBeGreaterThan(insertTenant)
    expect(grantOwner).toBeGreaterThan(apply)
  })
})
