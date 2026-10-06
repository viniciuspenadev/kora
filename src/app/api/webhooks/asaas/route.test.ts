import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const insertMock = vi.fn()
const afterMock = vi.fn()
const processAsaasEventMock = vi.fn<(eventId: string) => Promise<void>>(async () => {})

vi.mock("server-only", () => ({}))
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>()
  return { ...actual, after: (...args: unknown[]) => afterMock(...args) }
})

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({ insert: insertMock })),
  },
}))

vi.mock("@/lib/asaas/webhook-handler", () => ({
  processAsaasEvent: (eventId: string) => processAsaasEventMock(eventId),
}))

const { POST } = await import("./route")

const TOKEN = "segredo-de-teste-com-tamanho-suficiente"
const TOKEN_ANTERIOR = process.env.ASAAS_WEBHOOK_TOKEN

function requisicao(payment: Record<string, unknown> = { id: "pay_1", customer: "cus_1" }) {
  return requisicaoComBody({ id: "evt_1", event: "PAYMENT_CONFIRMED", payment })
}

function requisicaoComBody(body: Record<string, unknown>) {
  return new Request("http://localhost/api/webhooks/asaas", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "asaas-access-token": TOKEN,
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  process.env.ASAAS_WEBHOOK_TOKEN = TOKEN
  insertMock.mockReset()
  afterMock.mockReset()
  processAsaasEventMock.mockReset()
})

afterEach(() => {
  if (TOKEN_ANTERIOR === undefined) delete process.env.ASAAS_WEBHOOK_TOKEN
  else process.env.ASAAS_WEBHOOK_TOKEN = TOKEN_ANTERIOR
  vi.restoreAllMocks()
})

describe("durabilidade da entrada do webhook Asaas", () => {
  it("falha ao persistir devolve 503 para o gateway tentar novamente", async () => {
    insertMock.mockResolvedValue({
      error: { code: "08006", message: "conexão com o banco caiu" },
    })
    vi.spyOn(console, "error").mockImplementation(() => {})

    const response = await POST(requisicao() as never)

    expect(response.status).toBe(503)
    expect(afterMock).not.toHaveBeenCalled()
    expect(processAsaasEventMock).not.toHaveBeenCalled()
  })

  it("evento duplicado devolve 200 e não agenda novo processamento", async () => {
    insertMock.mockResolvedValue({
      error: { code: "23505", message: "duplicate key value" },
    })

    const response = await POST(requisicao() as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, duplicate: true })
    expect(afterMock).not.toHaveBeenCalled()
    expect(processAsaasEventMock).not.toHaveBeenCalled()
  })

  it("remove a credencial do cartao antes de persistir o payload", async () => {
    insertMock.mockResolvedValue({ error: null })

    const response = await POST(requisicao({
      id: "pay_1",
      customer: "cus_1",
      creditCard: {
        creditCardToken: "token-reutilizavel",
        creditCardBrand: "VISA",
        creditCardNumber: "**** 4242",
      },
    }) as never)

    expect(response.status).toBe(200)
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        payment: { id: "pay_1", customer: "cus_1" },
      }),
    }))
    const persisted = insertMock.mock.calls[0]?.[0] as { payload?: unknown }
    expect(JSON.stringify(persisted.payload)).not.toContain("token-reutilizavel")
    expect(JSON.stringify(persisted.payload)).not.toContain("creditCard")
  })

  it("descarta PII, URLs e campos futuros sem apagar os campos operacionais", async () => {
    insertMock.mockResolvedValue({ error: null })

    const response = await POST(requisicaoComBody({
      id: "evt_2",
      event: "PAYMENT_CONFIRMED",
      dateCreated: "2026-08-14T12:00:00Z",
      secretFutureField: "não pode sobreviver",
      payment: {
        id: "pay_2", customer: "cus_2", subscription: "sub_2", status: "CONFIRMED",
        billingType: "CREDIT_CARD", dueDate: "2026-08-14", value: 349.9,
        creditCard: { creditCardToken: "tok_vivo", creditCardNumber: "4242", creditCardBrand: "VISA" },
        creditCardHolderInfo: {
          name: "Pessoa Teste", email: "pessoa@example.com", cpfCnpj: "12345678900",
          phone: "11999999999", postalCode: "01001000", addressNumber: "10",
        },
        remoteIp: "203.0.113.1",
        invoiceUrl: "https://documento-sensivel.invalid/recibo",
      },
    }) as never)

    expect(response.status).toBe(200)
    expect(insertMock).toHaveBeenCalledWith({
      id: "evt_2",
      event_type: "PAYMENT_CONFIRMED",
      payment_id: "pay_2",
      payload: {
        id: "evt_2", event: "PAYMENT_CONFIRMED", dateCreated: "2026-08-14T12:00:00Z",
        payment: {
          id: "pay_2", customer: "cus_2", subscription: "sub_2", status: "CONFIRMED",
          billingType: "CREDIT_CARD", dueDate: "2026-08-14", value: 349.9,
        },
      },
    })
  })

  it("preserva os identificadores necessários aos eventos de assinatura", async () => {
    insertMock.mockResolvedValue({ error: null })

    await POST(requisicaoComBody({
      id: "evt_sub",
      event: "SUBSCRIPTION_DELETED",
      subscription: {
        id: "sub_3", customer: "cus_3", status: "INACTIVE",
        nextDueDate: "2026-09-14", value: 349.9,
        creditCardToken: "tok_nunca", holderInfo: { email: "pessoa@example.com" },
      },
    }) as never)

    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        id: "evt_sub",
        event: "SUBSCRIPTION_DELETED",
        subscription: {
          id: "sub_3", customer: "cus_3", status: "INACTIVE",
          nextDueDate: "2026-09-14", value: 349.9,
        },
      },
    }))
  })
})
