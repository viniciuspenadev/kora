// ═══════════════════════════════════════════════════════════════
// Vocabulário da cobrança — onde o fato financeiro vira TEXTO
// ═══════════════════════════════════════════════════════════════
// DECISÃO DE UX: cinco superfícies falam do MESMO fato (faixa do topo, ação travada,
// cartão de campanha, sino, toast de volta). A única forma de o tom não derrapar entre
// elas — "fatura em aberto" numa, "pagamento pendente" noutra, "você não pagou" na
// terceira — é nenhuma delas escrever a frase sozinha. Copy de cobrança é contrato, não
// literatura de componente.
//
// 🔑 A REGRA QUE ESTE ARQUIVO CARREGA: o sujeito da frase é sempre **o documento**,
//    nunca a pessoa. Por isso `assuntoDaFatura()` devolve "A fatura de agosto" e não
//    existe nenhuma função que produza um sujeito na 2ª pessoa. Não dá pra escrever
//    "você está devendo" com estas peças — e é de propósito.

import type { BillingStanding } from "./standing-contract"

/** Destino do "Pagar agora". TODO(orquestrador): apontar pra rota real das telas do cliente. */
// ✅ JUNÇÃO (2026-08-03): apontava pra `/configuracoes/faturamento`, rota que não existe.
//    A tela real ficou em `/configuracoes/assinatura` — dois agentes em paralelo batizaram
//    a mesma coisa de dois jeitos. Constante única de propósito: se a rota mudar de novo,
//    muda aqui e os seis componentes acompanham.
export const BILLING_HREF = "/configuracoes/assinatura"

/** Rótulo ÚNICO do CTA. Constante, não prop — ver `pay-now.tsx`. */
export const PAY_LABEL = "Pagar agora"

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
]

/**
 * `new Date("2026-08-12")` é meia-noite UTC — no Brasil isso volta 11/08 e a fatura
 * "vence um dia antes". Data-só-dia é lida campo a campo, no fuso de quem olha.
 */
function parseDataLocal(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "agosto" — o mês que NOMEIA a fatura. */
export function mesPorExtenso(iso: string | null | undefined): string | null {
  const d = parseDataLocal(iso)
  return d ? MESES[d.getMonth()] : null
}

/** "12/08" — data curta, pra linha de apoio. */
export function diaMes(iso: string | null | undefined): string | null {
  const d = parseDataLocal(iso)
  if (!d) return null
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`
}

/** Centavos → "R$ 249,00". Valor é dado, não enfeite: sempre com `tabular-nums` na UI. */
export function brlDeCentavos(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

/** ["a","b","c"] → "a, b e c". Lista humana, não bullet point. */
export function listarPt(itens: string[]): string {
  const l = itens.filter(Boolean)
  if (l.length === 0) return ""
  if (l.length === 1) return l[0]
  return `${l.slice(0, -1).join(", ")} e ${l[l.length - 1]}`
}

/**
 * O SUJEITO da frase — "A fatura de agosto". Sem mês conhecido, "A fatura".
 * Nunca "seu pagamento", nunca "sua pendência": o pronome possessivo transforma um
 * documento em característica da pessoa, e é aí que a cobrança começa a soar acusatória.
 */
export function assuntoDaFatura(invoice: BillingStanding["invoice"]): string {
  const mes = mesPorExtenso(invoice?.dueDate)
  return mes ? `A fatura de ${mes}` : "A fatura"
}

/**
 * Linha de apoio factual: valor · vencimento · próximo fechamento.
 * Só fatos verificáveis — nenhuma consequência, nenhum prazo ameaçador. A consequência
 * mora nas listas de "pausado / continua", que são descritivas por natureza.
 */
export function linhaDoDocumento(
  invoice: BillingStanding["invoice"],
  nextClosingAt?: string | null,
): string {
  const partes: string[] = []
  if (invoice) {
    partes.push(brlDeCentavos(invoice.totalCents))
    const venc = diaMes(invoice.dueDate)
    if (venc) partes.push(invoice.daysOverdue > 0 ? `venceu em ${venc}` : `vence em ${venc}`)
  }
  const fecha = diaMes(nextClosingAt)
  if (fecha) partes.push(`próximo fechamento em ${fecha}`)
  return partes.join(" · ")
}

/** "há 9 dias" — usado só onde o tempo em aberto é o que mudou de degrau. */
export function tempoEmAberto(invoice: BillingStanding["invoice"]): string | null {
  if (!invoice || invoice.daysOverdue <= 0) return null
  return invoice.daysOverdue === 1 ? "há 1 dia" : `há ${invoice.daysOverdue} dias`
}
