// ═══════════════════════════════════════════════════════════════
// Redator de TEXTO LIVRE — para mensagem de erro que vai ser PERSISTIDA
// ═══════════════════════════════════════════════════════════════
//
// 🔴 POR QUE ISTO PRECISOU EXISTIR. O redator do projeto (`logger.ts`) é do pino e
//    funciona por **caminho de campo**: censura `token`, `number`, `authorization`. Ele não
//    olha dentro de uma string. E a mensagem de erro de um gateway é justamente isso — uma
//    string livre, montada por terceiro, com o que ele quiser dentro.
//
// 🔴 E GUARDAR É PIOR QUE LOGAR. Log rotaciona, é write-only na prática e ninguém faz
//    `JOIN` nele. Uma coluna de erro numa tabela fica **consultável, correlacionável e
//    retida** — no mesmo banco de tudo. Persistir `e.message` cru de jobs que falam com
//    Asaas, Meta, Evolution e Resend seria criar um depósito pesquisável de nome de
//    cliente, e-mail, CPF e token que veio ecoado de fora. O pentest de 10/08 já apontou
//    "logs registram motivos bancários crus" (M-09); isto existe pra não institucionalizar
//    o mesmo defeito com um índice em cima.
//
// 🔑 O QUE FICA É A FORMA: status HTTP, código de erro, a frase técnica. O que sai é
//    identidade. Erro que perde o CPF continua dizendo o que quebrou; erro que guarda o
//    CPF vira dado pessoal sob retenção que ninguém declarou.

/** Teto de tamanho: mensagem de erro não é stack trace nem corpo de resposta. */
const MAX = 500

/**
 * ⚠️ ORDEM IMPORTA. Os padrões específicos (token, e-mail, documento) vêm ANTES dos
 *    genéricos de dígitos — senão o genérico come pedaços do específico e o resultado fica
 *    irreconhecível sem ficar mais seguro.
 */
const REGRAS: Array<[RegExp, string]> = [
  // ── Credenciais ─────────────────────────────────────────────────────────
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, "[jwt]"],
  [/\b(?:sbp|sk|pk|rk|whsec)_[A-Za-z0-9]{8,}/gi,                   "[credencial]"],
  [/\bBearer\s+\S+/gi,                                             "Bearer [credencial]"],
  // Corrida longa SEM hífen: token/hash. O UUID tem hífens e sobrevive — e ele é útil
  // pra investigar (é id de tenant, de fatura, de evento).
  [/\b[A-Za-z0-9]{32,}\b/g,                                        "[opaco]"],

  // ── Identidade ──────────────────────────────────────────────────────────
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,                                "[email]"],
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g,                    "[cnpj]"],
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,                            "[cpf]"],
  [/\+?55\s?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g,                  "[telefone]"],

  // ── Cartão ──────────────────────────────────────────────────────────────
  // 🔒 Nunca deve chegar aqui (o número não sai do formulário), mas custo zero e o dia
  //    em que chegar é o dia em que ninguém está olhando.
  [/\b(?:\d[ -]?){13,19}\b/g,                                      "[cartao]"],

  // ── Query string ────────────────────────────────────────────────────────
  // `?apikey=…&customer=…` é onde credencial e identidade viajam juntas.
  [/\?[^\s"']{1,400}/g,                                            "?[query]"],
]

/**
 * Deixa a mensagem legível e sem identidade. Use SEMPRE antes de gravar texto de erro de
 * origem externa em coluna, e antes de mandar por e-mail.
 */
export function redigirTexto(bruto: unknown): string | null {
  if (bruto === null || bruto === undefined) return null

  let s = typeof bruto === "string" ? bruto : String(bruto)
  // Uma linha só: stack trace não acrescenta nada aqui e multiplica a chance de vazar.
  s = s.split("\n")[0]

  for (const [re, por] of REGRAS) s = s.replace(re, por)

  s = s.trim()
  if (s.length > MAX) s = `${s.slice(0, MAX)}…`
  return s.length > 0 ? s : null
}

/**
 * Passa o redator por todo valor de texto de um objeto (recursivo) e limita o tamanho
 * total. Para o `meta` do livro de execuções: mesmo com a regra escrita de "forma, nunca
 * conteúdo", quem escreve o próximo job não vai ler a regra.
 */
export function redigirObjeto(v: unknown, profundidade = 0): unknown {
  if (profundidade > 6) return "[fundo]"
  if (typeof v === "string") return redigirTexto(v)
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redigirObjeto(x, profundidade + 1))
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .slice(0, 50)
        .map(([k, x]) => [k, redigirObjeto(x, profundidade + 1)]),
    )
  }
  return v
}
