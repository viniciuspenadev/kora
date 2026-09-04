import "server-only"
import { isValidCpf, isValidCnpj, isValidPhoneBR } from "@/lib/masks"

// ═══════════════════════════════════════════════════════════════
// Cadastro fiscal do cliente — A REGRA, num lugar só
// ═══════════════════════════════════════════════════════════════
// Este módulo existe porque o mesmo cadastro é preenchido em DOIS momentos:
//
//   1. no signup (`lib/actions/signup.ts`) — quando a conta nasce;
//   2. logado, em /configuracoes/empresa — pra completar ou corrigir.
//
// 🔴 Se cada um validasse por conta própria, eles divergiriam — e a divergência não
//    aparece como erro, aparece como cliente barrado na hora de pagar. Foi exatamente
//    o que aconteceu: o signup gravava o perfil SEM `zip` e SEM `number`, e o gate de
//    pagamento (`getTitularParaCobranca`) exige os dois. Resultado: **todo cadastro novo
//    chegava incompleto** e batia num aviso pedindo pra "falar com a gente".
//    Uma regra só, importada pelos dois lados, é o que impede isso de voltar.
//
// ⚠️ `server-only`: nada aqui recebe `tenantId` por parâmetro pra virar action pública
//    (classe C-01..C-04). Quem chama deriva o tenant da SESSÃO.

/** Colunas que o CLIENTE pode escrever em `tenant_billing_profile`. */
const CAMPOS_DO_CLIENTE = [
  "person_type",
  "legal_name",
  "trade_name",
  "tax_id",
  "state_registration",
  "municipal_registration",
  "billing_email",
  "phone",
  "responsible_name",
  "zip",
  "street",
  "number",
  "complement",
  "district",
  "city",
  "state",
] as const

export type CampoFiscal = (typeof CAMPOS_DO_CLIENTE)[number]

// ═══════════════════════════════════════════════════════════════
// "Dá pra cobrar este cliente?" — A REGRA, em UM lugar só
// ═══════════════════════════════════════════════════════════════
//
// 🔴 ELA EXISTIA EM QUATRO CÓPIAS, e a quarta derrubou uma compra (05/08). Cada cópia
//    trazia um comentário avisando do risco — `standing.ts` dizia textualmente *"MESMOS 5
//    campos de getTitularParaCobranca. Se um dia divergirem, a tela oferece 'Ativar
//    assinatura' e o gate do pagamento recusa na cara da pessoa"*. Foi exatamente isso:
//    o telefone entrou em três das quatro, a quarta ficou pra trás, a tela pulou o passo
//    de cadastro e o pagamento recusou citando campos que estavam preenchidos.
//
// 🔑 Comentário não impede divergência — só uma função impede. Quem precisa saber se dá
//    pra cobrar CHAMA daqui. Campo novo exigido pelo gateway se adiciona em UMA linha e
//    todas as telas concordam no mesmo instante.
//
// ⚠️ `faltamParaCobrar` devolve os campos que faltam PELO NOME que o cliente vê. Dizer
//    "complete CNPJ, CEP e número" pra quem tem os três preenchidos e um telefone inválido
//    é mandar a pessoa procurar um defeito que não existe.

/** O que a cobrança no cartão exige, com o rótulo que aparece pro cliente. */
const EXIGIDO_PELA_COBRANCA = [
  { campo: "legal_name",    rotulo: "nome ou razão social" },
  { campo: "tax_id",        rotulo: "CPF ou CNPJ" },
  { campo: "billing_email", rotulo: "e-mail de faturamento" },
  { campo: "zip",           rotulo: "CEP" },
  { campo: "number",        rotulo: "número do endereço" },
  { campo: "phone",         rotulo: "telefone com DDD" },
] as const

type PerfilBruto = Record<string, string | null | undefined> | null | undefined

/** Rótulos do que falta pra conseguir cobrar. Vazio = dá pra cobrar. */
export function faltamParaCobrar(p: PerfilBruto): string[] {
  return EXIGIDO_PELA_COBRANCA.filter(({ campo }) => {
    const v = (p?.[campo] ?? "").toString().trim()
    if (!v) return true
    // ⚠️ Telefone é o único que precisa de FORMA, não só presença: um número guardado mas
    //    inválido passa em "está preenchido?" e o gateway recusa mesmo assim.
    if (campo === "phone") return !isValidPhoneBR(v)
    return false
  }).map(({ rotulo }) => rotulo)
}

/** `true` quando o cadastro permite tokenizar o cartão. Fonte única. */
export function podeCobrar(p: PerfilBruto): boolean {
  return faltamParaCobrar(p).length === 0
}

/**
 * 🔴 `notes` FICA DE FORA de propósito — é o campo de anotação interna do god mode sobre
 *    o cliente ("negocia desconto", "vai cancelar"). Deixar o próprio cliente reescrever
 *    o que a operação anotou sobre ele seria constrangedor no melhor caso.
 * 🔴 `tenant_id`/`created_at`/`updated_at` também: quem carimba é o servidor.
 *    Esta lista é ALLOW-LIST — campo novo só entra aqui de forma consciente (§2 da skill
 *    database-rules: nunca `.upsert({ ...input })` com objeto do cliente).
 */

export type EntradaFiscal = Partial<Record<CampoFiscal, string | null>>

/**
 * Teto de tamanho por campo. As colunas são `text` — sem isto, o banco aceita o que vier.
 * ⚠️ Os mesmos números valem no `signup.ts` (helper `corta`). Se um mudar, o outro muda:
 *    tetos diferentes pro mesmo campo fazem o cadastro aceitar o que a tela recusa.
 */
const TETO: Partial<Record<CampoFiscal, number>> = {
  legal_name: 160, trade_name: 160, tax_id: 20,
  state_registration: 30, municipal_registration: 30,
  billing_email: 160, phone: 20, responsible_name: 120,
  zip: 12, street: 120, number: 20, complement: 60,
  district: 80, city: 80, state: 2,
}

export interface PerfilNormalizado {
  valores:  Record<string, string | null>
  /** Falta algo pro Asaas conseguir cobrar? (mesma régua de `getTitularParaCobranca`) */
  completo: boolean
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "")
const limpa  = (s: string | null | undefined) => (s ?? "").trim()

/** Aceita `nome@dominio.tld`. Frouxo de propósito: e-mail estranho ≠ e-mail inválido. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * Normaliza + valida o cadastro fiscal.
 *
 * Devolve `{ error }` na primeira falha — mensagem em PT-BR, pronta pra tela. Nunca
 * lança: o chamador (action ou signup) decide o que fazer com o erro.
 *
 * @param entrada  o que veio da tela (já filtrado pela allow-list aqui dentro)
 * @param opts.exigirCobranca  quando `true`, cobra também os campos que o Asaas exige
 *        (CEP e número). O signup passa `false` — quem está criando conta pra testar 3
 *        dias não deve ser barrado por endereço; a cobrança só acontece depois.
 */
export function normalizarPerfilFiscal(
  entrada: EntradaFiscal,
  opts: { exigirCobranca?: boolean } = {},
): { valores: Record<string, string | null>; completo: boolean } | { error: string } {
  // 1 · Allow-list: só o que está em CAMPOS_DO_CLIENTE atravessa. Qualquer outra chave
  //     (inclusive `tenant_id`) é DESCARTADA aqui, antes de chegar perto do banco.
  //     O teto por campo vem junto: as colunas são `text` (sem limite no banco), então
  //     quem limita é aqui. Sessão de owner não é desculpa pra aceitar 10 MB num "bairro".
  const v: Record<string, string | null> = {}
  for (const k of CAMPOS_DO_CLIENTE) {
    const raw = entrada[k]
    v[k] = typeof raw === "string" ? (raw.trim().slice(0, TETO[k] ?? 120) || null) : null
  }

  // 2 · Tipo de pessoa. PJ é o default histórico do cadastro.
  const tipo = v.person_type === "pf" ? "pf" : "pj"
  v.person_type = tipo
  const ehPF = tipo === "pf"

  // 3 · Documento — CPF **e** CNPJ. Nem todo assinante é empresa: tem gente física que
  //     contrata o Kora pra si. O dígito verificador é conferido aqui, no servidor, e
  //     não só na máscara da tela (máscara é conforto, não validação).
  const doc = digits(v.tax_id)
  if (!doc) return { error: ehPF ? "Informe o CPF." : "Informe o CNPJ." }
  if (ehPF && !isValidCpf(doc))   return { error: "CPF inválido. Confira os números." }
  if (!ehPF && !isValidCnpj(doc)) return { error: "CNPJ inválido. Confira os números." }
  // Guardamos só dígitos: é o formato que o Asaas espera e o que torna a busca por
  // duplicata confiável (com máscara, "11.222.333/0001-81" e "11222333000181" divergem).
  v.tax_id = doc

  // 4 · Nome. Pra PJ é a razão social; pra PF é o nome da pessoa. Mesmo campo, rótulos
  //     diferentes na tela — o banco não precisa saber da diferença.
  const nome = limpa(v.legal_name)
  if (!nome)            return { error: ehPF ? "Informe o nome completo." : "Informe a razão social." }
  if (nome.length < 2)  return { error: "Nome muito curto." }
  if (nome.length > 160) return { error: "Nome muito longo." }

  // 5 · Contato de cobrança.
  const email = limpa(v.billing_email).toLowerCase()
  if (email && !EMAIL_RE.test(email)) return { error: "E-mail de faturamento inválido." }
  v.billing_email = email || null

  // 🔴 Telefone: a régua era só de COMPRIMENTO (10 a 13 dígitos) e por isso deixava passar
  //    `11999999999` — que o gateway recusa com *"Celular informado é inválido"*, já com o
  //    cartão digitado (medido 05/08). Agora vale a mesma função do resto do sistema.
  // ⚠️ Tira o `55` do país antes de validar: quem cola o número do WhatsApp manda 13
  //    dígitos, e recusar isso seria recusar o formato mais comum de colar um telefone.
  let tel = digits(v.phone)
  if ((tel.length === 12 || tel.length === 13) && tel.startsWith("55")) tel = tel.slice(2)
  if (tel && !isValidPhoneBR(tel)) return { error: "Telefone inválido — informe com DDD (ex: 11 98888-7777)." }
  v.phone = tel || null

  // 6 · Endereço. O CEP é guardado em dígitos pelo mesmo motivo do documento.
  const cep = digits(v.zip)
  if (cep && cep.length !== 8) return { error: "CEP inválido — precisa ter 8 dígitos." }
  v.zip = cep || null

  const uf = limpa(v.state).toUpperCase()
  if (uf && uf.length !== 2) return { error: "UF inválida — use a sigla de 2 letras (ex: SP)." }
  v.state = uf || null

  // ⚠️ PF não tem inscrição estadual/municipal. Zerar em vez de recusar: a pessoa pode
  //    ter preenchido como PJ e trocado o tipo depois — recusar seria pedir pra ela
  //    apagar um campo que a tela nem mostra mais.
  if (ehPF) {
    v.state_registration     = null
    v.municipal_registration = null
    v.trade_name             = null
  }

  // 7 · O que a COBRANÇA exige, além do acima. Mesma régua de `getTitularParaCobranca`
  //     (`nome && email && cpfCnpj && cep && numero && telefone`) — as duas precisam
  //     concordar, senão a tela deixa salvar e o gate barra depois, que é a pior
  //     combinação possível.
  //
  // 🔴 E foi EXATAMENTE isso que aconteceu com o telefone (05/08): ele era obrigatório no
  //    gateway, não estava em nenhuma das duas listas, e a divergência só aparecia na
  //    recusa da cobrança. O aviso acima estava escrito aqui desde o começo — e o campo
  //    novo entrou sem ser confrontado com ele.
  const numero = limpa(v.number)
  // 🔑 Mesma fonte das telas (`podeCobrar`), alimentada com os valores JÁ normalizados —
  //    senão o cadastro poderia dizer "completo" e a tela de assinatura discordar.
  const completo = podeCobrar({
    legal_name: nome, tax_id: doc, billing_email: email, zip: cep, number: numero, phone: tel,
  })

  if (opts.exigirCobranca) {
    if (!email)  return { error: "Informe o e-mail de faturamento." }
    if (!cep)    return { error: "Informe o CEP." }
    if (!numero) return { error: "Informe o número do endereço (use 'S/N' se não houver)." }
    if (!tel)    return { error: "Informe um telefone com DDD — o banco emissor exige para confirmar a compra." }
  }

  return { valores: v, completo }
}
