import { beforeEach, describe, expect, it, vi } from "vitest"
import { FakeDb } from "@/test/fakes/fake-db"

const db = new FakeDb()
const logAuditMock = vi.fn<(input: unknown) => Promise<void>>(async () => {})
const cancelSubscriptionMock = vi.fn<(tenantId: string) => Promise<{ ok: true }>>(async () => ({ ok: true }))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table) },
}))
vi.mock("@/lib/audit", () => ({
  logAudit: (input: unknown) => logAuditMock(input),
}))
vi.mock("@/lib/auth/revoke-tenant-access", () => ({
  revokeTenantAccess: async () => ({
    sessions: 0,
    extensionTokens: 0,
    pushSubscriptions: 0,
    deviceTrust: 0,
    errors: [],
  }),
}))
vi.mock("@/lib/channels/pause", () => ({
  pausarCanaisDoTenant: async () => ({ pausados: [], falhas: [], pendentes: [] }),
  canaisDerrubados: async () => [],
}))
vi.mock("@/lib/asaas/subscriptions", () => ({
  cancelSubscriptionForTenant: (tenantId: string) => cancelSubscriptionMock(tenantId),
}))

const { transitionLifecycleCore } = await import("./lifecycle-core")

const MANUAL = "11111111-1111-1111-1111-111111111111"
const GATEWAY = "22222222-2222-2222-2222-222222222222"

function tenant(id: string, billingMode: "manual" | "gateway") {
  return {
    id,
    name: billingMode,
    billing_mode: billingMode,
    lifecycle_state: "active",
    active: true,
    trial_ends_at: null,
    activated_at: "2026-08-01T00:00:00.000Z",
    plan_id: null,
    plans: null,
  }
}

beforeEach(() => {
  db.tabelas.clear()
  db.log.length = 0
  logAuditMock.mockClear()
  cancelSubscriptionMock.mockClear()
  db.seed("tenants", [tenant(MANUAL, "manual"), tenant(GATEWAY, "gateway")])
  db.seed("invoices", [
    { id: "inv_manual_open", tenant_id: MANUAL, status: "open", void_reason: null },
    { id: "inv_manual_partial", tenant_id: MANUAL, status: "partial", void_reason: null },
    { id: "inv_gateway_open", tenant_id: GATEWAY, status: "open", void_reason: null },
    { id: "inv_gateway_partial", tenant_id: GATEWAY, status: "partial", void_reason: null },
  ])
})

describe("lifecycle não reescreve o livro financeiro em massa", () => {
  it.each([
    ["manual", MANUAL],
    ["gateway", GATEWAY],
  ] as const)("suspender tenant %s mantém open/partial visíveis em quarentena", async (_mode, tenantId) => {
    const antes = structuredClone(db.linhas("invoices").filter((row) => row.tenant_id === tenantId))

    const result = await transitionLifecycleCore(tenantId, "suspend")

    expect(result).toEqual({ to: "suspended" })
    expect(db.linhas("invoices").filter((row) => row.tenant_id === tenantId)).toEqual(antes)
    expect(db.log.filter((op) => op.tabela === "invoices" && op.op === "update")).toEqual([])
  })
})
