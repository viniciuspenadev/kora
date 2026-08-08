// ═══════════════════════════════════════════════════════════════
// Criação da assinatura — os caminhos que cobram duas vezes
// ═══════════════════════════════════════════════════════════════
//
// 🔴 Este é o arquivo onde mora o pior desfecho possível do produto: **duas assinaturas
//    mensais para o mesmo cliente**, a primeira cobrando invisível. O pentest de 08/08
//    achou uma porta (P0-1); a revalidação achou que a correção tinha deixado outra aberta.
//    Nenhuma das duas é alcançável clicando no fluxo — só quebrando o gateway ou a chave de
//    cifragem de propósito, que é o que estes testes fazem.
//
// 🔒 Zero produção: `vi.mock` troca banco, gateway, cifragem e cliente Asaas antes de
//    qualquer import. Não existe chave, não existe conta merchant, não existe rede.

import { describe, it, expect, beforeEach, vi } from "vitest"
import { FakeDb } from "@/test/fakes/fake-db"
import { FakeGateway, AsaasError, mensagemSeguraDoGateway } from "@/test/fakes/fake-gateway"

const db = new FakeDb()
let gw = new FakeGateway()
let cifrarLanca = false

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: (t: string) => db.from(t) } }))
vi.mock("./client", () => ({
  get asaas() { return gw.client },
  AsaasError,
  mensagemSeguraDoGateway,
}))
vi.mock("@/lib/crypto/secrets", () => ({
  encryptSecret: (s: string) => {
    // Reproduz o fail-closed real: em produção sem chave, `encryptSecret` LANÇA.
    if (cifrarLanca) throw new Error("ENCRYPTION_KEY ausente/inválida")
    return `enc:v1:${s}`
  },
}))
vi.mock("./customers", () => ({ ensureAsaasCustomer: async () => ({ id: "cus_kora" }) }))

const { createSubscriptionForTenant } = await import("./subscriptions")

const TENANT = "22222222-2222-2222-2222-222222222222"
const PLANO  = "plan_1"

const CARTAO = { holderName: "MOISES PENA", number: "4242424242424242", expiryMonth: "12", expiryYear: "2030", ccv: "123" }
const TITULAR = { name: "Moises Pena", email: "m@x.com", cpfCnpj: "10526979844", postalCode: "03734130", addressNumber: "101", phone: "11940175730" }

const tenant = () => db.linhas("tenants")[0]

beforeEach(() => {
  gw = new FakeGateway()
  cifrarLanca = false
  db.tabelas.clear()
  db.seed("tenants", [{
    id: TENANT, asaas_customer_id: "cus_kora", asaas_subscription_id: null,
    billing_mode: "gateway", plan_id: null, billing_day: null,
    asaas_card_token: null, card_brand: null, card_last4: null, subscription_ends_at: null,
  }])
  db.seed("plans", [{ id: PLANO, name: "PLANO III", price_cents: 34990, active: true }])
  gw.responde("POST /creditCard/tokenize", { creditCardToken: "tok_1", creditCardBrand: "VISA", creditCardNumber: "4242" })
})

const criar = () => createSubscriptionForTenant(TENANT, PLANO, CARTAO, TITULAR, "1.2.3.4")

describe("P0-1 — cifragem falha ANTES de o gateway criar qualquer coisa", () => {
  it("chave quebrada ⇒ nenhuma assinatura é criada e a vaga é devolvida", async () => {
    cifrarLanca = true
    gw.responde("POST /subscriptions", { id: "sub_1" })

    const r = await criar()

    expect("error" in r).toBe(true)
    // 🔑 O ponto do teste: o gateway NUNCA foi chamado pra criar. Antes, a cifragem
    //    acontecia depois do POST — a assinatura nascia, o cartão era debitado, e o erro
    //    soltava a vaga liberando uma SEGUNDA tentativa.
    expect(gw.chamadas.some((c) => c.path === "/subscriptions")).toBe(false)
    expect(tenant().asaas_subscription_id).toBeNull()   // vaga devolvida, sem resíduo
  })

  it("caminho feliz grava token cifrado, bandeira e 4 últimos JUNTOS", async () => {
    gw.responde("POST /subscriptions", { id: "sub_1" })

    const r = await criar()

    expect(r).toEqual({ id: "sub_1" })
    expect(tenant().asaas_subscription_id).toBe("sub_1")
    expect(tenant().asaas_card_token).toBe("enc:v1:tok_1")
    expect(tenant().card_brand).toBe("visa")
    expect(tenant().card_last4).toBe("4242")
    expect(tenant().plan_id).toBe(PLANO)
  })
})

describe("timeout na criação — 'não respondeu' não é 'não criou'", () => {
  it("timeout + assinatura EXISTE no gateway ⇒ adota, não cria a segunda", async () => {
    gw.timeoutEm("POST /subscriptions")
    gw.responde("GET /subscriptions?externalReference=", { data: [{ id: "sub_criada_no_escuro", status: "ACTIVE" }] })

    const r = await criar()

    expect(r).toEqual({ id: "sub_criada_no_escuro" })
    expect(tenant().asaas_subscription_id).toBe("sub_criada_no_escuro")
    expect(tenant().asaas_card_token).toBe("enc:v1:tok_1")
  })

  it("timeout + gateway confirma que NÃO existe ⇒ solta a vaga (pode tentar de novo)", async () => {
    gw.timeoutEm("POST /subscriptions")
    gw.responde("GET /subscriptions?externalReference=", { data: [] })

    const r = await criar()

    expect("error" in r).toBe(true)
    expect(tenant().asaas_subscription_id).toBeNull()
  })

  it("timeout + a consulta TAMBÉM falha ⇒ NÃO solta a vaga (não sei ≠ não existe)", async () => {
    gw.timeoutEm("POST /subscriptions")
    gw.timeoutEm("GET /subscriptions?externalReference=")

    const r = await criar()

    expect("error" in r).toBe(true)
    // 🔑 A reserva FICA. Presa é reparável; soltar no escuro cobra o cliente duas vezes.
    expect(String(tenant().asaas_subscription_id)).toMatch(/^pending:/)
  })
})

describe("claim atômico — dois cliques não viram duas assinaturas", () => {
  // ⚠️ A primeira versão deste teste esperava ERRO — e o comportamento real é melhor:
  //    devolve a assinatura que já existe. Recusar mostraria erro pra quem tem assinatura
  //    válida; devolver o id é idempotência de verdade (o replay do POST da Server Action
  //    resolve sozinho). O teste estava errado, o código não.
  it("tenant que JÁ tem assinatura devolve a existente, sem tocar no gateway", async () => {
    tenant().asaas_subscription_id = "sub_existente"

    const r = await criar()

    expect(r).toEqual({ id: "sub_existente" })
    expect(gw.chamadas.some((c) => c.path === "/subscriptions")).toBe(false)
  })

  it("reserva `pending:` em andamento BLOQUEIA a segunda tentativa concorrente", async () => {
    // Duas abas: a primeira já reservou a vaga, a segunda chega no mesmo instante.
    tenant().asaas_subscription_id = "pending:123:abc"

    const r = await criar()

    expect("error" in r).toBe(true)
    expect(String((r as { error: string }).error)).toContain("ativação em andamento")
    expect(gw.chamadas.some((c) => c.path === "/subscriptions")).toBe(false)
  })

  it("recusa do cartão solta a vaga e devolve a frase única (sem virar oráculo)", async () => {
    gw.responde("POST /creditCard/tokenize", () => {
      throw new AsaasError(400, "Transação não autorizada: saldo insuficiente")
    })

    const r = await criar()

    expect(r).toEqual({ error: "Não conseguimos autorizar este cartão. Confira os dados, tente outro cartão ou fale com o seu banco." })
    expect(tenant().asaas_subscription_id).toBeNull()
  })
})
