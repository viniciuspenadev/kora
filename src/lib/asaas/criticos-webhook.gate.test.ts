// ═══════════════════════════════════════════════════════════════
// PORTÃO DOS CRÍTICOS — caminho do webhook (C-01, C-02 + regra do owner)
// ═══════════════════════════════════════════════════════════════
//
// 🔴 ESTES TESTES DEVEM FALHAR HOJE. Isso não é defeito da suíte — é o ponto.
//    Eles afirmam **a regra**, não o que o código faz. Ficam vermelhos até a refundação
//    do núcleo de dinheiro ([docs/billing-core-refoundation-design.md]) estar de pé, e é
//    exatamente isso que os torna um portão: "corrigido" deixa de ser opinião.
//
// ⚠️ POR QUE NÃO RODAM NO `npm test`: ficariam vermelhos por dias e normalizariam
//    suíte vermelha. Rodam por `npm run test:gate`, que é o critério de aceite de cada
//    fase. Quando os 4 ficarem verdes (fim da F5), migram para a suíte normal.
//
// 🔑 A ARMADILHA QUE ISTO EVITA: os testes de ataque originais AFIRMAVAM o defeito
//    (passavam com o código quebrado). Assim, a correção os deixaria vermelhos e a reação
//    natural seria "consertar o teste" — devolvendo a expectativa errada ao código.
//    Não é hipótese: `webhook-handler.test.ts:207-220` faz isso hoje com o C-02, e é por
//    isso que 126 testes passam com quatro buracos abertos. Teste de dinheiro descreve a
//    REGRA; nunca o comportamento atual.
//
// Roda 100% em memória (FakeDb + FakeGateway). Não toca banco nem Asaas.

import { describe, it, expect, beforeEach, vi } from "vitest"
import { FakeDb } from "@/test/fakes/fake-db"
import { FakeGateway, AsaasError, mensagemSeguraDoGateway } from "@/test/fakes/fake-gateway"

const db = new FakeDb()
let gw = new FakeGateway()

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: (t: string) => db.from(t),
    rpc: (name: string, args: Record<string, unknown>) => db.rpc(name, args),
  },
}))
vi.mock("@/lib/asaas/client", () => ({
  get asaas() { return gw.client },
  AsaasError,
  mensagemSeguraDoGateway,
}))
vi.mock("@/lib/plans", () => ({ applyPlan: async () => ({ ok: true }) }))
vi.mock("@/lib/billing", () => ({ generateInvoiceForTenant: async () => ({ id: undefined, skipped: true, error: undefined }) }))
vi.mock("@/lib/billing/notify", () => ({ avisarCobranca: async () => {} }))
vi.mock("@/lib/billing/audit", () => ({ auditarCobranca: async () => {} }))

const { processAsaasEvent } = await import("@/lib/asaas/webhook-handler")

const TENANT   = "11111111-1111-1111-1111-111111111111"
const CUSTOMER = "cus_kora"
const SUB      = "sub_1"

function tenantRow(over: Record<string, unknown> = {}) {
  return {
    id: TENANT, asaas_customer_id: CUSTOMER, asaas_subscription_id: SUB,
    subscription_ends_at: null, subscription_status: "active",
    past_due_since: null, past_due_grace_days: null,
    lifecycle_state: "active", billing_mode: "gateway", plan_id: "plan_1",
    active: true, plans: { price_cents: 34990 }, ...over,
  }
}
function ev(id: string, tipo: string, pay: string) {
  return {
    id, event_type: tipo, payment_id: pay, received_at: "2026-08-08T00:00:00Z",
    processed_at: null, claimed_at: null, error: null,
    payload: { dateCreated: "2026-08-08T00:00:00.000Z", payment: { id: pay, customer: CUSTOMER } },
  }
}
const invoice = (id: string) => db.linhas("invoices").find((i) => i.id === id)!
const evento  = (id: string) => db.linhas("asaas_webhook_events").find((e) => e.id === id)!

beforeEach(() => {
  gw = new FakeGateway()
  db.tabelas.clear()
  db.log.length = 0
})

// ───────────────────────────────────────────────────────────────
describe("C-01 · um pagamento é creditado UMA vez, para sempre", () => {
  it("REGRA: a liquidação tardia de um pagamento já contabilizado não credita de novo", async () => {
    db.seed("tenants", [tenantRow()])
    // Ciclo N: fatura de 429,80 com 349,90 já recebidos de pay_A.
    db.seed("invoices", [
      { id: "inv_N", tenant_id: TENANT, status: "partial", total_cents: 42980, paid_cents: 34990,
        due_date: "2026-07-11", period_start: "2026-07-01", period_end: "2026-07-31",
        kind: "recorrente", gateway_ref: "pay_A", gateway_charge_id: "pay_A", paid_at: null },
    ])
    db.seed("invoice_payments", [{
      id: "fact_pay_A", tenant_id: TENANT, invoice_id: "inv_N", provider: "asaas",
      event_key: "pagamento:pay_A", payment_id: "pay_A", kind: "pagamento",
      amount_cents: 34990, occurred_at: "2026-07-11T00:00:00.000Z", source: "webhook",
    }])
    // O complemento pay_B quita a parcial — e hoje sobrescreve o único vestígio de pay_A.
    db.seed("asaas_webhook_events", [ev("evt_B", "PAYMENT_CONFIRMED", "pay_B")])
    gw.responde("GET /payments/pay_B", { id: "pay_B", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB, value: 79.9, dueDate: "2026-07-11" })
    await processAsaasEvent("evt_B")

    // Ciclo N+1 nasce aberto.
    db.linhas("invoices").push({ id: "inv_N1", tenant_id: TENANT, status: "open", total_cents: 42980,
      paid_cents: 0, due_date: "2026-08-11", period_start: "2026-08-01", period_end: "2026-08-31",
      kind: "recorrente", gateway_ref: null, paid_at: null })

    // Liquidação de pay_A (~D+30): MESMO pagamento, evento NOVO — o claim/lease não vê isso,
    // porque ele protege a linha do EVENTO, não o fato financeiro.
    db.linhas("asaas_webhook_events").push(ev("evt_A_recebido", "PAYMENT_RECEIVED", "pay_A"))
    gw.responde("GET /payments/pay_A", { id: "pay_A", status: "RECEIVED", customer: CUSTOMER, subscription: SUB, value: 349.9 })
    await processAsaasEvent("evt_A_recebido")

    // pay_A já foi aplicado em inv_N. A fatura do ciclo seguinte não recebeu dinheiro nenhum.
    expect(invoice("inv_N1").paid_cents).toBe(0)
    expect(invoice("inv_N1").status).toBe("open")
  })

  it("REGRA: dinheiro que não pôde ser aplicado NÃO fecha o evento como sucesso", async () => {
    db.seed("tenants", [tenantRow()])
    db.seed("invoices", [
      { id: "inv_X", tenant_id: TENANT, status: "open", total_cents: 60000, paid_cents: 0,
        due_date: "2026-08-11", period_start: "2026-08-01", period_end: "2026-08-31",
        kind: "recorrente", gateway_ref: null, paid_at: null },
    ])
    db.seed("asaas_webhook_events", [
      ev("evt_1", "PAYMENT_CONFIRMED", "pay_1"),
      ev("evt_2", "PAYMENT_CONFIRMED", "pay_2"),
    ])
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB, value: 600, dueDate: "2026-08-11" })
    gw.responde("GET /payments/pay_2", { id: "pay_2", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB, value: 600, dueDate: "2026-08-11" })

    await processAsaasEvent("evt_1")
    await processAsaasEvent("evt_2")   // segundo pagamento de 600 numa fatura de 600 já quitada

    // Decisão do owner (11/08): "não tem como o cliente pagar a mais" ⇒ se acontecer, é
    // ANOMALIA. O evento não pode ser arquivado como sucesso limpo, senão o dinheiro some
    // sem deixar rastro e o sistema registra que deu certo.
    expect(evento("evt_2").error).not.toBeNull()
  })
})

// ───────────────────────────────────────────────────────────────
describe("C-02 · o pagamento pousa no período a que pertence", () => {
  it("REGRA: cobrança do ciclo N+1 não é absorvida pela parcial do ciclo N", async () => {
    db.seed("tenants", [tenantRow()])
    // Só a parcial do ciclo N existe — o cron do ciclo N+1 ainda não rodou.
    db.seed("invoices", [
      { id: "inv_N", tenant_id: TENANT, status: "partial", total_cents: 42980, paid_cents: 34990,
        due_date: "2026-07-11", period_start: "2026-07-01", period_end: "2026-07-31",
        kind: "recorrente", gateway_ref: "pay_A", paid_at: null },
    ])
    db.seed("asaas_webhook_events", [ev("evt_C", "PAYMENT_CONFIRMED", "pay_C")])
    // Cobrança do ciclo N+1: 429,80.
    gw.responde("GET /payments/pay_C", { id: "pay_C", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB, value: 429.8, dueDate: "2026-08-11" })

    await processAsaasEvent("evt_C")

    // Hoje: 34990 + 42980 = 77970, capado em 42980 ⇒ R$ 349,90 evaporam e a fatura do
    // ciclo N é marcada paga com dinheiro do ciclo seguinte.
    // Regra: a fatura de N não é tocada por um pagamento que não é dela.
    expect(invoice("inv_N").paid_cents).toBe(34990)
    expect(invoice("inv_N").gateway_ref).toBe("pay_A")
    expect(db.linhas("invoice_payments").find((p) => p.payment_id === "pay_C")?.invoice_id).toBeNull()
    expect(evento("evt_C").error).toContain("suspenso")
  })

  it("REGRA: com N e N+1 existentes, dueDate aplica exclusivamente em N+1", async () => {
    db.seed("tenants", [tenantRow()])
    db.seed("invoices", [
      { id: "inv_N", tenant_id: TENANT, status: "partial", total_cents: 42980, paid_cents: 34990,
        due_date: "2026-07-11", period_start: "2026-07-01", period_end: "2026-07-31",
        kind: "recorrente", gateway_ref: "pay_A", gateway_charge_id: "pay_A", paid_at: null },
      { id: "inv_N1", tenant_id: TENANT, status: "open", total_cents: 42980, paid_cents: 0,
        due_date: "2026-08-11", period_start: "2026-08-01", period_end: "2026-08-31",
        kind: "recorrente", gateway_ref: null, gateway_charge_id: null, paid_at: null },
    ])
    db.seed("asaas_webhook_events", [ev("evt_C", "PAYMENT_CONFIRMED", "pay_C")])
    gw.responde("GET /payments/pay_C", { id: "pay_C", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB, value: 429.8, dueDate: "2026-08-11" })

    await processAsaasEvent("evt_C")

    expect(invoice("inv_N")).toMatchObject({ paid_cents: 34990, status: "partial", gateway_ref: "pay_A" })
    expect(invoice("inv_N1")).toMatchObject({ paid_cents: 42980, status: "paid", gateway_ref: "pay_C" })
  })

  it("REGRA: dueDate não toma fatura já vinculada a outra cobrança", async () => {
    db.seed("tenants", [tenantRow()])
    db.seed("invoices", [{
      id: "inv_ja_vinculada", tenant_id: TENANT, status: "open", total_cents: 34990, paid_cents: 0,
      due_date: "2026-08-11", period_start: "2026-08-01", period_end: "2026-08-31",
      kind: "recorrente", gateway_ref: "pay_original", gateway_charge_id: "pay_original", paid_at: null,
    }])
    db.seed("invoice_items", [{
      id: "item_inv_ja_vinculada", invoice_id: "inv_ja_vinculada", kind: "plan", amount_cents: 34990,
    }])
    db.seed("invoice_payments", [])
    db.seed("asaas_webhook_events", [ev("evt_intruso", "PAYMENT_CONFIRMED", "pay_intruso")])
    gw.responde("GET /payments/pay_intruso", {
      id: "pay_intruso", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB,
      value: 349.9, dueDate: "2026-08-11", dateCreated: "2026-08-08T00:00:00.000Z",
    })
    const antes = structuredClone(invoice("inv_ja_vinculada"))

    await processAsaasEvent("evt_intruso")

    // `dueDate` prova o PERÍODO, não transfere a identidade de uma invoice que já pertence
    // a outro charge/ref. O dinheiro novo fica suspenso e a projeção antiga permanece intacta.
    expect(invoice("inv_ja_vinculada")).toEqual(antes)
    expect(db.linhas("invoice_payments").find((p) => p.payment_id === "pay_intruso")?.invoice_id).toBeNull()
    expect(String(evento("evt_intruso").error)).toContain("suspenso")
  })
})

// ───────────────────────────────────────────────────────────────
describe("Regra do owner (11/08) · pagamento parcial não libera nada", () => {
  it("REGRA: pagamento menor que a fatura não reativa a conta", async () => {
    // "Pagamento parcial no Kora não libera nada. Pra ativar, ele seleciona o plano.
    //  Pagou, aí libera." — owner, 2026-08-11.
    // Hoje `liberar()` reativa ANTES de dar baixa, então qualquer confirmação destrava.
    db.seed("tenants", [tenantRow({
      subscription_status: "past_due",
      past_due_since: "2026-08-01T00:00:00Z",
    })])
    db.seed("invoices", [
      { id: "inv_P", tenant_id: TENANT, status: "open", total_cents: 42980, paid_cents: 0,
        due_date: "2026-08-11", period_start: "2026-08-01", period_end: "2026-08-31",
        kind: "recorrente", gateway_ref: null, paid_at: null },
    ])
    db.seed("asaas_webhook_events", [ev("evt_parcial", "PAYMENT_CONFIRMED", "pay_parcial")])
    // Paga só o valor do plano (349,90) numa fatura de 429,80 — falta o excedente.
    gw.responde("GET /payments/pay_parcial", { id: "pay_parcial", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB, value: 349.9, dueDate: "2026-08-11" })

    await processAsaasEvent("evt_parcial")

    const t = db.linhas("tenants")[0]
    expect(t.subscription_status).not.toBe("active")
  })
})
