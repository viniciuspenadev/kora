// ═══════════════════════════════════════════════════════════════
// Geração de fatura — tudo ou nada
// ═══════════════════════════════════════════════════════════════
//
// 🔴 POR QUE ESTES TESTES EXISTEM (H-06 do pentest de 08/08). A geração eram três escritas
//    independentes, e uma falha no meio deixava dois estados que o retry NÃO conserta:
//      (a) fatura com total certo e zero linhas — e como o índice único bloqueia recriar o
//          cabeçalho, a função passa a responder "já existe" para sempre;
//      (b) avulsa não consumida — cobrada DE NOVO no mês seguinte.
//    O (b) é o pior: dinheiro tirado a mais do cliente, não dinheiro que a gente deixou
//    de faturar.
//
// 🔑 O que se tranca aqui é a COMPENSAÇÃO: falhou depois do cabeçalho ⇒ o cabeçalho some.
//    Quando funciona, isso é invisível — por isso precisa de teste, não de leitura.

import { describe, it, expect, beforeEach, vi } from "vitest"
import { FakeDb } from "@/test/fakes/fake-db"

const db = new FakeDb()

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: (t: string) => db.from(t) } }))

const { generateInvoiceForTenant } = await import("./billing")

const TENANT = "11111111-1111-1111-1111-111111111111"

/** Tenant com plano, um add-on recorrente e uma avulsa a consumir. */
function cenario() {
  db.tabelas.clear()
  db.log.length = 0
  db.seed("tenants", [{
    id: TENANT, active: true, billing_day: 10, billing_mode: "gateway",
    subscription_status: "active", plan_id: "plan_1",
  }])
  // ⚠️ Tabela separada, não embed: `generateInvoiceForTenant` faz um SELECT próprio em
  //    `plans` (billing.ts:96). Semear como objeto aninhado no tenant fazia a função
  //    responder "Plano do tenant não encontrado" — o teste reprovava por causa do dublê.
  db.seed("plans", [
    { id: "plan_1", name: "PLANO I", price_cents: 34990, user_quota: 3, extra_user_price_cents: 7990 },
  ])
  db.seed("tenant_users", [{ id: "u1", tenant_id: TENANT, active: true }])
  db.seed("tenant_charges", [
    { id: "chg_avulsa", tenant_id: TENANT, kind: "oneoff", description: "Setup", amount_cents: 15000, active: true },
  ])
  db.seed("invoices", [])
  db.seed("invoice_items", [])
}

const faturas = () => db.linhas("invoices")
const itens   = () => db.linhas("invoice_items")
const avulsa  = () => db.linhas("tenant_charges").find((c) => c.id === "chg_avulsa")!

beforeEach(cenario)

describe("caminho feliz", () => {
  it("gera cabeçalho e itens", async () => {
    const r = await generateInvoiceForTenant(TENANT)

    expect(r.id).toBeTruthy()
    expect(faturas()).toHaveLength(1)
    expect(itens().length).toBeGreaterThan(0)
  })

  // 🔴 ESTE TESTE AFIRMAVA A PERDA (versão de 08/08: "gera … e CONSOME a avulsa"). O QA
  //    mostrou o que o consumo significava: a avulsa era marcada como cobrada, **nunca era
  //    cobrada em lugar nenhum**, e saía da fila para sempre. Não era "ainda não cobramos"
  //    — era apagar receita com um `update`.
  // 🔑 Enquanto não existir caminho de cobrança: não fatura e não consome. Ela fica
  //    pendente e visível, e o total da fatura passa a ser o que o gateway vai debitar.
  it("avulsa NÃO é faturada nem consumida — ela fica pendente", async () => {
    await generateInvoiceForTenant(TENANT)

    expect(avulsa().active).toBe(true)
    expect(itens().some((i) => i.kind === "oneoff")).toBe(false)
  })

  it("add-on RECORRENTE continua entrando — esse é cobrado de verdade, pelo PUT", async () => {
    db.seed("tenant_charges", [
      { id: "chg_addon", tenant_id: TENANT, kind: "recurring_addon", description: "Número extra", amount_cents: 9900, active: true },
    ])

    await generateInvoiceForTenant(TENANT)

    expect(itens().some((i) => i.kind === "addon")).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// A GUARDA DE PAYWALL — e o sinal que a desarma quando o dinheiro já entrou
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 ESTA GUARDA NUNCA TEVE TESTE — nem antes nem depois de 11/08, e ela decide se um
//    cliente bloqueado ganha ou não fatura. A lacuna só apareceu quando fui deployar e
//    perguntei "o que prova a mudança que acabei de fazer?". Nada provava.
// 🔑 A regra do pré-pago: período não servido não gera cobrança. Mas quando o pagamento
//    ACABOU de ser confirmado, o período VAI ser servido — e até 11/08 a função descobria
//    isso pela ORDEM em que era chamada (o `liberar()` limpava o paywall antes da baixa).
//    Inverter essa ordem, para a regra 3 do dono ("parcial não libera"), quebrava a
//    suposição em silêncio: o cliente bloqueado pagaria e o dinheiro ficaria SEM FATURA.
describe("guarda de paywall na emissão", () => {
  /** Tenant em paywall de verdade: atrasado além da carência. */
  function emPaywall() {
    const t = db.linhas("tenants")[0]
    t.subscription_status = "past_due"
    t.past_due_since      = "2026-01-01T00:00:00Z"   // muito além de qualquer carência
    t.past_due_grace_days = 2
  }

  it("cliente em paywall NÃO ganha fatura — período não servido não se cobra", async () => {
    emPaywall()

    const r = await generateInvoiceForTenant(TENANT)

    expect(r.skipped).toBe(true)
    expect(faturas()).toHaveLength(0)
  })

  it("🔑 mas se o dinheiro JÁ ENTROU, a fatura nasce — senão o pagamento fica sem lastro", async () => {
    emPaywall()

    const r = await generateInvoiceForTenant(TENANT, { dinheiroJaEntrou: true })

    expect(r.skipped).toBeFalsy()
    expect(r.id).toBeTruthy()
    expect(faturas()).toHaveLength(1)
    // E ela nasce completa: sem itens, o piso de aceite da baixa perde a régua.
    expect(itens().length).toBeGreaterThan(0)
  })

  it("o sinal NÃO é um bypass geral: quem não está em paywall segue o caminho normal", async () => {
    const r = await generateInvoiceForTenant(TENANT, { dinheiroJaEntrou: true })

    expect(r.skipped).toBeFalsy()
    expect(faturas()).toHaveLength(1)
  })
})

describe("falha no meio NÃO deixa fatura pela metade", () => {
  it("itens falharam ⇒ o cabeçalho é APAGADO (senão o retry bate no índice único pra sempre)", async () => {
    db.falharEm({ tabela: "invoice_items", op: "insert", vezes: 1, msg: "conexão caiu" })

    const r = await generateInvoiceForTenant(TENANT)

    expect(r.error).toBeTruthy()
    // O estado que o furo criava: fatura órfã, com total certo e nenhuma linha.
    expect(faturas()).toHaveLength(0)
  })

  it("depois de desfazer, o retry gera limpo", async () => {
    db.falharEm({ tabela: "invoice_items", op: "insert", vezes: 1 })
    await generateInvoiceForTenant(TENANT)

    const r = await generateInvoiceForTenant(TENANT)

    expect(r.id).toBeTruthy()
    expect(faturas()).toHaveLength(1)
    expect(itens().length).toBeGreaterThan(0)
  })
})
