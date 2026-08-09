// ═══════════════════════════════════════════════════════════════
// Carência pela mão do operador — a armadilha do ZERO
// ═══════════════════════════════════════════════════════════════
//
// 🔴 `0` E VAZIO SÃO COISAS DIFERENTES, e confundi-los falha em silêncio nos dois sentidos:
//    • `!g` tratando zero como "não informado" ⇒ o cliente que o operador decidiu cortar
//      na hora ganha os 7 dias padrão;
//    • vazio virando `0` ⇒ todo tenant salvo por esta tela passa a ser cortado no primeiro
//      dia de atraso, sem carência nenhuma, sem ninguém ter pedido isso.
//    Nenhum dos dois dá erro. Os dois mexem em quando a equipe do cliente perde o login.
//
// 🔴 E O CARIMBO: esta action é o escritor MAIS USADO de `past_due` (a mão do operador).
//    Sem carimbar, `passouDaCarencia` é fail-closed pela data e manda pro paywall na hora.
//
// 🔒 Nada toca produção: `auth`, `@/lib/supabase` e o cache do Next são trocados antes do
//    import do módulo.

import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: () => {} }))
vi.mock("@/auth", () => ({ auth: async () => ({ user: { isPlatformAdmin: true } }) }))
vi.mock("@/lib/billing", () => ({ generateInvoiceForTenant: async () => ({}) }))
// 🔒 "Cancelada" no god mode agora CANCELA no gateway antes de escrever (QA 09/08). O dublê
//    deixa o desfecho programável, porque a regra nova é justamente: falhou lá ⇒ não escreve.
const cancelarMock = vi.fn(async () => ({ ok: true } as { ok: true } | { error: string }))
vi.mock("@/lib/asaas/subscriptions", () => ({ cancelSubscriptionForTenant: () => cancelarMock() }))

/** A linha do tenant como o banco a devolveria, e o patch que a action tentou escrever. */
let linha: Record<string, unknown> = {}
let patch: Record<string, unknown> | null = null

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: linha, error: null }) }) }),
      update: (p: Record<string, unknown>) => { patch = p; return { eq: async () => ({ error: null }) } },
    }),
  },
}))

const { updateTenantBilling } = await import("./admin-billing")

const TENANT = "11111111-1111-1111-1111-111111111111"

beforeEach(() => {
  linha = { subscription_status: "active", past_due_since: null }
  patch = null
  cancelarMock.mockClear()
  cancelarMock.mockResolvedValue({ ok: true })
})

describe("carência definida à mão", () => {
  it("ZERO é gravado como zero — não vira 'não informado'", async () => {
    const r = await updateTenantBilling(TENANT, { past_due_grace_days: 0 })
    expect(r.error).toBeUndefined()
    expect(patch!.past_due_grace_days).toBe(0)
  })

  it("vazio (null) volta pro padrão do sistema, e não pra zero", async () => {
    await updateTenantBilling(TENANT, { past_due_grace_days: null })
    expect(patch!.past_due_grace_days).toBeNull()
  })

  it("o teto de 90 é recusado com frase humana, antes de o banco reclamar", async () => {
    const r = await updateTenantBilling(TENANT, { past_due_grace_days: 91 })
    expect(r.error).toContain("0 e 90")
    expect(patch).toBeNull()          // nada foi escrito
  })

  it("negativo e quebrado são recusados", async () => {
    for (const v of [-1, 3.5, NaN]) {
      patch = null
      expect((await updateTenantBilling(TENANT, { past_due_grace_days: v })).error).toBeTruthy()
      expect(patch).toBeNull()
    }
  })

  it("não passar o campo não mexe nele (salvar só o dia não zera a carência)", async () => {
    await updateTenantBilling(TENANT, { billing_day: 10 })
    expect(patch).not.toHaveProperty("past_due_grace_days")
  })
})

describe("carimbo do atraso pela mão do operador", () => {
  it("marcar 'Inadimplente' INICIA o relógio (senão o paywall cai na hora)", async () => {
    const antes = Date.now()
    await updateTenantBilling(TENANT, { subscription_status: "past_due" })
    expect(new Date(String(patch!.past_due_since)).getTime()).toBeGreaterThanOrEqual(antes)
  })

  it("re-salvar um tenant JÁ inadimplente não reinicia o relógio", async () => {
    const velho = "2026-08-01T09:00:00.000Z"
    linha = { subscription_status: "past_due", past_due_since: velho }

    await updateTenantBilling(TENANT, { subscription_status: "past_due" })

    expect(patch!.past_due_since).toBe(velho)
  })

  it("voltar pra 'Ativa' LIMPA o carimbo — senão ele morde no próximo atraso", async () => {
    linha = { subscription_status: "past_due", past_due_since: "2026-08-01T09:00:00.000Z" }

    await updateTenantBilling(TENANT, { subscription_status: "active" })

    expect(patch!.past_due_since).toBeNull()
  })

  it("cancelar também limpa: sem atraso em curso, não há relógio", async () => {
    linha = { subscription_status: "past_due", past_due_since: "2026-08-01T09:00:00.000Z" }
    await updateTenantBilling(TENANT, { subscription_status: "canceled" })
    expect(patch!.past_due_since).toBeNull()
  })

  // 🔴 O SELETOR SÓ ESCREVIA A PALAVRA (QA 09/08). A assinatura seguia viva e o cartão
  //    sendo debitado — e como `canceled` virou paywall, o clique fechava o produto E
  //    continuava cobrando. Cobrar sem entregar, a um clique de distância.
  it("marcar 'Cancelada' CANCELA no gateway e carimba motivo + fim", async () => {
    await updateTenantBilling(TENANT, { subscription_status: "canceled" })

    expect(cancelarMock).toHaveBeenCalledTimes(1)
    expect(patch!.subscription_ended_reason).toBe("decisao_interna")
    // O carimbo é o que impede um evento atrasado de ressuscitar a assinatura.
    expect(patch!.subscription_ends_at).toBeTruthy()
  })

  it("gateway recusou o cancelamento ⇒ NADA é escrito", async () => {
    cancelarMock.mockResolvedValueOnce({ error: "gateway fora do ar" })

    const r = await updateTenantBilling(TENANT, { subscription_status: "canceled" })

    expect(r.error).toContain("gateway")
    // 🔑 O ponto: sem esta guarda, o produto fecharia com o cartão ainda sendo debitado.
    expect(patch).toBeNull()
  })

  it("re-salvar quem JÁ está cancelado não chama o gateway de novo", async () => {
    linha = { subscription_status: "canceled", past_due_since: null }
    await updateTenantBilling(TENANT, { subscription_status: "canceled" })
    expect(cancelarMock).not.toHaveBeenCalled()
  })

  it("status inválido é recusado e não escreve nada", async () => {
    const r = await updateTenantBilling(TENANT, { subscription_status: "inventado" })
    expect(r.error).toBe("Status inválido")
    expect(patch).toBeNull()
  })
})
