import { beforeEach, describe, expect, it, vi } from "vitest"
import { FakeDb } from "@/test/fakes/fake-db"

const db = new FakeDb()
let antesDeFrom: ((table: string) => void) | null = null
const transitionLifecycleCoreMock = vi.fn<
  (tenantId: string, action: string, options: unknown) => Promise<{ ok: true }>
>(async () => ({ ok: true }))
const auditarCobrancaMock = vi.fn<(input: unknown) => Promise<void>>(async () => {})

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      antesDeFrom?.(table)
      return db.from(table)
    },
  },
}))
vi.mock("@/lib/platform-settings", () => ({
  getPlatformSettings: vi.fn(async () => ({
    pastDueGraceDays: 3,
    trialEndedGraceDays: 1,
  })),
}))
vi.mock("@/lib/billing/audit", () => ({
  auditarCobranca: (input: unknown) => auditarCobrancaMock(input),
}))
vi.mock("@/lib/lifecycle-core", () => ({
  transitionLifecycleCore: (tenantId: string, action: string, options: unknown) =>
    transitionLifecycleCoreMock(tenantId, action, options),
}))
vi.mock("@/lib/billing/gateway-limits", () => ({
  assinaturaRealId: (value: unknown) =>
    typeof value === "string" && value.length > 0 && !value.startsWith("pending:"),
}))

const { runTrialHousekeeping } = await import("./trial-housekeeping")

const MANUAL = "11111111-1111-1111-1111-111111111111"
const GATEWAY = "22222222-2222-2222-2222-222222222222"
const PASSADO = "2020-01-01T00:00:00.000Z"

function preparar(tenants: Array<Record<string, unknown>>) {
  db.tabelas.clear()
  db.log.length = 0
  db.seed("tenants", tenants)
  db.seed("invoices", [])
  db.seed("cron_runs", [])
  db.seed("signup_verifications", [])
  db.seed("email_outbox", [])
}

function tenant(id: string) {
  return db.linhas("tenants").find((row) => row.id === id)!
}

beforeEach(() => {
  antesDeFrom = null
  transitionLifecycleCoreMock.mockClear()
  auditarCobrancaMock.mockClear()
})

describe("housekeeping respeita a fronteira manual versus gateway", () => {
  it("trialing vencido encerra somente o trial gateway", async () => {
    preparar([
      {
        id: MANUAL,
        billing_mode: "manual",
        lifecycle_state: "trialing",
        trial_ends_at: PASSADO,
        asaas_subscription_id: null,
        subscription_status: "active",
        subscription_ends_at: null,
      },
      {
        id: GATEWAY,
        billing_mode: "gateway",
        lifecycle_state: "trialing",
        trial_ends_at: PASSADO,
        asaas_subscription_id: null,
        subscription_status: "active",
        subscription_ends_at: null,
      },
    ])

    await runTrialHousekeeping()

    expect(transitionLifecycleCoreMock).toHaveBeenCalledTimes(1)
    expect(transitionLifecycleCoreMock).toHaveBeenCalledWith(GATEWAY, "end_trial", {
      system: true,
      expectedBillingMode: "gateway",
    })
    expect(tenant(MANUAL).lifecycle_state).toBe("trialing")
  })

  it("trial_ended vencido suspende somente o tenant gateway", async () => {
    preparar([
      {
        id: MANUAL,
        billing_mode: "manual",
        lifecycle_state: "trial_ended",
        trial_ends_at: PASSADO,
        asaas_subscription_id: null,
        subscription_status: "active",
        subscription_ends_at: null,
      },
      {
        id: GATEWAY,
        billing_mode: "gateway",
        lifecycle_state: "trial_ended",
        trial_ends_at: PASSADO,
        asaas_subscription_id: null,
        subscription_status: "active",
        subscription_ends_at: null,
      },
    ])

    await runTrialHousekeeping()

    expect(transitionLifecycleCoreMock).toHaveBeenCalledTimes(1)
    expect(transitionLifecycleCoreMock).toHaveBeenCalledWith(GATEWAY, "suspend", {
      system: true,
      expectedBillingMode: "gateway",
    })
    expect(tenant(MANUAL).lifecycle_state).toBe("trial_ended")
  })

  it("fim de ciclo expirado não cancela manual e mantém open/partial visíveis para conciliação", async () => {
    preparar([
      {
        id: MANUAL,
        billing_mode: "manual",
        lifecycle_state: "active",
        trial_ends_at: null,
        asaas_subscription_id: null,
        subscription_status: "active",
        subscription_ends_at: PASSADO,
        subscription_ended_reason: null,
        past_due_since: null,
        past_due_reason: null,
        asaas_card_token: "enc:v1:teste",
        card_brand: "VISA",
        card_last4: "4242",
      },
      {
        id: GATEWAY,
        billing_mode: "gateway",
        lifecycle_state: "active",
        trial_ends_at: null,
        asaas_subscription_id: null,
        subscription_status: "active",
        subscription_ends_at: PASSADO,
        subscription_ended_reason: null,
        past_due_since: null,
        past_due_reason: null,
        asaas_card_token: "enc:v1:gateway",
        card_brand: "MASTERCARD",
        card_last4: "5555",
      },
    ])
    db.seed("invoices", [
      { id: "inv_manual", tenant_id: MANUAL, status: "open", void_reason: null },
      { id: "inv_gateway", tenant_id: GATEWAY, status: "open", void_reason: null },
      { id: "inv_gateway_partial", tenant_id: GATEWAY, status: "partial", void_reason: null },
    ])

    await runTrialHousekeeping()

    expect(tenant(MANUAL)).toMatchObject({
      subscription_status: "active",
      subscription_ended_reason: null,
      asaas_card_token: "enc:v1:teste",
      card_brand: "VISA",
      card_last4: "4242",
    })
    expect(db.linhas("invoices").find((row) => row.id === "inv_manual")).toMatchObject({
      status: "open",
      void_reason: null,
    })

    expect(tenant(GATEWAY)).toMatchObject({
      subscription_status: "canceled",
      subscription_ended_reason: "pedido_do_cliente",
      asaas_card_token: null,
      card_brand: null,
      card_last4: null,
    })
    expect(db.linhas("invoices").find((row) => row.id === "inv_gateway")).toMatchObject({
      status: "open",
      void_reason: null,
    })
    expect(db.linhas("invoices").find((row) => row.id === "inv_gateway_partial")).toMatchObject({
      status: "partial",
      void_reason: null,
    })
    expect(auditarCobrancaMock).toHaveBeenCalledTimes(1)
    expect(auditarCobrancaMock).toHaveBeenCalledWith(expect.objectContaining({ tenantId: GATEWAY }))
  })

  it("recontratação concorrente vence a varredura e preserva tenant, vínculo e cartão", async () => {
    preparar([{
      id: GATEWAY,
      billing_mode: "gateway",
      lifecycle_state: "active",
      trial_ends_at: null,
      asaas_subscription_id: null,
      subscription_status: "active",
      subscription_ends_at: PASSADO,
      subscription_ended_reason: "pedido_do_cliente",
      past_due_since: null,
      past_due_reason: null,
      asaas_card_token: "enc:v1:antigo",
      card_brand: "VISA",
      card_last4: "4242",
    }])

    let leiturasDeTenant = 0
    antesDeFrom = (table) => {
      if (table !== "tenants" || ++leiturasDeTenant !== 4) return
      Object.assign(tenant(GATEWAY), {
        asaas_subscription_id: "sub_recontratada",
        subscription_ends_at: null,
        subscription_ended_reason: null,
        asaas_card_token: "enc:v1:novo",
        card_brand: "MASTERCARD",
        card_last4: "5555",
      })
    }

    await runTrialHousekeeping()

    expect(tenant(GATEWAY)).toMatchObject({
      billing_mode: "gateway",
      subscription_status: "active",
      asaas_subscription_id: "sub_recontratada",
      subscription_ends_at: null,
      subscription_ended_reason: null,
      asaas_card_token: "enc:v1:novo",
      card_brand: "MASTERCARD",
      card_last4: "5555",
    })
    expect(auditarCobrancaMock).not.toHaveBeenCalled()
  })

  it("mudança concorrente para manual vence a varredura e preserva estado e cartão", async () => {
    preparar([{
      id: GATEWAY,
      billing_mode: "gateway",
      lifecycle_state: "active",
      trial_ends_at: null,
      asaas_subscription_id: null,
      subscription_status: "active",
      subscription_ends_at: PASSADO,
      subscription_ended_reason: "pedido_do_cliente",
      past_due_since: null,
      past_due_reason: null,
      asaas_card_token: "enc:v1:preservar",
      card_brand: "VISA",
      card_last4: "4242",
    }])

    let leiturasDeTenant = 0
    antesDeFrom = (table) => {
      if (table !== "tenants" || ++leiturasDeTenant !== 4) return
      tenant(GATEWAY).billing_mode = "manual"
    }

    await runTrialHousekeeping()

    expect(tenant(GATEWAY)).toMatchObject({
      billing_mode: "manual",
      subscription_status: "active",
      subscription_ended_reason: "pedido_do_cliente",
      asaas_card_token: "enc:v1:preservar",
      card_brand: "VISA",
      card_last4: "4242",
    })
    expect(auditarCobrancaMock).not.toHaveBeenCalled()
  })
})
