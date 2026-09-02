// ═══════════════════════════════════════════════════════════════
// Pausar os canais de entrada
// ═══════════════════════════════════════════════════════════════
//
// 🔴 As quatro decisões deste módulo falham EM SILÊNCIO se voltarem atrás — nenhuma delas
//    lança, nenhuma quebra tela, todas mentem:
//      1. marcar `disconnected` sem o provedor confirmar → o banco diz "desligado" e a
//         mensagem continua chegando e sendo destruída (o estado do Bernardo, de propósito);
//      2. aceitar 200 com `success:false` → mesma coisa, pela porta da Meta;
//      3. erro de leitura virar "nenhum canal" → a pausa reporta sucesso sem ter pausado;
//      4. apagar o token da WABA → a volta deixa de ser nossa e passa a exigir um terceiro
//         com admin do Business Manager.
//
// 🔒 Nada toca produção nem rede: supabase, providers e `fetch` são trocados antes do import.

import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("server-only", () => ({}))

// ── banco falso ────────────────────────────────────────────────────────────────
interface Cenario {
  instancias: Record<string, unknown>[]
  igs:        Record<string, unknown>[]
  erroLeitura: string | null
}
const cenario: Cenario = { instancias: [], igs: [], erroLeitura: null }
const updates: { tabela: string; patch: Record<string, unknown>; id: string }[] = []

function selectStub(tabela: string) {
  const linhas = tabela === "whatsapp_instances" ? cenario.instancias : cenario.igs
  const q: Record<string, unknown> = {}
  const thenable = {
    eq: () => thenable,
    then: (r: (v: unknown) => unknown) =>
      r(cenario.erroLeitura
        ? { data: null, error: { message: cenario.erroLeitura } }
        : { data: linhas, error: null }),
  }
  Object.assign(q, thenable)
  return thenable
}

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: (tabela: string) => ({
      select: () => selectStub(tabela),
      update: (patch: Record<string, unknown>) => ({
        eq: (_c: string, id: string) => {
          updates.push({ tabela, patch, id })
          return Promise.resolve({ error: erroUpdate })
        },
      }),
    }),
  },
}))
let erroUpdate: { message: string } | null = null

// ── provider falso ─────────────────────────────────────────────────────────────
const logoutMock = vi.fn(async () => ({ ok: true }))
let providerLanca: string | null = null
vi.mock("@/lib/providers", () => ({
  getProvider: () => {
    if (providerLanca) throw new Error(providerLanca)
    return { logout: logoutMock }
  },
}))

vi.mock("@/lib/crypto/secrets", () => ({ decryptSecret: (v: string | null) => v }))

const { pausarCanaisDoTenant, canaisDerrubados } = await import("./pause")

const TENANT = "11111111-1111-1111-1111-111111111111"
const baileys = (over = {}) => ({
  id: "inst_b", provider: "baileys", status: "connected", instance_name: "kora1",
  evolution_url: "https://evo", evolution_key: "k", meta_phone_number_id: null,
  meta_business_account_id: null, meta_access_token: null, meta_app_secret: null, ...over,
})
const waba = (over = {}) => ({
  id: "inst_w", provider: "meta_cloud", status: "connected", instance_name: null,
  evolution_url: null, evolution_key: null, meta_phone_number_id: "pn1",
  meta_business_account_id: "waba1", meta_access_token: "tok", meta_app_secret: "s", ...over,
})

let fetchResposta: { ok: boolean; status: number; body: string }
beforeEach(() => {
  cenario.instancias = []; cenario.igs = []; cenario.erroLeitura = null
  updates.length = 0; erroUpdate = null; providerLanca = null
  logoutMock.mockClear()
  fetchResposta = { ok: true, status: 200, body: '{"success":true}' }
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: fetchResposta.ok, status: fetchResposta.status, text: async () => fetchResposta.body,
  })))
})

describe("baileys", () => {
  it("chama logout e marca disconnected", async () => {
    cenario.instancias = [baileys()]
    const r = await pausarCanaisDoTenant(TENANT, "suspensao")

    expect(logoutMock).toHaveBeenCalledOnce()
    expect(r.pausados).toEqual([{ canal: "baileys", instancia: "inst_b" }])
    expect(updates[0].patch.status).toBe("disconnected")
  })

  it("🔴 provider que falha NÃO marca disconnected — o banco não pode afirmar o que não houve", async () => {
    cenario.instancias = [baileys()]
    providerLanca = "evolution fora do ar"

    const r = await pausarCanaisDoTenant(TENANT, "suspensao")

    expect(r.pausados).toHaveLength(0)
    expect(r.falhas[0].erro).toContain("evolution fora do ar")
    // A garantia que importa: NENHUMA escrita. Um "disconnected" aqui seria exatamente o
    // estado do Bernardo — banco dizendo desligado, canal vivo, mensagem sendo destruída.
    expect(updates).toHaveLength(0)
  })

  it("instância já desconectada é ignorada (idempotente)", async () => {
    cenario.instancias = [baileys({ status: "disconnected" })]
    const r = await pausarCanaisDoTenant(TENANT, "suspensao")

    expect(logoutMock).not.toHaveBeenCalled()
    expect(r.pausados).toHaveLength(0)
    expect(r.falhas).toHaveLength(0)
  })
})

describe("WABA oficial", () => {
  it("desassina na Meta e PRESERVA o token", async () => {
    cenario.instancias = [waba()]
    const r = await pausarCanaisDoTenant(TENANT, "cobranca")

    const chamada = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(chamada[0]).toContain("/waba1/subscribed_apps")
    expect(chamada[1].method).toBe("DELETE")
    expect(r.pausados).toEqual([{ canal: "meta_cloud", instancia: "inst_w" }])

    // 🔑 O TOKEN FICA. Apagá-lo transformaria uma operação reversível (desassinar é torneira,
    //    não fechadura) numa que exige o cliente refazer o Embedded Signup — que pede admin
    //    do Business Manager, alguém que muitas vezes não é quem recebeu a cobrança.
    expect(updates[0].patch).not.toHaveProperty("meta_access_token")
  })

  it("🔴 200 com success:false é RECUSA — não pode contar como pausado", async () => {
    cenario.instancias = [waba()]
    fetchResposta = { ok: true, status: 200, body: '{"success":false}' }

    const r = await pausarCanaisDoTenant(TENANT, "cobranca")

    expect(r.pausados).toHaveLength(0)
    expect(r.falhas[0].erro).toContain("recusou")
    expect(updates).toHaveLength(0)
  })

  it("🔴 erro HTTP não marca disconnected", async () => {
    cenario.instancias = [waba()]
    fetchResposta = { ok: false, status: 400, body: '{"error":{"message":"bad"}}' }

    const r = await pausarCanaisDoTenant(TENANT, "cobranca")

    expect(r.falhas[0].erro).toContain("meta 400")
    expect(updates).toHaveLength(0)
  })

  it("sem token não tenta desassinar — falha explícita", async () => {
    cenario.instancias = [waba({ meta_access_token: null })]
    const r = await pausarCanaisDoTenant(TENANT, "cobranca")

    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(r.falhas[0].erro).toContain("impossível desassinar")
  })
})

describe("Instagram", () => {
  it("🔴 entra como PENDENTE, nunca como pausado — e não faz revoke local", async () => {
    cenario.igs = [{ id: "cc_1", external_account_id: "ig123" }]

    const r = await pausarCanaisDoTenant(TENANT, "suspensao")

    expect(r.pausados).toHaveLength(0)
    expect(r.pendentes).toHaveLength(1)
    expect(r.pendentes[0].canal).toBe("instagram")
    // Apagar o token local pára de RESPONDER e não pára de RECEBER ⇒ a mensagem continuaria
    // chegando e sendo descartada. Seria o padrão Bernardo com outro nome.
    expect(updates).toHaveLength(0)
  })
})

describe("falha de leitura", () => {
  it("🔴 erro de banco vira FALHA, nunca 'nenhum canal'", async () => {
    cenario.erroLeitura = "connection reset"

    const r = await pausarCanaisDoTenant(TENANT, "suspensao")

    // O `?? []` que transforma erro em lista vazia já apagou um card por meses neste projeto.
    // Aqui ele reportaria "pausei tudo" sem ter pausado nada.
    expect(r.falhas).toHaveLength(1)
    expect(r.falhas[0].erro).toContain("leitura")
    expect(r.pausados).toHaveLength(0)
  })

  it("update que falha não conta como pausado", async () => {
    cenario.instancias = [baileys()]
    erroUpdate = { message: "deadlock" }

    const r = await pausarCanaisDoTenant(TENANT, "suspensao")

    expect(r.pausados).toHaveLength(0)
    expect(r.falhas[0].erro).toContain("deadlock")
  })
})

describe("caminho de volta", () => {
  it("aponta o que ficou fora, e o baileys exige QR", async () => {
    cenario.instancias = [
      { id: "inst_b", provider: "baileys" },
      { id: "inst_w", provider: "meta_cloud" },
    ]

    const fora = await canaisDerrubados(TENANT)

    expect(fora).toEqual([
      { canal: "baileys",    instancia: "inst_b", precisaQr: true  },
      { canal: "meta_cloud", instancia: "inst_w", precisaQr: false },
    ])
  })

  it("🔴 erro de leitura não vira 'está tudo conectado'", async () => {
    cenario.erroLeitura = "timeout"
    const fora = await canaisDerrubados(TENANT)
    // "Não consegui perguntar" e "tudo certo" são conclusões opostas — a segunda cala.
    expect(fora).toHaveLength(1)
  })
})
