import { beforeEach, describe, expect, it, vi } from "vitest"
import { FakeDb } from "@/test/fakes/fake-db"

const db = new FakeDb()

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: (table: string) => db.from(table),
    rpc: (name: string, args: Record<string, unknown>) => db.rpc(name, args),
  },
}))

const { resolveLimitMax } = await import("./limits")

const TENANT = "11111111-1111-1111-1111-111111111111"

function seedTenant(row: Record<string, unknown>) {
  db.seed("tenants", [{ id: TENANT, ...row }])
  db.seed("tenant_limits", [])
}

beforeEach(() => {
  db.tabelas.clear()
  db.log.length = 0
  db.seed("tenant_limits", [])
})

describe("limites do catálogo são fail-closed", () => {
  it("com plan_id, chave ausente vale zero e não herda ilimitado pelo nome legado", async () => {
    seedTenant({ plan_id: "plan-1", plan: "enterprise", plans: { limits: {} } })

    await expect(resolveLimitMax(TENANT, "contacts")).resolves.toEqual({
      max: 0,
      source: "plan",
    })
  })

  it("com plan_id, null explícito continua significando ilimitado", async () => {
    seedTenant({ plan_id: "plan-1", plan: "trial", plans: { limits: { contacts: null } } })

    await expect(resolveLimitMax(TENANT, "contacts")).resolves.toEqual({
      max: null,
      source: "plan",
    })
  })

  it("com plan_id, zero explícito continua significando bloqueado", async () => {
    seedTenant({ plan_id: "plan-1", plan: "enterprise", plans: { limits: { contacts: 0 } } })

    await expect(resolveLimitMax(TENANT, "contacts")).resolves.toEqual({
      max: 0,
      source: "plan",
    })
  })

  it("com plan_id, renomear o tier legado não altera o limite do catálogo", async () => {
    seedTenant({ plan_id: "plan-1", plan: "trial", plans: { limits: { contacts: 37 } } })
    const antes = await resolveLimitMax(TENANT, "contacts")
    db.linhas("tenants")[0].plan = "enterprise"

    const depois = await resolveLimitMax(TENANT, "contacts")

    expect(antes).toEqual({ max: 37, source: "plan" })
    expect(depois).toEqual(antes)
  })

  it("com plan_id, valor inválido não ganha fallback e vale zero", async () => {
    seedTenant({ plan_id: "plan-1", plan: "enterprise", plans: { limits: { contacts: "sem limite" } } })

    await expect(resolveLimitMax(TENANT, "contacts")).resolves.toEqual({
      max: 0,
      source: "plan",
    })
  })

  it("com plan_id apontando para plano ausente, vale zero", async () => {
    seedTenant({ plan_id: "plan-removido", plan: "enterprise", plans: null })

    await expect(resolveLimitMax(TENANT, "contacts")).resolves.toEqual({
      max: 0,
      source: "plan",
    })
  })

  it("erro ao ler tenant/plano vale zero, sem presumir trial", async () => {
    seedTenant({ plan_id: "plan-1", plan: "enterprise", plans: { limits: { contacts: null } } })
    db.falharEm({ tabela: "tenants", op: "select", vezes: 1 })
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(resolveLimitMax(TENANT, "contacts")).resolves.toEqual({
      max: 0,
      source: "plan",
    })
    expect(errorLog).toHaveBeenCalledOnce()
    expect(errorLog).toHaveBeenCalledWith(
      "[limits] tenant_plan:",
      JSON.stringify({
        tenantId: TENANT,
        resource: "contacts",
        code: "unknown",
        message: "falha simulada em select tenants",
      }),
    )
    errorLog.mockRestore()
  })

  it("erro ao ler overrides vale zero, sem conceder o limite do plano", async () => {
    seedTenant({ plan_id: "plan-1", plan: "trial", plans: { limits: { contacts: 50 } } })
    db.falharEm({ tabela: "tenant_limits", op: "select", vezes: 1 })
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(resolveLimitMax(TENANT, "contacts")).resolves.toEqual({
      max: 0,
      source: "plan",
    })
    expect(errorLog).toHaveBeenCalledOnce()
    expect(errorLog).toHaveBeenCalledWith(
      "[limits] tenant_override:",
      JSON.stringify({
        tenantId: TENANT,
        resource: "contacts",
        code: "unknown",
        message: "falha simulada em select tenant_limits",
      }),
    )
    errorLog.mockRestore()
  })
})

describe("compatibilidade legada", () => {
  it("usa tenants.plan somente quando plan_id é null", async () => {
    seedTenant({ plan_id: null, plan: "enterprise", plans: null })

    await expect(resolveLimitMax(TENANT, "contacts")).resolves.toEqual({
      max: null,
      source: "default",
    })
  })

  it("override vigente continua prevalecendo sobre o catálogo", async () => {
    seedTenant({ plan_id: "plan-1", plan: "trial", plans: { limits: { contacts: 10 } } })
    db.seed("tenant_limits", [{
      tenant_id: TENANT,
      resource: "contacts",
      max_value: 25,
      expires_at: null,
    }])

    await expect(resolveLimitMax(TENANT, "contacts")).resolves.toEqual({
      max: 25,
      source: "override",
    })
  })
})
