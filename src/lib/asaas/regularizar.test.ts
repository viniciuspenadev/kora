// ═══════════════════════════════════════════════════════════════
// Regularizar — "primeiro cobra, depois troca" (regra do dono, 08/08)
// ═══════════════════════════════════════════════════════════════
//
// 🔑 A ORDEM É A FEATURE. O cartão só vira o cartão da assinatura DEPOIS de provar que
//    funciona. Se ele for recusado, nada muda — o cliente não termina com a assinatura
//    apontando pra um cartão pior que o anterior. Estes testes existem pra trancar isso:
//    metade deles não verifica o que ACONTECE, e sim o que **NÃO** acontece.
//
// 🔒 Zero produção: `vi.mock` troca banco, gateway e cifragem antes de qualquer import.

import { describe, it, expect, beforeEach, vi } from "vitest"
import { FakeDb } from "@/test/fakes/fake-db"
import { FakeGateway, AsaasError, mensagemSeguraDoGateway } from "@/test/fakes/fake-gateway"

const db = new FakeDb()
let gw = new FakeGateway()

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: (t: string) => db.from(t) } }))
vi.mock("./client", () => ({
  get asaas() { return gw.client },
  AsaasError,
  mensagemSeguraDoGateway,
}))
vi.mock("@/lib/crypto/secrets", () => ({ encryptSecret: (s: string) => `enc:v1:${s}` }))

const { regularizarComCartao, acharCobrancaEmAberto } = await import("./subscriptions")

const TENANT   = "33333333-3333-3333-3333-333333333333"
const CUSTOMER = "cus_kora"
const SUB      = "sub_nossa"

const CARTAO  = { holderName: "MOISES PENA", number: "4242424242424242", expiryMonth: "12", expiryYear: "2030", ccv: "123" }
const TITULAR = { name: "Moises Pena", email: "m@x.com", cpfCnpj: "10526979844", postalCode: "03734130", addressNumber: "101", phone: "11940175730" }

const tenant = () => db.linhas("tenants")[0]

/** Estado-base: cartão ANTIGO gravado, uma cobrança vencida da nossa assinatura. */
function cenario(over: { cobrancas?: unknown[] } = {}) {
  db.tabelas.clear(); db.log.length = 0
  db.seed("tenants", [{
    id: TENANT, asaas_customer_id: CUSTOMER, asaas_subscription_id: SUB,
    billing_mode: "gateway",
    asaas_card_token: "enc:v1:token_ANTIGO", card_brand: "visa", card_last4: "1111",
  }])
  gw = new FakeGateway()
  gw.responde("GET /payments?customer=cus_kora&status=OVERDUE",
    { data: over.cobrancas ?? [{ id: "pay_venc", value: 349.9, dueDate: "2026-08-01", subscription: SUB }] })
  gw.responde("GET /payments?customer=cus_kora&status=PENDING", { data: [] })
  gw.responde("POST /creditCard/tokenize", { creditCardToken: "tok_NOVO", creditCardBrand: "MASTERCARD", creditCardNumber: "8003" })
}

const regularizar = () => regularizarComCartao(TENANT, CARTAO, TITULAR, "1.2.3.4")

beforeEach(() => cenario())

// ── O caminho feliz ─────────────────────────────────────────────────────────
describe("caminho feliz", () => {
  it("cobra a vencida, troca o cartão e grava o rótulo novo", async () => {
    gw.responde("POST /payments/pay_venc/payWithCreditCard", { status: "CONFIRMED", value: 349.9 })
    gw.responde("POST /subscriptions/sub_nossa/creditCard", {})

    const r = await regularizar()

    expect(r).toEqual({ ok: true, pagoCents: 34990, cartaoTrocado: true, outras: 0 })
    expect(tenant().asaas_card_token).toBe("enc:v1:tok_NOVO")
    expect(tenant().card_brand).toBe("mastercard")
    expect(tenant().card_last4).toBe("8003")
  })

  it("a COBRANÇA vem antes da TROCA — a ordem é a regra", async () => {
    gw.responde("POST /payments/pay_venc/payWithCreditCard", { status: "CONFIRMED" })
    gw.responde("POST /subscriptions/sub_nossa/creditCard", {})

    await regularizar()

    const paths = gw.chamadas.map((c) => c.path)
    const iCobra = paths.findIndex((p) => p.includes("payWithCreditCard"))
    const iTroca = paths.findIndex((p) => p.includes("/creditCard") && p.startsWith("/subscriptions"))
    expect(iCobra).toBeGreaterThan(-1)
    expect(iTroca).toBeGreaterThan(iCobra)
  })
})

// ── O que NÃO pode acontecer ────────────────────────────────────────────────
describe("recusado ⇒ NADA muda", () => {
  it("cartão recusado na COBRANÇA não troca o cartão da assinatura", async () => {
    gw.responde("POST /payments/pay_venc/payWithCreditCard", () => {
      throw new AsaasError(400, "Transação não autorizada: saldo insuficiente")
    })

    const r = await regularizar()

    expect("error" in r).toBe(true)
    // 🔑 O ponto: o cartão ANTIGO continua sendo o da assinatura.
    expect(tenant().asaas_card_token).toBe("enc:v1:token_ANTIGO")
    expect(tenant().card_brand).toBe("visa")
    expect(tenant().card_last4).toBe("1111")
    // E o gateway NUNCA foi chamado pra trocar.
    expect(gw.chamadas.some((c: { path: string }) => c.path.startsWith("/subscriptions/"))).toBe(false)
  })

  it("a mensagem da recusa é a frase única — não vira oráculo", async () => {
    gw.responde("POST /payments/pay_venc/payWithCreditCard", () => {
      throw new AsaasError(400, "Cartão bloqueado pelo emissor")
    })

    const r = await regularizar()

    expect((r as { error: string }).error)
      .toBe("Não conseguimos autorizar este cartão. Confira os dados, tente outro cartão ou fale com o seu banco.")
  })

  // ── H-03 · timeout é AMBÍGUO, recusa não é ──────────────────────────────
  //
  // 🔴 O FURO: qualquer exceção virava "não pagou". Mas um timeout pode ter sido processado
  //    com a resposta perdida — e a próxima tentativa refazia a BUSCA, que já não enxergava
  //    a cobrança recém-paga e pousava na **seguinte**. Um clique, duas parcelas.
  it("timeout com o pagamento JÁ confirmado ⇒ segue como sucesso, não cobra de novo", async () => {
    gw.responde("POST /payments/pay_venc/payWithCreditCard", () => { throw new Error("socket hang up") })
    // O POST tinha dado certo lá no gateway; só a resposta se perdeu.
    gw.responde("GET /payments/pay_venc", { id: "pay_venc", status: "CONFIRMED", value: 349.9 })

    const r = await regularizar()

    expect("error" in r).toBe(false)
    // 🔑 A prova de que não houve segunda cobrança: o `payWithCreditCard` foi chamado UMA vez.
    expect(gw.chamadas.filter((c: { path: string }) => c.path.includes("payWithCreditCard"))).toHaveLength(1)
  })

  it("timeout SEM conseguir reconsultar ⇒ diz 'não sabemos' e desencoraja o 2º clique", async () => {
    gw.responde("POST /payments/pay_venc/payWithCreditCard", () => { throw new Error("socket hang up") })
    gw.responde("GET /payments/pay_venc", () => { throw new Error("gateway fora do ar") })

    const r = await regularizar()

    expect((r as { error: string }).error).toContain("não repita a cobrança")
    // Nada foi trocado: sem saber se pagou, não se mexe em nada.
    expect(tenant().asaas_card_token).toBe("enc:v1:token_ANTIGO")
  })

  it("cartão recusado na TOKENIZAÇÃO nem chega a cobrar", async () => {
    gw.responde("POST /creditCard/tokenize", () => { throw new AsaasError(400, "cartão inválido") })

    const r = await regularizar()

    expect("error" in r).toBe(true)
    expect(gw.chamadas.some((c: { path: string }) => c.path.includes("payWithCreditCard"))).toBe(false)
    expect(tenant().card_last4).toBe("1111")
  })

  it("status inesperado do gateway NÃO conta como pago", async () => {
    gw.responde("POST /payments/pay_venc/payWithCreditCard", { status: "PENDING" })

    const r = await regularizar()

    expect("error" in r).toBe(true)
    expect(tenant().card_last4).toBe("1111")
  })
})

// ── O estado residual que não dá pra eliminar ───────────────────────────────
describe("pagou mas a troca falhou", () => {
  it("mantém o pagamento e avisa que o cartão NÃO foi trocado", async () => {
    gw.responde("POST /payments/pay_venc/payWithCreditCard", { status: "CONFIRMED" })
    gw.responde("POST /subscriptions/sub_nossa/creditCard", () => { throw new AsaasError(500, "indisponível") })

    const r = await regularizar()

    // 🔑 NÃO devolve erro: o dinheiro entrou e a fatura vai baixar pelo webhook. Devolver
    //    erro faria a pessoa pagar de novo.
    expect(r).toEqual({ ok: true, pagoCents: 34990, cartaoTrocado: false, outras: 0 })
    // E o rótulo NÃO é atualizado — o cartão da assinatura continua sendo o antigo.
    expect(tenant().card_last4).toBe("1111")
  })
})

// ── Tenancy e isolamento ────────────────────────────────────────────────────
describe("isolamento", () => {
  it("cobrança de OUTRA assinatura no mesmo customer é ignorada", async () => {
    cenario({ cobrancas: [{ id: "pay_alheia", value: 5, dueDate: "2026-07-01", subscription: "sub_de_outro" }] })

    const c = await acharCobrancaEmAberto(TENANT)
    expect(c).toBeNull()

    const r = await regularizar()
    expect(r).toEqual({ error: "Não há cobrança em aberto nesta conta." })
  })

  it("cobrança AVULSA (sem assinatura) é ignorada", async () => {
    cenario({ cobrancas: [{ id: "pay_avulsa", value: 5, dueDate: "2026-07-01" }] })

    expect(await acharCobrancaEmAberto(TENANT)).toBeNull()
  })

  it("tenant `manual` não tem cobrança pra regularizar aqui", async () => {
    tenant().billing_mode = "manual"

    expect(await acharCobrancaEmAberto(TENANT)).toBeNull()
  })

  it("gateway fora ⇒ 'não sei', nunca 'está tudo pago'", async () => {
    gw.timeoutEm("GET /payments?customer=cus_kora&status=OVERDUE")

    expect(await acharCobrancaEmAberto(TENANT)).toBeUndefined()
    const r = await regularizar()
    expect((r as { error: string }).error).toContain("Não conseguimos consultar")
  })
})

// ── Várias em aberto ────────────────────────────────────────────────────────
describe("mais de uma cobrança vencida", () => {
  it("paga a MAIS ANTIGA e informa quantas sobram", async () => {
    cenario({ cobrancas: [
      { id: "pay_nova",  value: 349.9, dueDate: "2026-08-01", subscription: SUB },
      { id: "pay_velha", value: 349.9, dueDate: "2026-07-01", subscription: SUB },
    ] })
    gw.responde("POST /payments/pay_velha/payWithCreditCard", { status: "CONFIRMED" })
    gw.responde("POST /subscriptions/sub_nossa/creditCard", {})

    const r = await regularizar()

    expect(r).toEqual({ ok: true, pagoCents: 34990, cartaoTrocado: true, outras: 1 })
    // Cobrou a de julho, não a de agosto.
    expect(gw.chamadas.some((c: { path: string }) => c.path === "/payments/pay_velha/payWithCreditCard")).toBe(true)
    expect(gw.chamadas.some((c: { path: string }) => c.path === "/payments/pay_nova/payWithCreditCard")).toBe(false)
  })
})
