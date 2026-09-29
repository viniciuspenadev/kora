// ═══════════════════════════════════════════════════════════════
// Formatação PT-BR das telas de assinatura
// ═══════════════════════════════════════════════════════════════
// DECISÃO: dinheiro nunca é abreviado ("R$ 1,2k" numa fatura é desrespeito) e
// data de cobrança tem DUAS formas — a longa ("6 de setembro") pra frase que o
// cliente lê uma vez, e a curta ("06/09") pra tabela que ele varre. Misturar as
// duas na mesma superfície é o que faz painel financeiro parecer amador.

/** `R$ 1.234,56` — sempre com centavos. Recebe CENTAVOS. */
export const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 })

/** Número com separador de milhar PT-BR. */
export const num = (n: number) => n.toLocaleString("pt-BR")

/**
 * Parser à prova de fuso: "2026-09-06" vira 6/set LOCAL, não 5/set.
 * `new Date("2026-09-06")` é UTC-meia-noite — em BRT volta um dia. Já mordeu
 * este projeto antes; a data de vencimento é o pior lugar pra errar em 1 dia.
 */
export function parseData(iso: string): Date {
  const [datePart] = iso.split("T")
  const [y, m, d] = datePart.split("-").map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
]

/** "6 de setembro" — a data da FRASE. */
export const dataLonga = (iso: string) => {
  const d = parseData(iso)
  return `${d.getDate()} de ${MESES[d.getMonth()]}`
}

/** "06/09" — a data da TABELA. */
export const dataCurta = (iso: string) => {
  const d = parseData(iso)
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`
}

/** "06/09/2026" — recibo, comprovante, período de fatura. */
export const dataCheia = (iso: string) => {
  const d = parseData(iso)
  return `${dataCurta(iso)}/${d.getFullYear()}`
}

/** "Setembro" capitalizado — nome do mês de referência. */
export const mesDe = (iso: string) => {
  const m = MESES[parseData(iso).getMonth()]
  return m.charAt(0).toUpperCase() + m.slice(1)
}

/** Dias inteiros de hoje até a data (negativo = já passou). */
export function diasAte(iso: string, hoje = new Date()): number {
  const alvo = parseData(iso)
  const base = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
  return Math.round((alvo.getTime() - base.getTime()) / 86_400_000)
}

/** "3 dias" / "1 dia" — pra frases de prazo. */
export const plural = (n: number, sing: string, plur = `${sing}s`) =>
  `${num(n)} ${n === 1 ? sing : plur}`
