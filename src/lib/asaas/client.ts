import "server-only"

// ═══════════════════════════════════════════════════════════════
// Cliente HTTP do Asaas — porta ÚNICA de saída para o gateway
// ═══════════════════════════════════════════════════════════════
// docs/asaas-billing-design.md
//
// 🔑 TUDO passa por aqui. Não é organização — é onde as três regras que não podem ser
//    esquecidas ficam impossíveis de esquecer: o header certo, o timeout, e o silêncio
//    sobre dado de cartão. Uma segunda forma de chamar o Asaas seria uma segunda chance
//    de logar um número de cartão.

/**
 * ⚠️ O header é `access_token`, **NÃO** `Authorization: Bearer`.
 *    A documentação diz Bearer; **testado ao vivo no sandbox em 2026-08-03, o que funciona
 *    é `access_token`**. Trocar isto por "o que a doc diz" quebra tudo com 401 — e o erro
 *    parece "chave inválida", que manda a investigação pro lado errado.
 *
 * ⚠️ A chave do Asaas COMEÇA com `$`. Em shell, sempre aspas simples; aqui não importa,
 *    mas quem for testar com `curl` precisa saber (com aspas duplas o shell expande e
 *    envia vazio).
 */
const HEADER = "access_token"

const TIMEOUT_MS = 20_000

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

function config(): { baseUrl: string; key: string } | null {
  const baseUrl = process.env.ASAAS_BASE_URL?.replace(/\/+$/, "")
  const key     = process.env.ASAAS_API_KEY
  if (!baseUrl || !key) return null
  return { baseUrl, key }
}

/** `true` se o gateway está configurado neste ambiente. Chamador decide o que fazer. */
export function asaasConfigured(): boolean {
  return config() !== null
}

/**
 * Chamada crua ao Asaas.
 *
 * 🔴 NUNCA loga o corpo da requisição. Nem em erro, nem redigido, nem parcial. Este é o
 *    único caminho do produto por onde número de cartão e CVV transitam (decisão do dono:
 *    o pagamento é processado no Kora, não em checkout hospedado — design §7), e cartão em
 *    log é o achado que encerra uma auditoria de PCI. O que se loga é a FORMA: método,
 *    caminho e status. Nunca o conteúdo.
 */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const cfg = config()
  if (!cfg) throw new AsaasError(0, "Asaas não configurado (ASAAS_BASE_URL / ASAAS_API_KEY).")

  const url = `${cfg.baseUrl}${path.startsWith("/") ? path : `/${path}`}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method,
      headers: { [HEADER]: cfg.key, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
      cache: "no-store",
    })

    const text = await res.text()
    let json: unknown = null
    try { json = text ? JSON.parse(text) : null } catch { /* resposta não-JSON */ }

    if (!res.ok) {
      // O Asaas devolve { errors: [{ code, description }] }. Extraímos a primeira —
      // é o que vira mensagem pro usuário, então precisa ser a real, não "erro genérico".
      const errs = (json as { errors?: Array<{ code?: string; description?: string }> } | null)?.errors
      const first = errs?.[0]
      const msg = first?.description ?? `Asaas respondeu ${res.status}`
      console.error("[asaas] falhou", { method, path, status: res.status, code: first?.code ?? null })
      throw new AsaasError(res.status, msg, first?.code ?? null)
    }

    console.log(JSON.stringify({ src: "asaas", method, path, status: res.status }))
    return json as T
  } catch (e) {
    if (e instanceof AsaasError) throw e
    const aborted = (e as Error).name === "AbortError"
    console.error("[asaas] erro de rede", { method, path, aborted })
    throw new AsaasError(0, aborted ? "O gateway demorou demais para responder." : "Não foi possível falar com o gateway.")
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Traduz o erro do gateway pra uma frase que ajuda o cliente e **não ensina o atacante**.
 *
 * 🔴 O ERRO CRU VOLTAVA PRO BROWSER (achado na auditoria de 07/08/2026). O Asaas distingue
 *    "cartão inexistente" de "cartão válido sem saldo" de "cartão bloqueado" — e essa
 *    distinção é **exatamente o sinal que um testador de cartões precisa**. Devolvendo a
 *    mensagem dele, a Kora virava um oráculo de validação de PAN rodando na nossa conta
 *    merchant, com duas portas desde hoje: contratar e trocar cartão.
 *
 *    O dano não é o custo das chamadas: é o Asaas bloquear a conta por enumeração e
 *    **derrubar a cobrança de todos os clientes** — mais responsabilidade de fraude.
 *
 * 🔑 O cliente recebe o que ele PODE agir sobre; o motivo exato fica no log do servidor.
 *    Recusa é recusa: "não passou, tente outro cartão ou fale com seu banco" é tudo que
 *    ele consegue fazer de útil, e é verdade em todos os casos de recusa.
 * ⚠️ Erros que NÃO são sobre o cartão (dado do titular faltando, plano inválido, conta em
 *    modo errado) seguem passando: são acionáveis, não vazam nada e a pessoa precisa deles
 *    pra se desbloquear sozinha.
 */
export function mensagemSeguraDoGateway(e: unknown, fallback: string): string {
  if (!(e instanceof AsaasError)) return fallback

  const cru = (e.message ?? "").toLowerCase()

  // Sinais de RECUSA — todos colapsam numa frase só, de propósito.
  const recusa = [
    "recusad", "negad", "declin", "insufficient", "saldo", "limite",
    "invalid credit card", "cartão inválido", "cartao invalido",
    "expirad", "vencid", "bloquead", "não autorizada", "nao autorizada",
    "transação não", "transacao nao", "fraud", "cvv", "código de segurança",
  ]
  if (recusa.some((s) => cru.includes(s))) {
    return "Não conseguimos autorizar este cartão. Confira os dados, tente outro cartão ou fale com o seu banco."
  }

  // Erro de dado do titular/negócio: acionável e sem valor pro atacante — passa direto.
  return e.message
}

export const asaas = {
  get:  <T>(path: string)                => request<T>("GET",    path),
  post: <T>(path: string, body: unknown) => request<T>("POST",   path, body),
  put:  <T>(path: string, body: unknown) => request<T>("PUT",    path, body),
  del:  <T>(path: string)                => request<T>("DELETE", path),
}
