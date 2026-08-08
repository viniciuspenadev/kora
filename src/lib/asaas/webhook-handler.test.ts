// ═══════════════════════════════════════════════════════════════
// Os cenários que a leitura não prova — cada um amarrado a um bug real
// ═══════════════════════════════════════════════════════════════
//
// 🔴 POR QUE ESTE ARQUIVO EXISTE. O pentest de 08/08 colocou como portão de saída do
//    Sprint 0: *"corrigir P0-1 a P0-4 e cobertos por testes determinísticos"*. As
//    correções foram validadas por LEITURA — três passadas, que acharam 5 regressões
//    introduzidas pelas próprias correções. Leitura acha o que alguém pensa em procurar;
//    teste impede a VOLTA. A regressão do piso de aceite (que travaria a fatura de todo
//    cliente com excedente) teria caído em dois segundos aqui.
//
// 🔒 NADA TOCA PRODUÇÃO. `vi.mock` troca `@/lib/supabase` e `./client` antes de qualquer
//    import: os módulos reais nunca carregam, então não há service key, não há URL, não há
//    rede. Metade dos cenários é "e quando o banco falha?" — apontar isso pro banco de
//    verdade seria exatamente o oposto do que se quer.
//
// ⚠️ Cada `it` tem no nome o bug que ele tranca. Quando um quebrar, o nome já diz o que
//    voltou a acontecer.

import { describe, it, expect, beforeEach, vi } from "vitest"
import { FakeDb } from "./__fakes__/fake-db"
import { FakeGateway, AsaasError, mensagemSeguraDoGateway } from "./__fakes__/fake-gateway"

const db = new FakeDb()
let gw = new FakeGateway()

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: (t: string) => db.from(t) } }))
vi.mock("./client", () => ({
  get asaas() { return gw.client },
  AsaasError,
  mensagemSeguraDoGateway,
}))
// A aplicação de plano tem teste próprio; aqui interessa só se o handler REAGE ao resultado.
const applyPlanMock = vi.fn(async () => ({ ok: true as const }))
vi.mock("@/lib/plans", () => ({ applyPlan: (...a: unknown[]) => applyPlanMock(...(a as [])) }))
const gerarFaturaMock = vi.fn(async () => ({ id: "inv_nova" as string | undefined, skipped: false, error: undefined as string | undefined }))
vi.mock("@/lib/billing", () => ({ generateInvoiceForTenant: () => gerarFaturaMock() }))

const { processAsaasEvent } = await import("./webhook-handler")

const TENANT = "11111111-1111-1111-1111-111111111111"
const CUSTOMER = "cus_kora"
const SUB_ATUAL = "sub_nova"
const SUB_ANTIGA = "sub_velha"

/** Estado-base: cliente pagante, assinatura vigente, uma fatura aberta. */
function montarCenario(over: { tenant?: Record<string, unknown>; evento?: Record<string, unknown> } = {}) {
  db.tabelas.clear()
  // ⚠️ O log é cumulativo — sem zerar aqui, uma asserção de "quantas escritas houve"
  //    conta as dos cenários anteriores. (Foi exatamente assim que o primeiro `run`
  //    reprovou: o teste estava errado, o código não.)
  db.log.length = 0
  db.seed("tenants", [{
    id: TENANT,
    asaas_customer_id: CUSTOMER,
    asaas_subscription_id: SUB_ATUAL,
    subscription_ends_at: null,
    subscription_status: "active",
    lifecycle_state: "active",
    billing_mode: "gateway",
    plan_id: "plan_1",
    active: true,
    plans: { price_cents: 34990 },
    ...over.tenant,
  }])
  db.seed("invoices", [{
    id: "inv_1", tenant_id: TENANT, status: "open", total_cents: 34990,
    due_date: "2026-08-11", gateway_ref: null,
  }])
  db.seed("asaas_webhook_events", [{
    id: "evt_1",
    event_type: "PAYMENT_CONFIRMED",
    payment_id: "pay_1",
    received_at: "2026-08-08T00:00:00Z",
    processed_at: null,
    error: null,
    payload: { payment: { id: "pay_1", customer: CUSTOMER, value: 349.9 } },
    ...over.evento,
  }])
}

const evento = () => db.linhas("asaas_webhook_events")[0]
const tenant = () => db.linhas("tenants")[0]
const fatura  = () => db.linhas("invoices")[0]

beforeEach(() => {
  gw = new FakeGateway()
  applyPlanMock.mockClear(); applyPlanMock.mockResolvedValue({ ok: true })
  gerarFaturaMock.mockClear(); gerarFaturaMock.mockResolvedValue({ id: "inv_nova", skipped: false, error: undefined })
  montarCenario()
})

// ── P0-4 · falha transitória não pode virar definitiva ──────────────────────
describe("P0-4 — falha transitória deixa o evento PENDENTE", () => {
  it("falha de banco ao liberar NÃO fecha o evento (antes: perdido para sempre)", async () => {
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL })
    db.falharEm({ tabela: "tenants", op: "update", vezes: 1, msg: "conexão caiu" })

    await processAsaasEvent("evt_1")

    expect(evento().processed_at).toBeNull()
    expect(String(evento().error)).toContain("falha ao liberar")
  })

  it("applyPlan que falha mantém o evento pendente — cliente pagou e não recebeu módulos", async () => {
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL })
    applyPlanMock.mockResolvedValue({ ok: false, error: "upsert falhou" } as never)

    await processAsaasEvent("evt_1")

    expect(evento().processed_at).toBeNull()
    expect(String(evento().error)).toContain("plano não aplicado")
  })

  it("reprocessar depois que o banco volta conclui e fecha", async () => {
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL })
    db.falharEm({ tabela: "tenants", op: "update", vezes: 1 })

    await processAsaasEvent("evt_1")
    expect(evento().processed_at).toBeNull()

    evento().processed_at = null   // o reconcile pega pendentes
    await processAsaasEvent("evt_1")

    expect(evento().processed_at).not.toBeNull()
    expect(evento().error).toBeNull()
    expect(tenant().subscription_status).toBe("active")
  })
})

// ── B2 · evento antigo não pode ressuscitar assinatura morta ────────────────
describe("B2 — liberação obsoleta não desfaz um cancelamento posterior", () => {
  it("evento pendente reprocessado após o cancelamento NÃO reabre a assinatura", async () => {
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL })
    // O cancelamento já aconteceu: fim de ciclo carimbado e vínculo zerado.
    Object.assign(tenant(), { subscription_ends_at: "2026-09-11", asaas_subscription_id: null })

    await processAsaasEvent("evt_1")

    expect(tenant().subscription_ends_at).toBe("2026-09-11")   // NÃO foi zerado
    expect(tenant().subscription_status).not.toBe("canceled")  // nem forçado a active indevidamente
  })
})

// ── H-2 · piso de aceite ────────────────────────────────────────────────────
describe("H-2 — piso é o preço do plano, não o total da fatura", () => {
  it("paga o valor do PLANO com fatura tendo excedente ⇒ QUITA (o caso comum)", async () => {
    fatura().total_cents = 42980            // plano 349,90 + 1 usuário extra 79,90
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL })

    await processAsaasEvent("evt_1")

    expect(fatura().status).toBe("paid")
    expect(fatura().gateway_ref).toBe("pay_1")
  })

  it("paga MENOS que o plano ⇒ não quita e fica pendente pra revisão", async () => {
    evento().payload = { payment: { id: "pay_1", customer: CUSTOMER, value: 5 } }
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL })

    await processAsaasEvent("evt_1")

    expect(fatura().status).toBe("open")
    expect(String(evento().error)).toContain("menor que o preço do plano")
  })
})

// ── H-3 / anti-forja · propriedade do pagamento ─────────────────────────────
describe("propriedade do pagamento", () => {
  it("pagamento de OUTRA assinatura não libera (avulsa de R$5 não destrava plano)", async () => {
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: "sub_de_outro" })

    await processAsaasEvent("evt_1")

    expect(String(evento().error)).toContain("não pertence à assinatura")
    expect(fatura().status).toBe("open")
  })

  it("H-3 — restringir NÃO pune quando o customer do gateway diverge", async () => {
    Object.assign(evento(), { event_type: "PAYMENT_OVERDUE" })
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "OVERDUE", customer: "cus_de_outro", subscription: SUB_ATUAL })

    await processAsaasEvent("evt_1")

    expect(tenant().subscription_status).toBe("active")   // não restringiu
    expect(String(evento().error)).toContain("não é o do tenant")
  })

  it("H-3 — falha de leitura do tenant NÃO pune: deixa pendente", async () => {
    Object.assign(evento(), { event_type: "PAYMENT_OVERDUE" })
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "OVERDUE", customer: CUSTOMER, subscription: SUB_ATUAL })
    db.falharEm({ tabela: "tenants", op: "select", vezes: 1, msg: "banco fora" })

    await processAsaasEvent("evt_1")

    expect(tenant().subscription_status).toBe("active")
    expect(evento().processed_at).toBeNull()
  })
})

// ── P0-2 · identidade da assinatura no encerramento ─────────────────────────
describe("P0-2 — encerramento só age sobre a assinatura vigente", () => {
  function eventoDeEncerramento(subId: string | null) {
    Object.assign(evento(), {
      event_type: "SUBSCRIPTION_DELETED",
      payment_id: null,
      payload: { subscription: { id: subId, customer: CUSTOMER } },
    })
  }

  it("evento ATRASADO da assinatura antiga não apaga a nova (nem o cartão)", async () => {
    eventoDeEncerramento(SUB_ANTIGA)
    Object.assign(tenant(), { asaas_card_token: "enc:v1:xxx", card_brand: "visa", card_last4: "4242" })

    await processAsaasEvent("evt_1")

    expect(tenant().asaas_subscription_id).toBe(SUB_ATUAL)
    expect(tenant().asaas_card_token).toBe("enc:v1:xxx")
    expect(tenant().card_last4).toBe("4242")
    expect(String(evento().error)).toContain("obsoleta")
  })

  it("evento SEM id de assinatura não age — caminho destrutivo exige prova", async () => {
    eventoDeEncerramento(null)

    await processAsaasEvent("evt_1")

    expect(tenant().asaas_subscription_id).toBe(SUB_ATUAL)
    expect(String(evento().error)).toContain("sem id de assinatura")
  })

  it("evento da assinatura VIGENTE encerra e carimba o fim do ciclo", async () => {
    eventoDeEncerramento(SUB_ATUAL)
    db.seed("invoices", [{ id: "inv_paga", tenant_id: TENANT, status: "paid", period_end: "2026-09-11" }])

    await processAsaasEvent("evt_1")

    expect(tenant().asaas_subscription_id).toBeNull()
    expect(tenant().asaas_card_token ?? null).toBeNull()
    expect(tenant().subscription_ends_at).toBeTruthy()
  })

  it("B3 — encerramento sem vínculo local ainda carimba o fim do ciclo", async () => {
    // `cancelSubscriptionForTenant` (suspend) já zerou o vínculo; o evento chega depois.
    eventoDeEncerramento(SUB_ATUAL)
    Object.assign(tenant(), { asaas_subscription_id: null })
    db.seed("invoices", [{ id: "inv_paga", tenant_id: TENANT, status: "paid", period_end: "2026-09-11" }])

    await processAsaasEvent("evt_1")

    expect(tenant().subscription_ends_at).toBeTruthy()
  })

  it("reserva `pending:` do claim não é apagada por um encerramento", async () => {
    eventoDeEncerramento(SUB_ANTIGA)
    Object.assign(tenant(), { asaas_subscription_id: "pending:123:abc" })

    await processAsaasEvent("evt_1")

    expect(tenant().asaas_subscription_id).toBe("pending:123:abc")
  })
})

// ── H-4 · "não achei" ≠ "não consegui procurar" ─────────────────────────────
describe("H-4 — erro de lookup não vira 'evento de outro produto'", () => {
  it("banco indisponível deixa o evento pendente em vez de encerrá-lo", async () => {
    db.falharEm({ tabela: "tenants", op: "select", vezes: 1, msg: "timeout do postgrest" })

    await processAsaasEvent("evt_1")

    expect(evento().processed_at).toBeNull()
    expect(String(evento().error)).toContain("lookup do tenant falhou")
  })
})

// ── Idempotência · entrega repetida é contrato do Asaas ─────────────────────
describe("idempotência", () => {
  it("evento já processado não roda de novo", async () => {
    Object.assign(evento(), { processed_at: "2026-08-08T01:00:00Z" })
    await processAsaasEvent("evt_1")
    expect(gw.chamadas).toHaveLength(0)
  })

  it("segunda entrega do mesmo pagamento não dá baixa duas vezes", async () => {
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL })
    await processAsaasEvent("evt_1")
    expect(fatura().status).toBe("paid")

    Object.assign(evento(), { processed_at: null, error: null })
    await processAsaasEvent("evt_1")

    const baixas = db.log.filter((l) => l.tabela === "invoices" && l.op === "update")
    expect(baixas).toHaveLength(1)
  })
})
