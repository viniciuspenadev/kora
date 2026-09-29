// ═══════════════════════════════════════════════════════════════
// Retomar assinatura — a porta de volta não pode cobrar de novo
// ═══════════════════════════════════════════════════════════════
//
// 🔴 O DANO ESPECÍFICO DESTE CAMINHO, e ele é diferente do da criação. Lá o erro cobra o
//    cartão HOJE e aparece na hora; aqui **nada é debitado no ato** — uma segunda assinatura
//    criada por engano fica um mês inteiro invisível antes de cobrar em dobro. Silêncio é
//    exatamente o que torna um bug de dinheiro caro.
//
// 🔑 As três coisas que estes testes trancam:
//    1. a próxima cobrança cai no dia em que cairia se ele nunca tivesse cancelado;
//    2. o cartão salvo é REUSADO (nenhum dado de cartão entra nesta função);
//    3. o carimbo de cancelamento cai junto — senão a varredura 1.b derruba, dias depois,
//       um cliente que voltou a pagar.
//
// 🔒 Zero produção: banco, gateway e cifragem são dublês trocados antes do import.

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
// O dublê da cifra espelha o formato real (`enc:v1:<segredo>`) nos dois sentidos — é o que
// permite provar que o token que chega ao gateway é o que estava guardado, decifrado.
vi.mock("@/lib/crypto/secrets", () => ({
  encryptSecret: (s: string) => `enc:v1:${s}`,
  decryptSecret: (s: string | null) => (s ? String(s).replace(/^enc:v1:/, "") : s),
}))
vi.mock("./customers", () => ({ ensureAsaasCustomer: async () => ({ id: "cus_kora" }) }))

const { resumeSubscriptionForTenant } = await import("./subscriptions")

const TENANT = "33333333-3333-3333-3333-333333333333"
const PLANO  = "plan_2"

/** Fim do ciclo pago, sempre no futuro — é a pré-condição de existir retomada. */
const FIM = new Date(Date.now() + 20 * 86_400_000)
const fimIso = () => FIM.toISOString()
/** O dia seguinte ao fim do ciclo: onde a cobrança TEM que cair. */
const diaSeguinte = () => new Date(FIM.getTime() + 86_400_000).toISOString().slice(0, 10)

const tenant = () => db.linhas("tenants")[0]

/** Tenant que cancelou e ainda está dentro do período pago. */
function cancelado(over: Record<string, unknown> = {}) {
  db.tabelas.clear()
  db.seed("tenants", [{
    id: TENANT, asaas_customer_id: "cus_kora",
    // Cancelado: o vínculo morreu no gateway…
    asaas_subscription_id: null,
    subscription_ends_at: fimIso(),
    subscription_ended_reason: "pedido_do_cliente",
    subscription_status: "active",
    // …mas o cartão FICOU, que é a mudança de 11/08.
    asaas_card_token: "enc:v1:tok_guardado", card_brand: "mastercard", card_last4: "8003",
    billing_mode: "gateway", plan_id: PLANO, billing_day: 11,
    ...over,
  }])
  db.seed("plans", [{ id: PLANO, name: "PLANO II", price_cents: 14990, active: true }])
}

beforeEach(() => {
  gw = new FakeGateway()
  cancelado()
  gw.responde("POST /subscriptions", { id: "sub_novo" })
})

const retomar = () => resumeSubscriptionForTenant(TENANT, "1.2.3.4")

describe("caminho feliz", () => {
  it("NÃO cobra agora: a próxima cobrança é o dia seguinte ao fim do ciclo pago", async () => {
    const r = await retomar()

    expect(r).toEqual({ id: "sub_novo" })
    const criada = gw.chamadas.find((c) => c.path === "/subscriptions")!
    // 🔑 O teste que justifica a função inteira existir em vez de reusar a criação: aquela
    //    cobra HOJE (decisão do dono, 06/08), e cobrar hoje aqui seria cobrar duas vezes o
    //    mês que ele já pagou.
    expect((criada.body as { nextDueDate: string }).nextDueDate).toBe(diaSeguinte())
  })

  it("reusa o cartão salvo — nenhum dado de cartão entra nesta função", async () => {
    await retomar()

    const criada = gw.chamadas.find((c) => c.path === "/subscriptions")!
    expect((criada.body as { creditCardToken: string }).creditCardToken).toBe("tok_guardado")
    // Tokenizar de novo significaria pedir o cartão — o oposto do "um clique".
    expect(gw.chamadas.some((c) => c.path.includes("tokenize"))).toBe(false)
  })

  it("apaga o carimbo do cancelamento — senão a varredura 1.b derruba quem voltou a pagar", async () => {
    await retomar()

    expect(tenant().asaas_subscription_id).toBe("sub_novo")
    expect(tenant().subscription_ends_at).toBeNull()
    // 🔑 O motivo cai junto: "cancelou a pedido" numa assinatura viva mentiria no god mode.
    expect(tenant().subscription_ended_reason).toBeNull()
  })

  it("NÃO reescreve o billing_day — o ciclo não mudou de âncora", async () => {
    await retomar()
    expect(tenant().billing_day).toBe(11)
  })
})

describe("guardas — o que NÃO pode virar retomada", () => {
  it("assinatura viva devolve a existente, sem tocar no gateway (idempotente)", async () => {
    cancelado({ asaas_subscription_id: "sub_vigente" })

    const r = await retomar()

    expect(r).toEqual({ id: "sub_vigente" })
    expect(gw.chamadas).toHaveLength(0)
  })

  // 🔴 Sem esta guarda, cancelar e "retomar" depois da data daria um ciclo de graça: a
  //    cobrança voltaria pra uma data já vencida em vez de pra hoje.
  it("ciclo já vencido NÃO é retomada — é contratação nova", async () => {
    cancelado({ subscription_ends_at: new Date(Date.now() - 86_400_000).toISOString() })

    const r = await retomar()

    expect(r).toEqual({ error: expect.stringContaining("Não há cancelamento") })
    expect(gw.chamadas).toHaveLength(0)
  })

  it("sem cancelamento nenhum não há o que retomar", async () => {
    cancelado({ subscription_ends_at: null })
    expect(await retomar()).toEqual({ error: expect.stringContaining("Não há cancelamento") })
  })

  it("sem cartão salvo, manda informar o cartão em vez de falhar no gateway", async () => {
    cancelado({ asaas_card_token: null })

    const r = await retomar()

    expect(r).toEqual({ error: expect.stringContaining("cartão") })
    expect(gw.chamadas).toHaveLength(0)
  })

  it("cliente de cobrança manual não entra no gateway", async () => {
    cancelado({ billing_mode: "manual" })
    expect("error" in (await retomar())).toBe(true)
    expect(gw.chamadas).toHaveLength(0)
  })

  // ⚠️ Plano arquivado depois da contratação: recriar perpetuaria uma tabela de preço que
  //    saiu da prateleira. Mandar escolher de novo é a resposta honesta.
  it("plano desativado manda escolher de novo", async () => {
    db.seed("plans", [{ id: PLANO, name: "PLANO II", price_cents: 14990, active: false }])
    expect("error" in (await retomar())).toBe(true)
  })

  it("plano com preço zero não vira assinatura de R$ 0 cobrando para sempre", async () => {
    db.seed("plans", [{ id: PLANO, name: "PLANO II", price_cents: 0, active: true }])
    expect("error" in (await retomar())).toBe(true)
    expect(gw.chamadas).toHaveLength(0)
  })
})

describe("concorrência e rede — onde nasce a cobrança em dobro", () => {
  it("duas retomadas simultâneas criam UMA assinatura só", async () => {
    const [a, b] = await Promise.all([retomar(), retomar()])

    const criadas = gw.chamadas.filter((c) => c.path === "/subscriptions")
    expect(criadas).toHaveLength(1)
    // Uma vence, a outra é recusada com frase de espera — nenhuma das duas cria a segunda.
    expect([a, b].filter((r) => "id" in r)).toHaveLength(1)
  })

  // 🔴 Timeout não é "não criou". Soltar a vaga aqui deixaria a pessoa retomar de novo e
  //    ficar com DUAS assinaturas mensais — invisíveis até a primeira cobrança, um mês
  //    depois, porque esta função não debita nada no ato.
  it("timeout + assinatura EXISTE no gateway ⇒ adota, não cria a segunda", async () => {
    gw.timeoutEm("POST /subscriptions")
    gw.responde("GET /subscriptions", { data: [{ id: "sub_criada_no_escuro", status: "ACTIVE" }] })

    const r = await retomar()

    expect(r).toEqual({ id: "sub_criada_no_escuro" })
    expect(tenant().asaas_subscription_id).toBe("sub_criada_no_escuro")
    expect(tenant().subscription_ends_at).toBeNull()
  })

  it("timeout + gateway confirma que NÃO existe ⇒ solta a vaga (dá pra tentar de novo)", async () => {
    gw.timeoutEm("POST /subscriptions")
    gw.responde("GET /subscriptions", { data: [] })

    expect("error" in (await retomar())).toBe(true)
    expect(tenant().asaas_subscription_id).toBeNull()
  })

  it("timeout + a consulta TAMBÉM falha ⇒ NÃO solta a vaga ('não sei' ≠ 'não existe')", async () => {
    gw.timeoutEm("POST /subscriptions")
    gw.timeoutEm("GET /subscriptions")

    expect("error" in (await retomar())).toBe(true)
    // A reserva fica presa de propósito: é reparável à mão, ao contrário de cobrar 2×.
    expect(String(tenant().asaas_subscription_id)).toMatch(/^pending:/)
  })
})
