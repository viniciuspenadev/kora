// ═══════════════════════════════════════════════════════════════
// Gateway de mentira — o Asaas que a gente consegue quebrar de propósito
// ═══════════════════════════════════════════════════════════════
//
// 🔒 Substitui `lib/asaas/client` via `vi.mock`. O cliente real nunca carrega: sem
//    `ASAAS_API_KEY`, sem chamada HTTP, sem sandbox, sem conta merchant. Nada sai da máquina.
//
// 🔑 A razão de existir: os bugs que estes testes trancam só aparecem quando o gateway se
//    comporta MAL — timeout, resposta sem campo, pagamento de outro dono. Com a conta real
//    não dá pra pedir um timeout na hora certa; aqui dá (`timeoutEm`).

/** Espelha a classe real — o handler faz `instanceof` e checa `.status === 0`. */
export class AsaasError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, message: string, code: string | null = null) {
    super(message)
    this.name = "AsaasError"
    this.status = status
    this.code = code
  }
}

type Resposta = unknown | (() => unknown)

export class FakeGateway {
  private rotas = new Map<string, Resposta>()
  readonly chamadas: Array<{ metodo: string; path: string; body?: unknown }> = []

  /** `responde("GET /payments/pay_1", {...})` — ou uma função, pra lançar/variar. */
  responde(chave: string, r: Resposta): this {
    this.rotas.set(chave, r)
    return this
  }

  /** Simula o timeout de 20s do cliente real: `AsaasError` com status 0. */
  timeoutEm(chave: string): this {
    return this.responde(chave, () => {
      throw new AsaasError(0, "O gateway demorou demais para responder.")
    })
  }

  private resolver(metodo: string, path: string, body?: unknown): unknown {
    this.chamadas.push({ metodo, path, body })
    // Casa exato primeiro; depois por prefixo (pra `/subscriptions?externalReference=…`).
    const exata = this.rotas.get(`${metodo} ${path}`)
    const achada = exata ?? [...this.rotas.entries()]
      .find(([k]) => k.startsWith(`${metodo} `) && path.startsWith(k.slice(metodo.length + 1)))?.[1]
    if (achada === undefined) {
      // ⚠️ LANÇA em rota não programada, de propósito: se um caminho novo do código
      //    chamar o gateway e o teste não previr, isso aparece alto — em vez de devolver
      //    `undefined` e o teste passar por acidente.
      throw new AsaasError(404, `rota não programada no fake: ${metodo} ${path}`)
    }
    return typeof achada === "function" ? (achada as () => unknown)() : achada
  }

  readonly client = {
    get:  async <T>(path: string) => this.resolver("GET", path) as T,
    post: async <T>(path: string, body: unknown) => this.resolver("POST", path, body) as T,
    put:  async <T>(path: string, body: unknown) => this.resolver("PUT", path, body) as T,
    del:  async <T>(path: string) => this.resolver("DELETE", path) as T,
  }
}

/**
 * Cópia fiel de `mensagemSeguraDoGateway` — os testes de mensagem dependem do MESMO
 * comportamento do real (recusa vira UMA frase, pra não virar oráculo de teste de cartão).
 */
export function mensagemSeguraDoGateway(e: unknown, fallback: string): string {
  if (!(e instanceof AsaasError)) return fallback
  const cru = (e.message ?? "").toLowerCase()
  const recusa = [
    "recusad", "negad", "declin", "insufficient", "saldo", "limite",
    "invalid credit card", "cartão inválido", "cartao invalido",
    "expirad", "vencid", "bloquead", "não autorizada", "nao autorizada",
    "transação não", "transacao nao", "fraud", "cvv", "código de segurança",
  ]
  if (recusa.some((s) => cru.includes(s))) {
    return "Não conseguimos autorizar este cartão. Confira os dados, tente outro cartão ou fale com o seu banco."
  }
  if (/cart[ãa]o|credit\s?card|cvv|ccv/.test(cru)) {
    return "Não conseguimos autorizar este cartão. Confira os dados, tente outro cartão ou fale com o seu banco."
  }
  return e.message
}
