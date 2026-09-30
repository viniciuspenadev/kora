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
//    cliente, e-mail, CPF e token que veio ecoado de fora.
//
// ⚠️ FRONTEIRA HONESTA (auditoria 11/08): isto pega **padrão**, não semântica. Nome
//    próprio e endereço passam — regex não sabe que "Joao da Silva" é uma pessoa. A
//    proteção desses casos não é este arquivo; é a coluna ser service_role-only. Quem
//    escreve `meta` continua responsável por não colocar identidade lá.

/** Teto de tamanho: mensagem de erro não é stack trace nem corpo de resposta. */
const MAX = 500

/** Marcador interno pra proteger UUID das regras numéricas. NUL não existe em texto real. */
const NUL = "\u0000"

/**
 * 🔴 O UUID É PROTEGIDO ANTES DE TUDO — e isto nasceu de um bug real (auditoria 11/08).
 *
 *    A regra do cartão (13 a 19 dígitos com hífen ou espaço no meio) tratava o hífen do
 *    UUID como separador e comia a cauda dele:
 *      `tenant 0d907fdd-1111-2222-3333-444455556666 falhou`
 *      → `tenant 0d907fdd-1111-2222-[cartao]falhou`   (e engolia o espaço seguinte)
 *
 *    Não vazava nada — **destruía** o único dado que serve pra investigar: qual tenant,
 *    qual fatura, qual evento. Redator que apaga a chave de correlação transforma o livro
 *    em "algo deu errado em algum lugar".
 *
 * ⚠️ E o teste que eu tinha escrito para essa exata invariante PASSAVA, porque a amostra
 *    que escolhi tinha letras na cauda. Dispara só quando a cauda hifenizada tem 13+
 *    dígitos — algo como 1 em 300 UUIDs. Amostra feliz é como bug sobrevive a um teste
 *    que existe pra pegá-lo.
 */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

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
  // Corrida longa SEM hífen: token/hash. O UUID já saiu de cena acima.
  [/\b[A-Za-z0-9]{32,}\b/g,                                        "[opaco]"],

  // ── Identidade ──────────────────────────────────────────────────────────
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,                                "[email]"],
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g,                    "[cnpj]"],

  // 🔴 O FORMATO LOCAL VEM ANTES DO CPF (auditoria 11/08). A regra só existia com o `55`
  //    na frente — e mensagem montada por gente escreve `(11) 98765-4321`, que é o
  //    formato que o brasileiro digita. Passava inteiro para uma coluna consultável.
  [/\(\d{2}\)\s?9?\d{4}[-\s]?\d{4}\b/g,                            "[telefone]"],
  [/\b\d{2}\s9?\d{4}[-\s]\d{4}\b/g,                                "[telefone]"],
  [/\+?55\s?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g,                  "[telefone]"],

  // ⚠️ Depois dos telefones: celular com DDD sem pontuação tem 11 dígitos, igual ao CPF.
  //    Fica redigido dos dois jeitos; a ordem só decide o rótulo.
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,                            "[cpf]"],

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

  // 🔑 Tira os UUIDs do alcance das regras e devolve no fim (ver o comentário do `UUID`).
  const guardados: string[] = []
  s = s.replace(UUID, (m) => {
    guardados.push(m)
    return `${NUL}${guardados.length - 1}${NUL}`
  })

  for (const [re, por] of REGRAS) s = s.replace(re, por)

  s = s.replace(new RegExp(`${NUL}(\\d+)${NUL}`, "g"), (_, i: string) => guardados[Number(i)] ?? "")

  s = s.trim()
  if (s.length > MAX) s = `${s.slice(0, MAX)}…`
  return s.length > 0 ? s : null
}

/**
 * Passa o redator por todo valor de texto de um objeto (recursivo) e limita o tamanho
 * total. Para o `meta` do livro de execuções: mesmo com a regra escrita de "forma, nunca
 * conteúdo", quem escreve o próximo job não vai ler a regra.
 *
 * 🔴 AS CHAVES TAMBÉM SÃO REDIGIDAS (auditoria 11/08). Antes só os valores passavam pelo
 *    redator — e um `{ porContato: { "joao@x.com": 3 } }` vazaria o e-mail **na chave**,
 *    em claro. Agrupar contador por identificador é a coisa mais natural do mundo de se
 *    fazer, e ninguém pensaria nisso como vazamento.
 */
export function redigirObjeto(v: unknown, profundidade = 0): unknown {
  if (profundidade > 6) return "[fundo]"
  if (typeof v === "string") return redigirTexto(v)
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redigirObjeto(x, profundidade + 1))
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .slice(0, 50)
        .map(([k, x]) => [redigirTexto(k) ?? k, redigirObjeto(x, profundidade + 1)]),
    )
  }
  return v
}
