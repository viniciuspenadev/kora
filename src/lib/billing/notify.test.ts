// ═══════════════════════════════════════════════════════════════
// O disparador dos avisos de cobrança
// ═══════════════════════════════════════════════════════════════
//
// 🔴 Aqui moram três decisões que, se voltarem atrás, falham EM SILÊNCIO — sem exceção, sem
//    log de erro, sem tela quebrada:
//      1. quem recebe (dinheiro ≠ produto): errar isso manda o VALOR pro admin;
//      2. a chave de idempotência incluir o destinatário: sem isso o índice único global
//         entrega pro primeiro e descarta os outros quatro como "duplicado";
//      3. a data pura virar meio-dia: sem isso o e-mail anuncia o vencimento um dia antes.
//    Nenhuma das três dá erro. Todas mentem.
//
// 🔒 Nada toca produção nem rede: `@/lib/supabase` e `sendEmail` são trocados antes do
//    import do módulo.

import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("server-only", () => ({}))

interface EnvioCapturado {
  to: string; subject: string; text?: string; html: string
  templateSlug: string; tenantId?: string; dedupeKey?: string
}
const enviados: EnvioCapturado[] = []
const sendMock = vi.fn(async (i: EnvioCapturado) => { enviados.push(i); return { ok: true as const, id: "em_1" } })
vi.mock("@/lib/email/send", async (orig) => ({
  // ⚠️ Os BUILDERS são os de verdade — o teste checa o texto que o cliente lê. Só o
  //    transporte é falso.
  ...(await orig() as object),
  sendEmail: (i: unknown) => sendMock(i as EnvioCapturado),
}))

const destinatarios = vi.fn(async (_t: string, escopo: string) => ({
  emails: escopo === "dinheiro" ? ["dono@cliente.com", "contador@escritorio.com"] : ["dono@cliente.com", "admin@cliente.com"],
  tenantName: "Clínica Teste",
  usouFallback: false,
}))
vi.mock("./recipients", () => ({ resolveBillingRecipients: (t: string, e: string) => destinatarios(t, e) }))

const { avisarCobranca } = await import("./notify")

const TENANT = "11111111-1111-1111-1111-111111111111"

beforeEach(() => {
  enviados.length = 0
  sendMock.mockClear(); sendMock.mockImplementation(async (i) => { enviados.push(i); return { ok: true as const, id: "em_1" } })
  destinatarios.mockClear()
})

describe("recorte de destinatário", () => {
  it("aviso COM valor vai pelo escopo dinheiro (titular + dono, nunca o atendente)", async () => {
    await avisarCobranca({ tenantId: TENANT, aviso: "fatura_vencida", fato: "pay_1", valorCents: 34990 })
    expect(destinatarios).toHaveBeenCalledWith(TENANT, "dinheiro")
  })

  it("'voltou ao normal' vai pelo escopo produto — quem OPERA precisa saber", async () => {
    await avisarCobranca({ tenantId: TENANT, aviso: "restabelecido", fato: "pay_1" })
    expect(destinatarios).toHaveBeenCalledWith(TENANT, "produto")
  })

  it("sem destinatário nenhum não envia — e grita, porque é falha de cadastro", async () => {
    destinatarios.mockResolvedValueOnce({ emails: [], tenantName: "x", usouFallback: false })
    const grito = vi.spyOn(console, "error").mockImplementation(() => {})

    await avisarCobranca({ tenantId: TENANT, aviso: "fatura_vencida", fato: "pay_1", valorCents: 100 })

    expect(enviados).toHaveLength(0)
    expect(String(grito.mock.calls[0]?.[0])).toContain("SEM-DESTINATARIO")
    grito.mockRestore()
  })
})

describe("idempotência", () => {
  it("a chave inclui o DESTINATÁRIO — senão só o primeiro da lista receberia", async () => {
    await avisarCobranca({ tenantId: TENANT, aviso: "pagamento_confirmado", fato: "pay_1", valorCents: 34990 })

    expect(enviados).toHaveLength(2)
    const chaves = enviados.map((e) => e.dedupeKey)
    expect(new Set(chaves).size).toBe(2)                        // 🔴 o índice único é GLOBAL
    expect(chaves[0]).toContain("dono@cliente.com")
    expect(chaves[0]).toContain("pay_1")
  })

  it("a chave é o FATO, não o evento — o mesmo pagamento chega em eventos diferentes", async () => {
    await avisarCobranca({ tenantId: TENANT, aviso: "pagamento_confirmado", fato: "pay_1", valorCents: 34990 })
    const primeira = enviados.map((e) => e.dedupeKey)
    enviados.length = 0

    // Segunda entrega (CONFIRMED → RECEIVED, ou o reconcile de 15 min): MESMA chave.
    await avisarCobranca({ tenantId: TENANT, aviso: "pagamento_confirmado", fato: "pay_1", valorCents: 34990 })

    expect(enviados.map((e) => e.dedupeKey)).toEqual(primeira)
  })

  it("avisos diferentes do mesmo pagamento não colidem entre si", async () => {
    await avisarCobranca({ tenantId: TENANT, aviso: "pagamento_confirmado", fato: "pay_1", valorCents: 1 })
    await avisarCobranca({ tenantId: TENANT, aviso: "restabelecido", fato: "pay_1" })

    const chaves = enviados.map((e) => e.dedupeKey)
    expect(new Set(chaves).size).toBe(chaves.length)
  })
})

describe("conteúdo", () => {
  it("data PURA não anda pra trás no fuso de São Paulo (2026-08-11 ≠ 10 de agosto)", async () => {
    await avisarCobranca({
      tenantId: TENANT, aviso: "fatura_vencida", fato: "pay_1",
      valorCents: 34990, quando: "2026-08-11", diasCarencia: 7,
    })
    expect(enviados[0].text).toContain("11 de agosto")
    expect(enviados[0].text).not.toContain("10 de agosto")
  })

  it("o aviso de atraso diz o que CONTINUA antes do que parou", async () => {
    await avisarCobranca({ tenantId: TENANT, aviso: "fatura_vencida", fato: "pay_1", valorCents: 34990, diasCarencia: 7 })

    const t = enviados[0].text ?? ""
    expect(t.indexOf("CONTINUA FUNCIONANDO")).toBeGreaterThan(-1)
    expect(t.indexOf("CONTINUA FUNCIONANDO")).toBeLessThan(t.indexOf("PAUSADO"))
    expect(t).toContain("7 dias")
  })

  it("valor ausente degrada a frase em vez de imprimir R$ 0,00", async () => {
    await avisarCobranca({ tenantId: TENANT, aviso: "fatura_vencida", fato: "pay_1", valorCents: null })

    expect(enviados[0].subject).toBe("Fatura em aberto")
    expect(enviados[0].text).not.toContain("R$ 0,00")
    expect(enviados[0].html).not.toContain("R$ 0,00")
  })

  it("valor zero é tratado como ausente (o gateway às vezes manda 0)", async () => {
    await avisarCobranca({ tenantId: TENANT, aviso: "pagamento_confirmado", fato: "pay_1", valorCents: 0 })
    expect(enviados[0].subject).toBe("Pagamento confirmado")
  })

  it("cada aviso carrega o slug do catálogo (é o que agrupa o log do god mode)", async () => {
    await avisarCobranca({ tenantId: TENANT, aviso: "cartao_recusado", fato: "pay_1", valorCents: 34990 })
    expect(enviados[0].templateSlug).toBe("billing_card_failed")
    expect(enviados[0].tenantId).toBe(TENANT)
  })
})

describe("nunca derruba quem chamou", () => {
  // 🔴 Roda dentro do processamento do webhook. Uma exceção aqui deixaria o evento pendente
  //    e o faria ser reprocessado a cada 15 min — reaplicando plano e baixa de fatura por
  //    causa de um e-mail. Aviso é consequência do fato, nunca condição dele.
  it("falha de envio não vira exceção", async () => {
    sendMock.mockRejectedValue(new Error("resend fora do ar") as never)
    const grito = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(avisarCobranca({ tenantId: TENANT, aviso: "pagamento_confirmado", fato: "pay_1", valorCents: 1 }))
      .resolves.toBeUndefined()

    expect(String(grito.mock.calls.at(-1)?.[0])).toContain("envio-falhou")
    grito.mockRestore()
  })

  it("falha ao RESOLVER destinatário também não vira exceção", async () => {
    destinatarios.mockRejectedValueOnce(new Error("banco fora") as never)
    const grito = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(avisarCobranca({ tenantId: TENANT, aviso: "fatura_vencida", fato: "pay_1", valorCents: 1 }))
      .resolves.toBeUndefined()

    expect(String(grito.mock.calls.at(-1)?.[0])).toContain("excecao")
    grito.mockRestore()
  })

  it("um destinatário que falha não impede os outros", async () => {
    sendMock.mockImplementation(async (i) => {
      if (i.to.startsWith("contador")) throw new Error("endereço recusado")
      enviados.push(i)
      return { ok: true as const, id: "em_1" }
    })
    const grito = vi.spyOn(console, "error").mockImplementation(() => {})

    await avisarCobranca({ tenantId: TENANT, aviso: "pagamento_confirmado", fato: "pay_1", valorCents: 1 })

    expect(enviados.map((e) => e.to)).toEqual(["dono@cliente.com"])
    grito.mockRestore()
  })
})
