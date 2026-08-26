// ═══════════════════════════════════════════════════════════════
// PORTÃO DOS CRÍTICOS — caminho da assinatura (C-03, C-04)
// ═══════════════════════════════════════════════════════════════
//
// 🔴 ESTES TESTES DEVEM FALHAR HOJE — ver o cabeçalho de `criticos-webhook.gate.test.ts`
//    para o porquê e para a armadilha que eles evitam. Rodam por `npm run test:gate`.
//
// ⚠️ ARQUIVO SEPARADO DE PROPÓSITO: este caminho precisa de dublês que o do webhook não
//    usa (cifra de segredo, `ensureAsaasCustomer`, e o shim do `or(...)`). Misturar os dois
//    conjuntos de mock num arquivo só é como se planta bug fantasma numa suíte.

import { describe, it, expect, beforeEach, vi } from "vitest"
import { FakeDb } from "@/test/fakes/fake-db"
import { FakeGateway, AsaasError, mensagemSeguraDoGateway } from "@/test/fakes/fake-gateway"

const db = new FakeDb()
let gw = new FakeGateway()
let trocarParaManualDuranteClaim = false

// O dublê não implementa `not.is.null` dentro de `or(...)` — ele LANÇA, de propósito.
// Aqui esse `or` é irrelevante ao que se prova (é a faxina do rótulo do cartão), então o
// shim o neutraliza em vez de mascarar o comportamento sob teste.
function fromShim(t: string) {
  const q = db.from(t) as unknown as {
    or: (e: string) => unknown
    update: (patch: Record<string, unknown>) => unknown
  }
  const updateOriginal = q.update.bind(q)
  const orOriginal = q.or.bind(q)
  q.update = (patch: Record<string, unknown>) => {
    if (
      t === "tenants"
      && trocarParaManualDuranteClaim
      && typeof patch.asaas_subscription_id === "string"
      && patch.asaas_subscription_id.startsWith("pending:")
    ) {
      trocarParaManualDuranteClaim = false
      // O SELECT inicial do PostgREST devolve uma fotografia. Substituir a linha, em vez
      // de mutar o mesmo objeto, preserva essa fotografia e reproduz a troca que aterrissa
      // imediatamente antes do UPDATE do claim.
      db.linhas("tenants")[0] = { ...db.linhas("tenants")[0], billing_mode: "manual" }
    }
    return updateOriginal(patch)
  }
  q.or = (expr: string) => (expr.includes(".not.is.") ? q : orOriginal(expr))
  return q
}

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: (t: string) => fromShim(t) } }))
vi.mock("@/lib/asaas/client", () => ({
  get asaas() { return gw.client },
  AsaasError,
  mensagemSeguraDoGateway,
}))
vi.mock("@/lib/crypto/secrets", () => ({
  encryptSecret: (s: string) => `enc:v1:${s}`,
  decryptSecret: (s: string | null) => (s ? s.replace(/^enc:v1:/, "") : s),
}))
vi.mock("@/lib/asaas/customers", () => ({ ensureAsaasCustomer: async () => ({ id: "cus_kora" }) }))

const { createSubscriptionForTenant, cancelSubscriptionForTenant, resumeSubscriptionForTenant } =
  await import("@/lib/asaas/subscriptions")

const TENANT  = "22222222-2222-2222-2222-222222222222"
const PLANO   = "plan_1"
const CARTAO  = { holderName: "X Y", number: "4242424242424242", expiryMonth: "12", expiryYear: "2030", ccv: "123" }
const TITULAR = { name: "X Y", email: "m@x.com", cpfCnpj: "10526979844", postalCode: "03734130", addressNumber: "101", phone: "11940175730" }

const tenant  = () => db.linhas("tenants")[0]
const deletes = () => gw.chamadas.filter((c) => c.metodo === "DELETE")
const replaceTenant = (patch: Record<string, unknown>) => {
  // O PostgREST devolve snapshot desacoplado da linha. O FakeDb guarda a mesma referência;
  // substituir a linha (em vez de mutá-la) preserva o snapshot lido pelo código sob teste.
  db.linhas("tenants")[0] = { ...tenant(), ...patch }
}

beforeEach(() => {
  gw = new FakeGateway()
  trocarParaManualDuranteClaim = false
  db.tabelas.clear()
  db.log.length = 0
  db.seed("tenants", [{
    id: TENANT, asaas_customer_id: "cus_kora", asaas_subscription_id: null,
    billing_mode: "gateway", plan_id: null, billing_day: null, subscription_status: "active",
    lifecycle_state: "active", asaas_card_token: null, card_brand: null, card_last4: null,
    subscription_ends_at: null,
  }])
  db.seed("plans", [{ id: PLANO, name: "PLANO III", price_cents: 34990, active: true }])
  gw.responde("POST /creditCard/tokenize", { creditCardToken: "tok_1", creditCardBrand: "VISA", creditCardNumber: "4242" })
})

// ───────────────────────────────────────────────────────────────
describe("C-03 · falha de leitura nunca vira sucesso de cancelamento", () => {
  it("REGRA: banco indisponível ⇒ erro, e a assinatura continua intocada", async () => {
    tenant().asaas_subscription_id = "sub_viva"
    db.falharEm({ tabela: "tenants", op: "select", vezes: 1, msg: "timeout" })

    const r = await cancelSubscriptionForTenant(TENANT)

    // Hoje o erro da leitura é descartado, `data` vira null, e a função conclui
    // "não há assinatura" ⇒ devolve {ok:true} sem chamar o gateway. O cartão do cliente
    // segue sendo debitado com o produto fechado.
    // Regra: "não sei" é diferente de "não existe". Indisponibilidade ⇒ falha explícita.
    // ⚠️ O retorno é união (`{ok:true} | {error:string}`), então NÃO se lê `r.ok` direto —
    //    o ramo de erro não tem essa propriedade e o `tsc` reprova (achado ao rodar o
    //    typecheck: o teste passava vermelho "certo" mas não compilava).
    expect(r).not.toEqual({ ok: true })
    expect("error" in r).toBe(true)
    expect(tenant().asaas_subscription_id).toBe("sub_viva")
  })
})

// ───────────────────────────────────────────────────────────────
describe("C-04 · nunca cancelado com assinatura viva", () => {
  it("REGRA: cancelamento durante a ativação não é sobrescrito pela assinatura que nasce", async () => {
    gw.responde("POST /subscriptions", () => (async () => {
      // ── Interleaving: o operador cancela enquanto o POST está em voo ──
      await cancelSubscriptionForTenant(TENANT)
      await db.from("tenants").update({
        subscription_status:       "canceled",
        subscription_ended_reason: "decisao_interna",
        subscription_ends_at:      new Date().toISOString(),
      }).eq("id", TENANT)
      return { id: "sub_real" }
    })())

    await createSubscriptionForTenant(TENANT, PLANO, CARTAO, TITULAR, "1.2.3.4")

    // A INVARIANTE, que é o estado terminal onde C-03 e C-04 desembocam e que nenhuma
    // varredura do sistema cobre hoje: conta cancelada com assinatura viva debitando.
    if (tenant().subscription_status === "canceled") {
      expect(tenant().asaas_subscription_id).toBeNull()
    }
    // E o carimbo de encerramento não pode ser apagado: dele dependem a guarda
    // anti-ressurreição do webhook e a varredura 1.b do housekeeping.
    expect(tenant().subscription_ends_at).not.toBeNull()
    // Se o vínculo não pôde ser gravado com segurança, a assinatura recém-criada tem que
    // ser cancelada no gateway — não abandonada lá cobrando.
    if (tenant().asaas_subscription_id !== "sub_real") {
      expect(deletes().length).toBeGreaterThan(0)
    }
  })

  it("REGRA: retomada que perde a corrida compensa a assinatura exata recém-criada", async () => {
    const fimLido = new Date(Date.now() + 20 * 86_400_000).toISOString()
    const fimDoCancelamentoConcorrente = new Date(Date.now() + 10 * 86_400_000).toISOString()
    Object.assign(tenant(), {
      asaas_subscription_id: null,
      billing_mode: "gateway",
      plan_id: PLANO,
      asaas_card_token: "enc:v1:tok_guardado",
      subscription_ends_at: fimLido,
      subscription_ended_reason: "pedido_do_cliente",
    })
    gw.responde("POST /subscriptions", () => {
      replaceTenant({
        asaas_subscription_id: null,
        subscription_status: "canceled",
        subscription_ends_at: fimDoCancelamentoConcorrente,
        subscription_ended_reason: "decisao_interna",
      })
      return { id: "sub_retomada_orfa" }
    })
    gw.responde("DELETE /subscriptions/sub_retomada_orfa", {})

    const r = await resumeSubscriptionForTenant(TENANT, "1.2.3.4")

    expect("error" in r).toBe(true)
    expect(deletes().map((c) => c.path)).toEqual(["/subscriptions/sub_retomada_orfa"])
    expect(tenant()).toMatchObject({
      asaas_subscription_id: null,
      subscription_status: "canceled",
      subscription_ends_at: fimDoCancelamentoConcorrente,
      subscription_ended_reason: "decisao_interna",
    })
  })

  it("REGRA: retomada não vincula se a reserva sumiu durante o POST", async () => {
    const fimLido = new Date(Date.now() + 20 * 86_400_000).toISOString()
    Object.assign(tenant(), {
      asaas_subscription_id: null,
      billing_mode: "gateway",
      plan_id: PLANO,
      asaas_card_token: "enc:v1:tok_guardado",
      subscription_ends_at: fimLido,
      subscription_ended_reason: "pedido_do_cliente",
    })
    gw.responde("POST /subscriptions", () => {
      // Outro fluxo revogou a sentinela sem mudar o fim do ciclo. Conferir só a data não
      // prova posse: a retomada precisa exigir a MESMA reserva no CAS final.
      replaceTenant({ asaas_subscription_id: null })
      return { id: "sub_sem_reserva" }
    })
    gw.responde("DELETE /subscriptions/sub_sem_reserva", {})

    const r = await resumeSubscriptionForTenant(TENANT, "1.2.3.4")

    expect("error" in r).toBe(true)
    expect(deletes().map((c) => c.path)).toEqual(["/subscriptions/sub_sem_reserva"])
    expect(tenant().asaas_subscription_id).toBeNull()
  })

  it("REGRA: mudança concorrente para billing manual vence e a retomada compensa", async () => {
    const fimLido = new Date(Date.now() + 20 * 86_400_000).toISOString()
    Object.assign(tenant(), {
      asaas_subscription_id: null,
      billing_mode: "gateway",
      plan_id: PLANO,
      asaas_card_token: "enc:v1:tok_guardado",
      subscription_ends_at: fimLido,
      subscription_ended_reason: "pedido_do_cliente",
    })
    gw.responde("POST /subscriptions", () => {
      replaceTenant({ billing_mode: "manual" })
      return { id: "sub_apos_manual" }
    })
    gw.responde("DELETE /subscriptions/sub_apos_manual", {})

    const r = await resumeSubscriptionForTenant(TENANT, "1.2.3.4")

    expect("error" in r).toBe(true)
    expect(deletes().map((c) => c.path)).toEqual(["/subscriptions/sub_apos_manual"])
    expect(tenant().billing_mode).toBe("manual")
    expect(tenant().asaas_subscription_id).not.toBe("sub_apos_manual")
  })
})

// ───────────────────────────────────────────────────────────────
describe("fronteira manual · claim da criação falha fechado", () => {
  it("REGRA: tenant manual não conquista a reserva nem toca o gateway", async () => {
    tenant().billing_mode = "manual"

    const r = await createSubscriptionForTenant(TENANT, PLANO, CARTAO, TITULAR, "1.2.3.4")

    expect("error" in r).toBe(true)
    expect(gw.chamadas).toHaveLength(0)
    expect(tenant().asaas_subscription_id).toBeNull()
  })

  it("REGRA: erro do banco no claim não é anunciado como concorrência", async () => {
    db.falharEm({ tabela: "tenants", op: "update", vezes: 1, msg: "timeout no banco" })

    const r = await createSubscriptionForTenant(TENANT, PLANO, CARTAO, TITULAR, "1.2.3.4")

    expect("error" in r).toBe(true)
    const mensagem = "error" in r ? r.error : ""
    expect(mensagem).not.toMatch(/ativação em andamento|aguarde alguns segundos/i)
    expect(mensagem).toMatch(/não foi possível|tente de novo/i)
    expect(gw.chamadas).toHaveLength(0)
  })

  it("REGRA: troca gateway → manual imediatamente antes do claim impede todo efeito externo", async () => {
    trocarParaManualDuranteClaim = true
    gw.responde("POST /subscriptions", { id: "sub_nao_deveria_nascer" })
    gw.responde("DELETE /subscriptions/sub_nao_deveria_nascer", {})

    const r = await createSubscriptionForTenant(TENANT, PLANO, CARTAO, TITULAR, "1.2.3.4")

    expect("error" in r).toBe(true)
    expect(tenant().billing_mode).toBe("manual")
    expect(tenant().asaas_subscription_id).toBeNull()
    expect(gw.chamadas).toHaveLength(0)
  })
})
