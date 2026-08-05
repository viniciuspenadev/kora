import "server-only"
import { isValidCpf, isValidCnpj } from "@/lib/masks"

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

  const tel = digits(v.phone)
  if (tel && (tel.length < 10 || tel.length > 13)) return { error: "Telefone inválido (informe com DDD)." }
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
  //     (`nome && email && cpfCnpj && cep && numero`) — as duas precisam concordar, senão
  //     a tela deixa salvar e o gate barra depois, que é a pior combinação possível.
  const numero = limpa(v.number)
  const completo = Boolean(nome && email && doc && cep && numero)

  if (opts.exigirCobranca) {
    if (!email)  return { error: "Informe o e-mail de faturamento." }
    if (!cep)    return { error: "Informe o CEP." }
    if (!numero) return { error: "Informe o número do endereço (use 'S/N' se não houver)." }
  }

  return { valores: v, completo }
}
