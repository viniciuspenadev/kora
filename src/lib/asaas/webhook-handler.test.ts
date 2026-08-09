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
// A aplicação de plano tem teste próprio; aqui interessa só se o handler REAGE ao resultado.
const applyPlanMock = vi.fn(async () => ({ ok: true as const }))
vi.mock("@/lib/plans", () => ({ applyPlan: (...a: unknown[]) => applyPlanMock(...(a as [])) }))
const gerarFaturaMock = vi.fn(async () => ({ id: "inv_nova" as string | undefined, skipped: false, error: undefined as string | undefined }))
vi.mock("@/lib/billing", () => ({ generateInvoiceForTenant: () => gerarFaturaMock() }))
// 🔑 ESPIÃO, NÃO SÓ MOCK. O defeito que os e-mails vieram consertar não era e-mail errado —
//    era e-mail **nunca chamado** (`resolveBillingRecipients` e `dedupeKey` ficaram prontos e
//    sem chamador). Só o teste do disparador não pegaria isso: quem tem que provar a fiação
//    é o lado que dispara. O conteúdo tem teste próprio em `billing/notify.test.ts`.
interface AvisoCapturado {
  aviso: string; fato: string
  valorCents?: number | null; quando?: string | null; diasCarencia?: number
}
const avisarMock = vi.fn(async (_a: AvisoCapturado) => {})
vi.mock("@/lib/billing/notify", () => ({ avisarCobranca: (a: unknown) => avisarMock(a as AvisoCapturado) }))
/** Os avisos disparados até agora, por nome. */
const avisos = () => avisarMock.mock.calls.map((c) => c[0].aviso)
const primeiroAviso = () => avisarMock.mock.calls[0][0]

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
    // ⚠️ Explícitos porque no banco a COLUNA existe sempre — omitir aqui faria o dublê
    //    devolver `undefined` onde o Postgres devolve `null`, e um teste passaria (ou
    //    reprovaria) por uma diferença que a produção não tem.
    past_due_since: null,
    past_due_grace_days: null,
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
  avisarMock.mockClear()
  montarCenario()
})

// ── P0-4 · falha transitória não pode virar definitiva ──────────────────────
describe("P0-4 — falha transitória deixa o evento PENDENTE", () => {
  it("falha de banco ao liberar NÃO fecha o evento (antes: perdido para sempre)", async () => {
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL, value: 349.9 })
    db.falharEm({ tabela: "tenants", op: "update", vezes: 1, msg: "conexão caiu" })

    await processAsaasEvent("evt_1")

    expect(evento().processed_at).toBeNull()
    expect(String(evento().error)).toContain("falha ao liberar")
  })

  it("applyPlan que falha mantém o evento pendente — cliente pagou e não recebeu módulos", async () => {
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL, value: 349.9 })
    applyPlanMock.mockResolvedValue({ ok: false, error: "upsert falhou" } as never)

    await processAsaasEvent("evt_1")

    expect(evento().processed_at).toBeNull()
    expect(String(evento().error)).toContain("plano não aplicado")
  })

  it("reprocessar depois que o banco volta conclui e fecha", async () => {
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL, value: 349.9 })
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
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL, value: 349.9 })
    // O cancelamento já aconteceu: fim de ciclo carimbado e vínculo zerado.
    Object.assign(tenant(), { subscription_ends_at: "2026-09-11", asaas_subscription_id: null })

    await processAsaasEvent("evt_1")

    expect(tenant().subscription_ends_at).toBe("2026-09-11")   // NÃO foi zerado
    expect(tenant().subscription_status).not.toBe("canceled")  // nem forçado a active indevidamente
  })
})

// ── H-2 · piso de aceite ────────────────────────────────────────────────────
//
// 🔴 O VALOR AGORA VEM DO GATEWAY, NUNCA DO PAYLOAD (H-01 do pentest de 08/08). Estes
//    testes passaram a stubar `value` no `GET /payments/{id}`, que é a fonte autoritativa.
//    Quem tentar voltar a ler do `ev.payload` reprova aqui.
describe("H-2 — piso é o preço do plano, não o total da fatura", () => {
  // 🔴 ESTE TESTE AFIRMAVA O FURO — e o relatório do pentest citou exatamente ele como
  //    prova: *"o teste atual ratifica esse comportamento: paga o valor do PLANO com fatura
  //    tendo excedente ⇒ QUITA"*. Ele descrevia com precisão o que o código fazia, e o que
  //    o código fazia era apagar receita entregue.
  // 🔑 Com `paid_cents` + `partial`, o estado passou a ser REPRESENTÁVEL: a fatura diz o
  //    que devia e o que recebeu, em vez de fingir que está quitada.
  it("paga só o plano numa fatura COM excedente ⇒ PARCIAL, com a diferença registrada", async () => {
    fatura().total_cents = 42980            // plano 349,90 + 1 usuário extra 79,90
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL, value: 349.9 })

    await processAsaasEvent("evt_1")

    expect(fatura().status).toBe("partial")
    expect(fatura().paid_cents).toBe(34990)
    expect(fatura().gateway_ref).toBe("pay_1")
    // ⚠️ Parcial NÃO tem data de pagamento: ela tem um recebimento. Carimbar `paid_at`
    //    faria toda contagem de "faturas pagas" incluí-la.
    expect(fatura().paid_at).toBeNull()
  })

  it("pagou o total ⇒ QUITA, com `paid_cents` igual ao devido", async () => {
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL, value: 349.9 })

    await processAsaasEvent("evt_1")

    expect(fatura().status).toBe("paid")
    expect(fatura().paid_cents).toBe(34990)
    expect(fatura().paid_at).not.toBeNull()
  })

  // 🔴 O CRÍTICO QUE O QA ACHOU (09/08). Botar `partial` na mesma busca ordenada pela mais
  //    ANTIGA fazia a cobrança do ciclo SEGUINTE pousar na fatura parcial do ciclo anterior:
  //    `paid_cents` passava do total (quebrando a invariante 2), a fatura corrente ficava
  //    `open` PARA SEMPRE, e o cliente que pagou tudo lia "fatura vencida" indefinidamente.
  it("havendo fatura ABERTA, o pagamento vai nela — não na parcial antiga", async () => {
    db.seed("invoices", [
      { id: "inv_velha", tenant_id: TENANT, status: "partial", total_cents: 42980, paid_cents: 34990, due_date: "2026-07-11", gateway_ref: null },
      { id: "inv_nova",  tenant_id: TENANT, status: "open",    total_cents: 42980, paid_cents: 0,     due_date: "2026-08-11", gateway_ref: null },
    ])
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL, value: 429.8 })

    await processAsaasEvent("evt_1")

    const velha = db.linhas("invoices").find((i) => i.id === "inv_velha")!
    const nova  = db.linhas("invoices").find((i) => i.id === "inv_nova")!
    expect(nova.status).toBe("paid")
    expect(nova.paid_cents).toBe(42980)
    // A antiga NÃO é tocada: ninguém a está pagando — a gente é que nunca a cobrou inteira.
    expect(velha.paid_cents).toBe(34990)
    expect(velha.status).toBe("partial")
  })

  it("recebido maior que o devido é CAPADO — a invariante 2 não pode quebrar", async () => {
    fatura().total_cents = 10000
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL, value: 349.9 })

    await processAsaasEvent("evt_1")

    expect(fatura().paid_cents).toBe(10000)   // nunca > total_cents
    expect(fatura().status).toBe("paid")
  })

  // 🔑 O segundo pagamento tem que SOMAR. Sobrescrever faria uma fatura quitada em duas
  //    parcelas parecer eternamente parcial — e o cliente seria cobrado de novo.
  it("sem fatura aberta, o complemento encontra a parcial e quita", async () => {
    fatura().total_cents = 42980
    fatura().paid_cents  = 34990
    fatura().status      = "partial"
    evento().payment_id  = "pay_2"
    evento().payload     = { payment: { id: "pay_2", customer: CUSTOMER } }
    gw.responde("GET /payments/pay_2", { id: "pay_2", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL, value: 79.9 })

    await processAsaasEvent("evt_1")

    expect(fatura().paid_cents).toBe(42980)
    expect(fatura().status).toBe("paid")
  })

  it("paga MENOS que o plano ⇒ não quita e fica pendente pra revisão", async () => {
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL, value: 5 })

    await processAsaasEvent("evt_1")

    expect(fatura().status).toBe("open")
    expect(String(evento().error)).toContain("menor que o preço do plano")
  })

  // 🔒 H-01 — O FURO QUE ISTO TRANCA. O payload é o corpo da requisição: quem tiver o token
  //    do webhook o escreve. Antes, **omitir** `value` fazia `pago` virar `null`, o piso ser
  //    PULADO, e a fatura ser quitada sem comprovação nenhuma.
  it("payload mente sobre o valor ⇒ o gateway vence e a fatura NÃO quita", async () => {
    evento().payload = { payment: { id: "pay_1", customer: CUSTOMER, value: 999999 } }
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL, value: 5 })

    await processAsaasEvent("evt_1")

    expect(fatura().status).toBe("open")
    expect(String(evento().error)).toContain("menor que o preço do plano")
  })

  it("gateway sem valor ⇒ baixa ADIADA (antes: quitava sem comprovação)", async () => {
    evento().payload = { payment: { id: "pay_1", customer: CUSTOMER } }   // sem `value`
    // ⚠️ NÃO ADICIONE `value` AQUI. A ausência dele É o cenário — um "conserto" em massa
    //    dos stubs já apagou este teste uma vez, e ele voltou verde mentindo.
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL /* sem value: proposital */ })

    await processAsaasEvent("evt_1")

    expect(fatura().status).toBe("open")
    // ⚠️ Fica PENDENTE, não fechado: o reconcile retenta por 7 dias. E o tenant já foi
    //    reativado antes desta função, então quem pagou não fica cortado esperando o livro.
    expect(evento().processed_at).toBeNull()
    expect(tenant().subscription_status).toBe("active")
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
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL, value: 349.9 })
    await processAsaasEvent("evt_1")
    expect(fatura().status).toBe("paid")

    Object.assign(evento(), { processed_at: null, error: null })
    await processAsaasEvent("evt_1")

    const baixas = db.log.filter((l) => l.tabela === "invoices" && l.op === "update")
    expect(baixas).toHaveLength(1)
  })
})

// ── Avisos · o cliente precisa SABER antes de perder alguma coisa ───────────
//
// 🔴 O ESTADO ANTERIOR, medido em produção: `email_outbox` com ZERO e-mails de cobrança em
//    toda a história do produto. Os quatro slugs existiam no tipo, o seletor de
//    destinatário existia, a trava de idempotência existia — e nada chamava nada. O cliente
//    ia de saudável a cortado sem uma linha. Estes testes trancam a fiação, não o texto.
describe("avisos de cobrança", () => {
  it("cartão recusado avisa o cliente E NÃO mexe em estado nenhum (degrau 1 é do Asaas)", async () => {
    montarCenario({ evento: { event_type: "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED" } })

    await processAsaasEvent("evt_1")

    expect(avisos()).toEqual(["cartao_recusado"])
    // A razão de o evento ser "silencioso" continua valendo: o Asaas re-tenta sozinho.
    expect(tenant().subscription_status).toBe("active")
    expect(db.log.filter((l) => l.tabela === "tenants" && l.op === "update")).toHaveLength(0)
    expect(evento().processed_at).not.toBeNull()
  })

  it("a retentativa do MESMO pagamento reusa a chave de idempotência (não vira 4 e-mails)", async () => {
    montarCenario({ evento: { event_type: "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED" } })
    await processAsaasEvent("evt_1")

    const chamada = primeiroAviso()
    // A chave é o PAGAMENTO, nunca o evento: o Asaas manda um evento destes por tentativa.
    expect(chamada.fato).toBe("pay_1")
    expect(chamada.valorCents).toBe(34990)   // 349.9 do gateway vira centavos
  })

  it("pagamento de quem estava EM DIA confirma e não diz que algo 'voltou'", async () => {
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL, value: 349.9 })

    await processAsaasEvent("evt_1")

    expect(avisos()).toEqual(["pagamento_confirmado"])
  })

  it("pagamento de quem estava CORTADO confirma E anuncia o restabelecimento", async () => {
    montarCenario({ tenant: { subscription_status: "past_due" } })
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL, value: 349.9 })

    await processAsaasEvent("evt_1")

    expect(avisos()).toEqual(["pagamento_confirmado", "restabelecido"])
  })

  it("recibo sai mesmo com pendência de livro — o dinheiro do cliente entrou", async () => {
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL, value: 349.9 })
    applyPlanMock.mockResolvedValue({ ok: false, error: "upsert falhou" } as never)

    await processAsaasEvent("evt_1")

    expect(avisos()).toContain("pagamento_confirmado")
    expect(evento().processed_at).toBeNull()   // a pendência segue sendo nossa
  })

  it("liberação obsoleta (assinatura já encerrada) NÃO manda 'tudo funcionando normalmente'", async () => {
    montarCenario({ tenant: { asaas_subscription_id: null, subscription_ends_at: "2026-09-01T23:59:59Z" } })
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER })

    await processAsaasEvent("evt_1")

    expect(avisos()).toEqual([])
  })

  it("fatura vencida avisa; chargeback NÃO usa o mesmo texto", async () => {
    montarCenario({ evento: { event_type: "PAYMENT_OVERDUE" } })
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "OVERDUE", customer: CUSTOMER, subscription: SUB_ATUAL, value: 349.9, dueDate: "2026-08-11" })

    await processAsaasEvent("evt_1")

    expect(avisos()).toEqual(["fatura_vencida"])
    const c = primeiroAviso()
    // 🔑 Valor e vencimento vêm do GATEWAY, não do payload — o corpo do webhook é forjável.
    expect(c.valorCents).toBe(34990)
    expect(c.quando).toBe("2026-08-11")
    expect(c.diasCarencia).toBeGreaterThan(0)
  })

  it("chargeback restringe mas NÃO manda 'sua fatura está em aberto'", async () => {
    montarCenario({ evento: { event_type: "PAYMENT_CHARGEBACK_REQUESTED" } })
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CHARGEBACK_REQUESTED", customer: CUSTOMER, subscription: SUB_ATUAL })

    await processAsaasEvent("evt_1")

    expect(tenant().subscription_status).toBe("past_due")   // restringe, sim
    expect(avisos()).toEqual([])                            // mas isso pede gente, não template
  })

  it("gateway diz que o pagamento NÃO venceu ⇒ não restringe e não avisa", async () => {
    montarCenario({ evento: { event_type: "PAYMENT_OVERDUE" } })
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL, value: 349.9 })

    await processAsaasEvent("evt_1")

    expect(tenant().subscription_status).toBe("active")
    expect(avisos()).toEqual([])
  })
})

// ── O relógio da carência ───────────────────────────────────────────────────
//
// 🔴 SEM CARIMBO NÃO EXISTE CARÊNCIA — e o erro cai pro lado que fecha: `passouDaCarencia`
//    é fail-closed pela data, então um `past_due` sem `past_due_since` manda o cliente pro
//    paywall no primeiro segundo, sem um dia de prazo. É a "invariante 1" da migration.
function vencido(over: Record<string, unknown> = {}) {
  montarCenario({ tenant: over, evento: { event_type: "PAYMENT_OVERDUE" } })
  gw.responde("GET /payments/pay_1", {
    id: "pay_1", status: "OVERDUE", customer: CUSTOMER, subscription: SUB_ATUAL,
    value: 349.9, dueDate: "2026-08-01",
  })
}

describe("carimbo do atraso", () => {
  it("a primeira fatura vencida INICIA o relógio", async () => {
    vencido()
    const antes = Date.now()

    await processAsaasEvent("evt_1")

    expect(tenant().subscription_status).toBe("past_due")
    const carimbo = new Date(String(tenant().past_due_since)).getTime()
    expect(carimbo).toBeGreaterThanOrEqual(antes)
  })

  it("uma SEGUNDA fatura vencida NÃO reinicia o relógio (senão a carência é infinita)", async () => {
    const velho = "2026-08-01T09:00:00.000Z"
    vencido({ subscription_status: "past_due", past_due_since: velho })

    await processAsaasEvent("evt_1")

    expect(tenant().past_due_since).toBe(velho)
  })

  // 🔑 Auto-cura da "invariante 2": carimbo que sobreviveu a um pagamento antigo não pode
  //    jogar direto no paywall quem está entrando no primeiro dia de um atraso NOVO.
  it("transição nova sobrescreve carimbo órfão de um atraso antigo", async () => {
    vencido({ subscription_status: "active", past_due_since: "2026-01-01T00:00:00.000Z" })

    await processAsaasEvent("evt_1")

    expect(new Date(String(tenant().past_due_since)).getUTCFullYear()).toBe(new Date().getUTCFullYear())
    expect(tenant().past_due_since).not.toBe("2026-01-01T00:00:00.000Z")
  })

  it("o aviso anuncia os dias que RESTAM, não a carência cheia", async () => {
    // Relógio correndo há 5 dias, carência de 7 ⇒ restam 2.
    const cincoDiasAtras = new Date(Date.now() - 5 * 86_400_000).toISOString()
    vencido({ subscription_status: "past_due", past_due_since: cincoDiasAtras, past_due_grace_days: 7 })

    await processAsaasEvent("evt_1")

    expect(primeiroAviso().diasCarencia).toBe(2)
  })

  it("pagar LIMPA o carimbo — senão ele morde no próximo atraso", async () => {
    montarCenario({ tenant: { subscription_status: "past_due", past_due_since: "2026-08-01T00:00:00.000Z" } })
    gw.responde("GET /payments/pay_1", { id: "pay_1", status: "CONFIRMED", customer: CUSTOMER, subscription: SUB_ATUAL, value: 349.9 })

    await processAsaasEvent("evt_1")

    expect(tenant().subscription_status).toBe("active")
    expect(tenant().past_due_since).toBeNull()
  })

  it("não restringir também não carimba (guarda de propriedade recusou o evento)", async () => {
    vencido()
    gw.responde("GET /payments/pay_1", {
      id: "pay_1", status: "OVERDUE", customer: "cus_de_outro", subscription: SUB_ATUAL,
    })

    await processAsaasEvent("evt_1")

    expect(tenant().subscription_status).toBe("active")
    expect(tenant().past_due_since).toBeNull()
  })
})
