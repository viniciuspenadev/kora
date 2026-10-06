// ═══════════════════════════════════════════════════════════════
// Bandeira do cartão — UMA regra, cliente e servidor
// ═══════════════════════════════════════════════════════════════
//
// 🔑 Este módulo é isomórfico de propósito (sem `server-only`): o FORMULÁRIO precisa dele
//    pra mostrar a marca enquanto a pessoa digita, e o MOTOR precisa dele pra gravar a
//    bandeira junto do token. Se cada lado tivesse a própria tabela de prefixos, um dia a
//    tela mostraria "Elo" e o banco guardaria "Visa" — e ninguém descobriria, porque as
//    duas telas nunca aparecem juntas.
//
// ⚠️ ISTO NÃO É VALIDAÇÃO. Quem decide se o cartão presta é o gateway. Aqui é só
//    RECONHECIMENTO, com dois usos: dar retorno visual a quem digita e formatar o campo
//    (Amex tem 15 dígitos e CVV de 4; o resto tem 16 e CVV de 3). Tratar isto como gate
//    recusaria cartão bom de bandeira que a gente não mapeou.

export type Bandeira = "visa" | "mastercard" | "amex" | "elo" | "hipercard" | "diners"

/** Nome como o cliente conhece — usado em tela e no rótulo guardado. */
export const BANDEIRA_LABEL: Record<Bandeira, string> = {
  visa:       "Visa",
  mastercard: "Mastercard",
  amex:       "American Express",
  elo:        "Elo",
  hipercard:  "Hipercard",
  diners:     "Diners",
}

/**
 * As bandeiras que a fileira "Aceitamos" exibe.
 *
 * ⚠️ É uma lista de EXIBIÇÃO, não um gate: Diners fica de fora porque é resíduo no
 *    Brasil e um sexto chip aperta a linha — mas um cartão Diners **passa normalmente**.
 *    Mostrar menos do que se aceita nunca bloqueia ninguém; mostrar mais seria mentira.
 */
export const BANDEIRAS_ACEITAS: readonly Bandeira[] = ["visa", "mastercard", "elo", "amex", "hipercard"]

// ── Tabela de prefixos ──────────────────────────────────────────────────────
//
// 🔴 A VERSÃO ANTERIOR MARCAVA TODO CARTÃO ELO COMO VISA OU MASTERCARD. O detector
//    testava `^4` antes de Elo, e a Elo emite em `4011`, `4312`, `4514`, `4573`, `5041`,
//    `5066`, `509…` — faixas que são, na origem, Visa e Mastercard. Elo é perto de um
//    quinto do mercado brasileiro: não era um caso de borda, era um em cada cinco.
//
// ⚠️ Prefixos de 6 dígitos (não de 4). Com 4, `4514` roubava da Visa toda a faixa
//    `4514xx` — e só `451416` é Elo. Precisão aqui é barata e o erro é silencioso: o
//    rótulo errado só aparece meses depois, na tela que diz qual cartão cobra o cliente.
const ELO_PREFIXOS = [
  "401178", "401179", "431274", "438935", "451416", "457393", "457631", "457632",
  "504175", "627780", "636297", "636368",
]
/** Faixas contínuas — inclusivas nas duas pontas, comparadas pelos 6 primeiros dígitos. */
const ELO_FAIXAS: ReadonlyArray<readonly [number, number]> = [
  [506699, 506778], [509000, 509999],
  [650031, 650051], [650405, 650439], [650485, 650538], [650541, 650598],
  [650700, 650727], [650901, 650978], [651652, 651679], [655000, 655058],
]
// ⚠️ `3841xx` é Hipercard, e cai dentro da faixa `38` que a versão anterior dava pra Elo
//    (errado) e que hoje é Diners. Por isso Hipercard vem ANTES de Diners.
const HIPERCARD_PREFIXOS = ["606282", "384100", "384140", "384160"]

/**
 * Reconhece a bandeira pelo prefixo. `null` = ainda indefinida OU não reconhecida — em
 * ambos os casos o cartão pode ser perfeitamente válido.
 *
 * 🔑 SÓ DECIDE COM 6 DÍGITOS (exceto Amex). Elo e Hipercard só se separam de Visa,
 *    Mastercard e Diners no 6º dígito; decidir antes faria o chip mostrar "Visa" e trocar
 *    pra "Elo" três teclas depois. Chip neutro é honesto; chip que se corrige sozinho na
 *    frente da pessoa parece defeito.
 * ⚠️ Amex é a exceção porque `34`/`37` não colide com ninguém no mundo — e porque ela
 *    reconfigura o formulário inteiro (15 dígitos, CVV de 4, agrupamento 4-6-5). Esperar
 *    até o 6º dígito faria a máscara pular no meio da digitação.
 */
export function detectarBandeira(numero: string | null | undefined): Bandeira | null {
  const d = (numero ?? "").replace(/\D/g, "")

  if (d.length >= 2 && /^3[47]/.test(d)) return "amex"
  if (d.length < 6) return null

  const p6 = Number(d.slice(0, 6))
  if (ELO_PREFIXOS.includes(d.slice(0, 6)))                 return "elo"
  if (ELO_FAIXAS.some(([ini, fim]) => p6 >= ini && p6 <= fim)) return "elo"
  if (HIPERCARD_PREFIXOS.includes(d.slice(0, 6)))           return "hipercard"
  if (/^(30[0-5]|36|38)/.test(d))                           return "diners"
  if (/^4/.test(d))                                          return "visa"
  if (/^(5[1-5]|2[2-7])/.test(d))                            return "mastercard"
  return null
}

/**
 * Converte a bandeira que o GATEWAY informou pro nosso vocabulário. `null` quando ele
 * não informou ou mandou algo que não conhecemos — e aí o chamador cai na detecção local.
 *
 * 🔑 Existe porque o Asaas devolve a bandeira na resposta da tokenização, e **ele é a
 *    fonte mais confiável que existe**: quem processa o cartão sabe a bandeira sem
 *    depender de tabela de prefixo nenhuma. A detecção local vira o piso, não o teto.
 */
export function normalizarBandeira(bruta: string | null | undefined): Bandeira | null {
  const s = (bruta ?? "").trim().toLowerCase().replace(/[\s_-]/g, "")
  if (!s) return null
  if (s === "visa")                            return "visa"
  if (s === "mastercard" || s === "master")    return "mastercard"
  if (s === "amex" || s === "americanexpress") return "amex"
  if (s === "elo")                             return "elo"
  if (s === "hipercard" || s === "hiper")      return "hipercard"
  if (s.startsWith("diners"))                  return "diners"
  return null
}

/**
 * Teto ABSOLUTO de dígitos de um cartão (ISO/IEC 7812). Ninguém digita mais que isto.
 *
 * 🔴 É ESTE o número que pode limitar um campo de entrada — nunca `digitosDoNumero`.
 *    Truncar pela bandeira parece inofensivo e é o pior defeito possível nesta tela:
 *    Hipercard tem família de **19 dígitos** que começa em `38` (cai no nosso ramo de
 *    Diners, de 14), e Visa também emite 19. O campo parava de aceitar tecla no 15º
 *    dígito e a tela ainda acusava *"esse número não confere"* — culpando o cartão do
 *    cliente por um limite nosso, sem saída nenhuma pra ele.
 */
export const MAX_DIGITOS_CARTAO = 19

/**
 * Comprimento TÍPICO da bandeira. É **dica de formatação e de avanço automático**, não
 * validação: quem diz se o cartão presta é o gateway (ver o aviso no topo do arquivo).
 *
 * ⚠️ Nunca use isto como `maxLength` nem como condição de "está incompleto" — use
 *    `MAX_DIGITOS_CARTAO` e o Luhn. Bandeira que não mapeamos, e família longa de bandeira
 *    que mapeamos, existem as duas.
 */
export function digitosDoNumero(b: Bandeira | null): number {
  if (b === "amex")   return 15
  if (b === "diners") return 14
  return 16
}

/** Tamanho do código de segurança. Amex usa 4 — e ele fica na FRENTE do cartão. */
export function digitosDoCvv(b: Bandeira | null): number {
  return b === "amex" ? 4 : 3
}

/**
 * Agrupamento visual do número. Amex é 4-6-5; Diners 4-6-4; o resto 4-4-4-4.
 *
 * ⚠️ Formatar Amex como 4-4-4-4 não é detalhe estético: a pessoa perde a referência de
 *    onde está no cartão dela e digita errado com mais frequência.
 */
export function agruparNumero(numero: string, b: Bandeira | null): string {
  const d = (numero ?? "").replace(/\D/g, "").slice(0, MAX_DIGITOS_CARTAO)
  if (b === "amex")   return emGrupos(d, [4, 6, 5])
  if (b === "diners") return emGrupos(d, [4, 6, 4])
  return emGrupos(d, [4, 4, 4, 4])
}

/**
 * Quebra em grupos e **despeja a sobra em blocos de 4**.
 *
 * 🔴 A sobra é o ponto. A versão anterior usava um regex que descartava o que passasse do
 *    último grupo — então um cartão de 19 dígitos identificado como Diners tinha os 5
 *    últimos apagados NA TELA, sem aviso. Formatação nunca pode esconder dígito: quem
 *    digitou tem que ver o que digitou, mesmo que a gente tenha errado a bandeira.
 */
function emGrupos(d: string, tamanhos: number[]): string {
  const partes: string[] = []
  let i = 0
  for (const t of tamanhos) {
    if (i >= d.length) break
    partes.push(d.slice(i, i + t)); i += t
  }
  while (i < d.length) { partes.push(d.slice(i, i + 4)); i += 4 }
  return partes.join(" ")
}

/** Placeholder com a MESMA forma do agrupamento — senão o campo mente sobre o formato. */
export function placeholderDoNumero(b: Bandeira | null): string {
  return agruparNumero("0".repeat(digitosDoNumero(b)), b)
}

/**
 * Os 4 últimos dígitos — o único pedaço do número que a Kora guarda.
 *
 * 🔒 É o mesmo dado que aparece na fatura do banco do cliente. Não é dado sensível, e é o
 *    que permite a tela dizer QUAL cartão está sendo cobrado ou substituído.
 * ⚠️ Devolve `null` com menos de 4 dígitos em vez de um pedaço — meio dado num rótulo de
 *    cartão é pior que nenhum: parece informação e não identifica nada.
 */
export function ultimos4(numero: string | null | undefined): string | null {
  const d = (numero ?? "").replace(/\D/g, "")
  return d.length >= 4 ? d.slice(-4) : null
}

/**
 * Rótulo humano de um cartão guardado: `Mastercard ···· 4242`.
 *
 * ⚠️ Sem bandeira mas com os 4 dígitos ⇒ `Cartão ···· 4242`. Sem os dígitos ⇒ `null`, e o
 *    chamador diz "Cartão cadastrado". Nunca preencher com `••••` inventado: a tela
 *    passaria a exibir um identificador que não identifica nada.
 */
export function rotuloDoCartao(bandeira: string | null | undefined, last4: string | null | undefined): string | null {
  const l4 = (last4 ?? "").trim()
  if (!/^\d{4}$/.test(l4)) return null
  const b = normalizarBandeira(bandeira)
  return `${b ? BANDEIRA_LABEL[b] : "Cartão"} ···· ${l4}`
}
