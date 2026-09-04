import { beforeEach, describe, expect, it, vi } from "vitest"
import { FakeDb } from "@/test/fakes/fake-db"

const db = new FakeDb()
const procurarAssinaturaMock = vi.fn<() => Promise<string | null | undefined>>()
const cancelarAssinaturaMock = vi.fn<() => Promise<{ ok: true } | { error: string }>>()
const vincularAssinaturaMock = vi.fn()
const asaasGetMock = vi.fn()
const processAsaasEventMock = vi.fn()

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const query = db.from(table) as ReturnType<FakeDb["from"]> & { like?: () => unknown }
      // O fake compartilhado ainda não implementa LIKE. Neste teste todas as reservas têm
      // formato pending:, então o no-op deixa a fronteira relevante (`billing_mode`) real.
      query.like = () => query
      return query
    },
  },
}))
vi.mock("./client", () => ({ asaas: { get: (...args: unknown[]) => asaasGetMock(...args) } }))
vi.mock("./webhook-handler", () => ({
  processAsaasEvent: (...args: unknown[]) => processAsaasEventMock(...args),
}))
vi.mock("./subscriptions", () => ({
  procurarAssinaturaNoGateway: () => procurarAssinaturaMock(),
  cancelSubscriptionForTenant: () => cancelarAssinaturaMock(),
  vincularAssinatura: (...args: unknown[]) => vincularAssinaturaMock(...args),
}))
vi.mock("@/lib/billing/audit", () => ({ auditarCobranca: vi.fn() }))
vi.mock("@/lib/cron/run", () => ({
  executarJob: async (_opts: unknown, run: () => Promise<unknown>) => {
    await run()
    return { pulado: false }
  },
}))

const { reconcileAsaas } = await import("./reconcile")

const reservaExpirada = (sufixo: string) => `pending:${Date.now() - 20 * 60_000}:${sufixo}`

beforeEach(() => {
  db.tabelas.clear()
  vi.clearAllMocks()
  db.seed("asaas_webhook_events", [])
  procurarAssinaturaMock.mockResolvedValue(null)
  cancelarAssinaturaMock.mockResolvedValue({ ok: true })
  asaasGetMock.mockResolvedValue({ data: [] })
  processAsaasEventMock.mockImplementation(async (eventId: string) => {
    const evento = db.linhas("asaas_webhook_events").find((row) => row.id === eventId)
    if (evento) {
      evento.processed_at = "2026-08-21T12:00:00.000Z"
      evento.error = null
    }
  })
})

describe("reconcile injeta evento financeiro completo e só contabiliza conclusão real", () => {
  function seedTenantTravado() {
    db.seed("tenants", [{
      id: "gateway-travado",
      billing_mode: "gateway",
      lifecycle_state: "trial_ended",
      subscription_status: "active",
      asaas_subscription_id: "sub_gateway",
      asaas_customer_id: "cus_gateway",
    }])
  }

  it("transporta a data financeira autoritativa no envelope sintético", async () => {
    seedTenantTravado()
    asaasGetMock.mockResolvedValue({ data: [{
      id: "pay_ok",
      status: "CONFIRMED",
      value: 349.9,
      confirmedDate: "2026-08-20",
    }] })

    const result = await reconcileAsaas()

    const evento = db.linhas("asaas_webhook_events").find((row) => row.id === "reconcile_pay_ok")
    expect(evento?.payload).toEqual({
      dateCreated: "2026-08-20T00:00:00.000Z",
      payment: { id: "pay_ok", customer: "cus_gateway", status: "CONFIRMED", value: 349.9 },
    })
    expect(processAsaasEventMock).toHaveBeenCalledWith("reconcile_pay_ok")
    expect(result.liberados).toBe(1)
  })

  it("não injeta nem contabiliza pagamento sem data financeira confiável", async () => {
    seedTenantTravado()
    asaasGetMock.mockResolvedValue({ data: [{ id: "pay_sem_data", status: "CONFIRMED", value: 349.9 }] })

    const result = await reconcileAsaas()

    expect(db.linhas("asaas_webhook_events")).toEqual([])
    expect(processAsaasEventMock).not.toHaveBeenCalled()
    expect(result.liberados).toBe(0)
    expect(result.erros).toBeGreaterThan(0)
  })

  it("não contabiliza liberação quando o handler deixa o evento pendente ou com erro", async () => {
    seedTenantTravado()
    asaasGetMock.mockResolvedValue({ data: [{
      id: "pay_falhou",
      status: "CONFIRMED",
      value: 349.9,
      paymentDate: "2026-08-20",
    }] })
    processAsaasEventMock.mockImplementation(async (eventId: string) => {
      const evento = db.linhas("asaas_webhook_events").find((row) => row.id === eventId)
      if (evento) evento.error = "ledger indisponível"
    })

    const result = await reconcileAsaas()

    expect(result.liberados).toBe(0)
    expect(result.erros).toBeGreaterThan(0)
  })
})

describe("reconcile respeita a fronteira manual versus gateway", () => {
  it("limpa/cancela somente gateway e não chama o Asaas para tenants manuais", async () => {
    db.seed("tenants", [
      {
        id: "gateway-reserva", billing_mode: "gateway", lifecycle_state: "active",
        asaas_subscription_id: reservaExpirada("gateway"), plan_id: null,
        subscription_ends_at: null, subscription_ended_reason: null,
      },
      {
        id: "manual-reserva", billing_mode: "manual", lifecycle_state: "active",
        asaas_subscription_id: reservaExpirada("manual"), plan_id: null,
        subscription_ends_at: null, subscription_ended_reason: null,
      },
      {
        id: "gateway-cortado", billing_mode: "gateway", lifecycle_state: "suspended",
        asaas_subscription_id: "sub_gateway",
      },
      {
        id: "manual-cortado", billing_mode: "manual", lifecycle_state: "suspended",
        asaas_subscription_id: "sub_manual",
      },
    ])

    const result = await reconcileAsaas()

    const tenant = (id: string) => db.linhas("tenants").find((row) => row.id === id)
    expect(tenant("gateway-reserva")?.asaas_subscription_id).toBeNull()
    expect(tenant("manual-reserva")?.asaas_subscription_id).toMatch(/^pending:/)
    expect(procurarAssinaturaMock).toHaveBeenCalledTimes(1)
    expect(cancelarAssinaturaMock).toHaveBeenCalledTimes(1)
    expect(result.reservasLimpas).toBe(1)
    expect(result.cobrancasEncerradas).toBe(1)
  })
})
