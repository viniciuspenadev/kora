// Portão adversarial da F2: fatos financeiros append-only e projeção por soma.
//
// Roda somente em memória. Nenhum teste deste arquivo carrega credencial, Supabase ou Asaas.
// Enquanto a F2 não estiver integrada, vermelho aqui descreve a lacuna real — não se deve
// enfraquecer a expectativa para reproduzir o comportamento antigo.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { FakeDb } from "@/test/fakes/fake-db"
import { AsaasError, FakeGateway, mensagemSeguraDoGateway } from "@/test/fakes/fake-gateway"

const db = new FakeDb()
let gw = new FakeGateway()

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: (table: string) => db.from(table),
    rpc: (name: string, args: Record<string, unknown>) => db.rpc(name, args),
  },
}))
vi.mock("@/lib/asaas/client", () => ({
  get asaas() { return gw.client },
  AsaasError,
  mensagemSeguraDoGateway,
}))
vi.mock("@/lib/plans", () => ({ applyPlan: async () => ({ ok: true }) }))
vi.mock("@/lib/billing", () => ({
  generateInvoiceForTenant: async () => ({ id: undefined, skipped: true, error: undefined }),
}))
vi.mock("@/lib/billing/notify", () => ({ avisarCobranca: async () => {} }))
vi.mock("@/lib/billing/audit", () => ({ auditarCobranca: async () => {} }))

const { processAsaasEvent } = await import("@/lib/asaas/webhook-handler")

const TENANT = "11111111-1111-1111-1111-111111111111"
const CUSTOMER = "cus_kora"
const SUB = "sub_kora"

function tenant(overrides: Record<string, unknown> = {}) {
  return {
    id: TENANT,
    asaas_customer_id: CUSTOMER,
    asaas_subscription_id: SUB,
    subscription_status: "active",
    lifecycle_state: "active",
    billing_mode: "gateway",
    plan_id: "plan_1",
    active: true,
    plans: { price_cents: 100 },
    ...overrides,
  }
}

function invoice(id = "inv_1", totalCents = 10_000, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenant_id: TENANT,
    status: "open",
    total_cents: totalCents,
    paid_cents: 0,
    paid_at: null,
    paid_method: null,
    kind: "recorrente",
    period_start: "2026-08-01",
    period_end: "2026-08-31",
    due_date: "2026-08-14",
    gateway_ref: null,
    gateway_charge_id: null,
    ...overrides,
  }
}

function event(id: string, type: string, paymentId: string | null, customer = CUSTOMER) {
  return {
    id,
    event_type: type,
    payment_id: paymentId,
    received_at: "2026-08-14T10:00:00.000Z",
    processed_at: null,
    claimed_at: null,
    tenant_id: null,
    error: null,
    payload: {
      dateCreated: "2026-08-14T09:59:00.000Z",
      payment: {
        id: paymentId ?? undefined,
        customer,
      },
    },
  }
}

function gatewayPayment(id: string, value: number, overrides: Record<string, unknown> = {}) {
  gw.responde(`GET /payments/${id}`, {
    id,
    status: "CONFIRMED",
    customer: CUSTOMER,
    subscription: SUB,
    value,
    dateCreated: "2026-08-14T09:59:00.000Z",
    dueDate: "2026-08-14",
    billingType: "CREDIT_CARD",
    ...overrides,
  })
}

function seedBase(invoices = [invoice()], events: Record<string, unknown>[] = []) {
  db.seed("tenants", [tenant()])
    .seed("invoices", invoices)
    .seed("invoice_items", invoices.map((i) => ({
      id: `item_${String(i.id)}`,
      invoice_id: i.id,
      kind: "plan",
      amount_cents: 100,
    })))
    .seed("invoice_payments", [])
    .seed("asaas_webhook_events", events)
}

function rpcArgs(overrides: Record<string, unknown> = {}) {
  return {
    p_tenant: TENANT,
    p_kind: "pagamento",
    p_payment_id: "pay_rpc",
    p_invoice: "inv_1",
    p_valor: 10_000,
    p_acumulado: null,
    p_occurred_at: "2026-08-14T09:59:00.000Z",
    p_source: "webhook",
    p_source_event_id: "evt_rpc",
    p_method: "CREDIT_CARD",
    p_gateway_due_date: "2026-08-14",
    p_subscription_id: SUB,
    p_provider_ref: "pay_rpc",
    p_external_reference: null,
    ...overrides,
  }
}

const fato = (paymentId: string) => db.linhas("invoice_payments")
  .find((row) => row.payment_id === paymentId)
const evento = (id: string) => db.linhas("asaas_webhook_events")
  .find((row) => row.id === id)!

beforeEach(() => {
  gw = new FakeGateway()
  db.tabelas.clear()
  db.log.length = 0
})

describe("F2 · idempotência por fato, não por entrega", () => {
  it("CONFIRMED e RECEIVED do mesmo payment_id produzem uma única linha e um único crédito", async () => {
    seedBase([invoice()], [
      event("evt_confirmed", "PAYMENT_CONFIRMED", "pay_1"),
      event("evt_received", "PAYMENT_RECEIVED", "pay_1"),
    ])
    gatewayPayment("pay_1", 100)

    await processAsaasEvent("evt_confirmed")
    gatewayPayment("pay_1", 100, { status: "RECEIVED" })
    await processAsaasEvent("evt_received")

    const fatos = db.linhas("invoice_payments").filter((row) => row.payment_id === "pay_1")
    expect(fatos).toHaveLength(1)
    expect(fatos[0]).toMatchObject({
      tenant_id: TENANT,
      invoice_id: "inv_1",
      provider: "asaas",
      event_key: "pagamento:pay_1",
      kind: "pagamento",
      amount_cents: 10_000,
    })
    expect(db.linhas("invoices")[0]).toMatchObject({
      status: "paid",
      paid_cents: 10_000,
      paid_method: "credit_card",
    })
    expect(db.log.filter((op) => op.tabela === "registrar_e_aplicar_fato_gateway")).toHaveLength(2)
    expect(evento("evt_confirmed")).toMatchObject({ error: null })
    expect(evento("evt_received")).toMatchObject({ error: null })
  })

  it("falha interna entre registro e projeção faz rollback total; retry converge", async () => {
    seedBase([invoice()], [event("evt_retry", "PAYMENT_CONFIRMED", "pay_retry")])
    gatewayPayment("pay_retry", 100)
    db.falharEm({
      tabela: "registrar_e_aplicar_fato_gateway:projection",
      op: "rpc",
      vezes: 1,
      msg: "recalc indisponível",
    })

    await processAsaasEvent("evt_retry")
    expect(db.linhas("invoice_payments")).toHaveLength(0)
    expect(db.linhas("invoices")[0]).toMatchObject({ status: "open", paid_cents: 0, paid_method: null })
    expect(evento("evt_retry").processed_at).toBeNull()
    expect(String(evento("evt_retry").error)).toContain("recalc")

    await processAsaasEvent("evt_retry")
    expect(db.linhas("invoice_payments")).toHaveLength(1)
    expect(db.linhas("invoices")[0]).toMatchObject({
      status: "paid",
      paid_cents: 10_000,
      paid_method: "credit_card",
    })
    expect(evento("evt_retry").processed_at).not.toBeNull()
    expect(evento("evt_retry").error).toBeNull()
    expect(db.log.some((op) => op.tabela === "recalcular_pagamento_da_fatura")).toBe(false)
    expect(db.log.filter((op) => op.op === "rpc").map((op) => op.tabela))
      .toEqual(["registrar_e_aplicar_fato_gateway", "registrar_e_aplicar_fato_gateway"])
  })

  it("falha depois da projeção e do paid_method faz rollback total; retry converge", async () => {
    seedBase([invoice()], [event("evt_paid_method", "PAYMENT_CONFIRMED", "pay_paid_method")])
    gatewayPayment("pay_paid_method", 100)
    db.falharEm({
      tabela: "registrar_e_aplicar_fato_gateway:paid_method",
      op: "rpc",
      vezes: 1,
      msg: "paid_method indisponível",
    })

    await processAsaasEvent("evt_paid_method")
    expect(db.linhas("invoice_payments")).toHaveLength(0)
    expect(db.linhas("invoices")[0]).toMatchObject({
      status: "open",
      paid_cents: 0,
      paid_method: null,
      gateway_charge_id: null,
      gateway_ref: null,
    })
    expect(evento("evt_paid_method").processed_at).toBeNull()
    expect(String(evento("evt_paid_method").error)).toContain("paid_method")

    await processAsaasEvent("evt_paid_method")
    expect(db.linhas("invoice_payments")).toHaveLength(1)
    expect(db.linhas("invoices")[0]).toMatchObject({
      status: "paid", paid_cents: 10_000, paid_method: "credit_card",
    })
    expect(evento("evt_paid_method").processed_at).not.toBeNull()
  })

  it("nunca corrige pagamento por UPDATE/DELETE e reentrega preserva o fato original", async () => {
    seedBase([invoice()], [
      event("evt_first", "PAYMENT_CONFIRMED", "pay_append"),
      event("evt_replay", "PAYMENT_RECEIVED", "pay_append"),
    ])
    gatewayPayment("pay_append", 100)
    await processAsaasEvent("evt_first")
    const original = structuredClone(fato("pay_append"))
    expect(original).toBeDefined()

    gatewayPayment("pay_append", 100, { status: "RECEIVED" })
    await processAsaasEvent("evt_replay")

    expect(fato("pay_append")).toEqual(original)
    expect(db.log.filter((op) => op.tabela === "invoice_payments" && ["update", "delete"].includes(op.op))).toEqual([])
  })

  it("replay com método divergente não sobrescreve fato nem paid_method", async () => {
    seedBase([invoice()], [
      event("evt_method_first", "PAYMENT_CONFIRMED", "pay_method"),
      event("evt_method_replay", "PAYMENT_RECEIVED", "pay_method"),
    ])
    gatewayPayment("pay_method", 100)
    await processAsaasEvent("evt_method_first")
    const original = structuredClone(fato("pay_method"))

    gatewayPayment("pay_method", 100, { status: "RECEIVED", billingType: "PIX" })
    await processAsaasEvent("evt_method_replay")

    expect(fato("pay_method")).toEqual(original)
    expect(fato("pay_method")?.method).toBe("CREDIT_CARD")
    expect(db.linhas("invoices")[0].paid_method).toBe("credit_card")
    expect(evento("evt_method_replay").processed_at).toBeNull()
    expect(String(evento("evt_method_replay").error)).toContain("método imutável")
  })

  it("billingType ausente permanece null e não fabrica cartão", async () => {
    seedBase([invoice()], [event("evt_sem_metodo", "PAYMENT_CONFIRMED", "pay_sem_metodo")])
    gatewayPayment("pay_sem_metodo", 100, { billingType: null })

    await processAsaasEvent("evt_sem_metodo")

    expect(fato("pay_sem_metodo")?.method).toBeNull()
    expect(db.linhas("invoices")[0]).toMatchObject({ status: "paid", paid_method: null })
  })
})

describe("F2 · projeção deriva da soma do livro", () => {
  it("duas entradas distintas projetam partial → paid sem soma em memória no handler", async () => {
    const invoiceId = "33333333-3333-4333-8333-333333333333"
    seedBase([invoice(invoiceId)], [
      event("evt_60", "PAYMENT_CONFIRMED", "pay_60"),
      event("evt_40", "PAYMENT_CONFIRMED", "pay_40"),
    ])
    gatewayPayment("pay_60", 60)
    // Depois do primeiro carimbo, dueDate sozinho não pode anexar um segundo charge.
    // O complemento traz a referência canônica e por isso prova a mesma invoice.
    gatewayPayment("pay_40", 40, { externalReference: `kora:inv:${invoiceId}` })

    await processAsaasEvent("evt_60")
    expect(db.linhas("invoices")[0]).toMatchObject({ status: "partial", paid_cents: 6_000 })

    await processAsaasEvent("evt_40")
    const soma = db.linhas("invoice_payments")
      .filter((row) => row.invoice_id === invoiceId)
      .reduce((acc, row) => acc + Number(row.amount_cents), 0)
    expect(soma).toBe(10_000)
    expect(db.linhas("invoices")[0]).toMatchObject({ status: "paid", paid_cents: soma })
  })
})

describe("F2 · isolamento e falha fechada", () => {
  it("reconcile exige evento persistido com prefixo próprio e espelha a RPC real", async () => {
    seedBase([invoice()], [event("reconcile_pay_rpc", "PAYMENT_CONFIRMED", "pay_rpc")])

    const result = await db.rpc("registrar_e_aplicar_fato_gateway", rpcArgs({
      p_source: "reconcile",
      p_source_event_id: "reconcile_pay_rpc",
    }))

    expect(result.error).toBeNull()
    expect(fato("pay_rpc")).toMatchObject({ source: "reconcile", source_event_id: "reconcile_pay_rpc" })
    expect(evento("reconcile_pay_rpc").tenant_id).toBe(TENANT)

    const semEvento = await db.rpc("registrar_e_aplicar_fato_gateway", rpcArgs({
      p_payment_id: "pay_sem_evento",
      p_source: "reconcile",
      p_source_event_id: null,
    }))
    expect(semEvento.error?.message).toContain("exige source_event_id")
    expect(fato("pay_sem_evento")).toBeUndefined()
  })

  it("pagamento negativo é recusado sem mutação", async () => {
    seedBase([invoice()], [event("evt_rpc", "PAYMENT_CONFIRMED", "pay_rpc")])
    const antes = structuredClone(db.linhas("invoices"))

    const result = await db.rpc("registrar_e_aplicar_fato_gateway", rpcArgs({ p_valor: -10_000 }))

    expect(result.error?.message).toContain("inteiro positivo")
    expect(db.linhas("invoice_payments")).toEqual([])
    expect(db.linhas("invoices")).toEqual(antes)
    expect(evento("evt_rpc").tenant_id).toBeNull()
  })

  it("tenant manual encerra o evento sem qualquer escrita financeira", async () => {
    seedBase([invoice()], [event("evt_manual", "PAYMENT_CONFIRMED", "pay_manual")])
    Object.assign(db.linhas("tenants")[0], { billing_mode: "manual" })
    gatewayPayment("pay_manual", 100)
    const antes = structuredClone(db.linhas("invoices"))

    await processAsaasEvent("evt_manual")

    expect(db.linhas("invoice_payments")).toEqual([])
    expect(db.linhas("invoices")).toEqual(antes)
    expect(db.log.some((op) => op.op === "rpc")).toBe(false)
    expect(String(evento("evt_manual").error)).toContain("billing_mode=manual")
  })

  it("payment sem id não cria fato nem altera fatura/tenant", async () => {
    seedBase([invoice()], [event("evt_sem_id", "PAYMENT_CONFIRMED", null)])
    const tenantAntes = structuredClone(db.linhas("tenants")[0])
    const invoiceAntes = structuredClone(db.linhas("invoices")[0])

    await processAsaasEvent("evt_sem_id")

    expect(db.linhas("invoice_payments")).toEqual([])
    expect(db.linhas("invoices")[0]).toEqual(invoiceAntes)
    expect(db.linhas("tenants")[0]).toEqual(tenantAntes)
    expect(db.log.some((op) => op.op === "rpc")).toBe(false)
    expect(evento("evt_sem_id").processed_at).not.toBeNull()
    expect(String(evento("evt_sem_id").error)).toContain("payment_id")
  })

  it("lookup ambíguo do tenant fica retryable e não escreve no livro", async () => {
    seedBase([invoice()], [event("evt_ambiguo", "PAYMENT_CONFIRMED", "pay_ambiguo")])
    gatewayPayment("pay_ambiguo", 100)
    db.falharEm({
      tabela: "tenants",
      op: "select",
      vezes: 1,
      msg: "JSON object requested, multiple rows returned",
    })

    await processAsaasEvent("evt_ambiguo")

    expect(db.linhas("invoice_payments")).toEqual([])
    expect(evento("evt_ambiguo").processed_at).toBeNull()
    expect(String(evento("evt_ambiguo").error)).toContain("multiple rows")
    expect(db.log.some((op) => op.op === "rpc")).toBe(false)
  })

  it("pagamento confirmado pelo gateway para outro dono é ignorado sem fato financeiro", async () => {
    seedBase([invoice()], [event("evt_outro_dono", "PAYMENT_CONFIRMED", "pay_outro")])
    gatewayPayment("pay_outro", 100, { customer: "cus_outro" })

    await processAsaasEvent("evt_outro_dono")

    expect(db.linhas("invoice_payments")).toEqual([])
    expect(db.linhas("invoices")[0]).toMatchObject({ status: "open", paid_cents: 0 })
    expect(db.log.some((op) => op.op === "rpc")).toBe(false)
    expect(String(evento("evt_outro_dono").error)).toContain("outro cliente")
  })

  it("carimbo divergente aborta a RPC; zero rowcount não aplica o fato na invoice", async () => {
    seedBase([
      invoice("inv_carimbada", 10_000, {
        gateway_charge_id: "pay_original",
        gateway_ref: "pay_original",
      }),
    ], [event("evt_intruso", "PAYMENT_CONFIRMED", "pay_intruso")])
    const antes = structuredClone(db.linhas("invoices")[0])

    const result = await db.rpc("registrar_e_aplicar_fato_gateway", {
      p_tenant: TENANT,
      p_kind: "pagamento",
      p_payment_id: "pay_intruso",
      p_invoice: "inv_carimbada",
      p_valor: 10_000,
      p_acumulado: null,
      p_occurred_at: "2026-08-14T09:59:00.000Z",
      p_source: "webhook",
      p_source_event_id: "evt_intruso",
      p_method: "CREDIT_CARD",
      p_gateway_due_date: "2026-08-14",
      p_subscription_id: SUB,
      p_provider_ref: "pay_intruso",
      p_external_reference: null,
    })

    // O UPDATE do carimbo casa zero linhas por causa do vínculo anterior. Isso é conflito,
    // não sucesso: a transação inteira precisa abortar, sem fato aplicado nem overwrite.
    expect(result.error).not.toBeNull()
    expect(String(result.error?.message)).toContain("identidade")
    expect(db.linhas("invoices")[0]).toEqual(antes)
    expect(db.linhas("invoice_payments")).toEqual([])
  })

  it("pagamento excedente fica suspenso sem carimbar a invoice", async () => {
    seedBase([invoice()], [event("evt_excesso", "PAYMENT_CONFIRMED", "pay_excesso")])
    gatewayPayment("pay_excesso", 200)

    await processAsaasEvent("evt_excesso")

    expect(fato("pay_excesso")).toMatchObject({ amount_cents: 20_000, invoice_id: null })
    expect(db.linhas("invoices")[0]).toMatchObject({
      status: "open",
      paid_cents: 0,
      paid_method: null,
      gateway_charge_id: null,
      gateway_ref: null,
    })
  })

  it("RPC representa pagamento excedente com quitou=false, nunca null", async () => {
    seedBase([invoice()], [event("evt_rpc_excesso", "PAYMENT_CONFIRMED", "pay_rpc_excesso")])

    const result = await db.rpc("registrar_e_aplicar_fato_gateway", rpcArgs({
      p_payment_id: "pay_rpc_excesso",
      p_source_event_id: "evt_rpc_excesso",
      p_valor: 20_000,
      p_provider_ref: "pay_rpc_excesso",
    }))

    expect(result.error).toBeNull()
    // A RPC devolve LINHAS; estreitar aqui é o teste declarando o formato que ele
    // acabou de afirmar com `toHaveLength` — o dublê tipa `data` como a união real
    // (array · objeto · null), que é o que o PostgREST devolve.
    const linhas = result.data as Record<string, unknown>[]
    expect(linhas).toHaveLength(1)
    expect(linhas[0]).toMatchObject({
      aplicado: false,
      invoice_id: null,
      quitou: false,
      suspenso: true,
    })
    expect(linhas[0].quitou).not.toBeNull()
  })
})

describe("F2 · compensações ficam fechadas até contrato e prova de sandbox", () => {
  it.each(["estorno", "chargeback"])("recusa % sem rasurar o pagamento original", async (kind) => {
    const tipo = kind === "estorno" ? "PAYMENT_REFUNDED" : "PAYMENT_CHARGEBACK_REQUESTED"
    seedBase([invoice()], [event(`evt_${kind}`, tipo, "pay_original")])
    db.seed("invoice_payments", [{
      id: "fact_original",
      tenant_id: TENANT,
      invoice_id: "inv_1",
      provider: "asaas",
      event_key: "pagamento:pay_original",
      payment_id: "pay_original",
      kind: "pagamento",
      amount_cents: 10_000,
      occurred_at: "2026-08-14T09:00:00.000Z",
      source: "webhook",
    }])
    const antes = structuredClone(db.linhas("invoice_payments"))

    const result = await db.rpc("registrar_e_aplicar_fato_gateway", {
      p_tenant: TENANT,
      p_kind: kind,
      p_payment_id: "pay_original",
      p_invoice: "inv_1",
      p_valor: null,
      p_acumulado: 10_000,
      p_occurred_at: "2026-08-14T10:00:00.000Z",
      p_source: "webhook",
      p_source_event_id: `evt_${kind}`,
      p_method: "CREDIT_CARD",
      p_gateway_due_date: "2026-08-14",
      p_subscription_id: SUB,
      p_provider_ref: null,
      p_external_reference: null,
    })

    expect(result.error?.message).toContain("ainda não modelado")
    expect(db.linhas("invoice_payments")).toEqual(antes)
  })
})
