import { computeDealValue, DEFAULT_TERM_MONTHS } from "./value"

/** Limite do nome de um item avulso (o servidor confere o mesmo — lib/crm/deal-lines). */
export const MANUAL_NAME_MAX = 200

/** Teto dos detalhes do item — o banco confere o mesmo (CHECK tenant_deal_items_details_len). */
export const DEAL_ITEM_DETAILS_MAX = 1000

/**
 * Detalhes do item (medidas, cor, material…) — VISÍVEIS AO CLIENTE: saem no orçamento, abaixo
 * do nome. Quebras de linha padronizadas, sem caracteres de controle, sem espaço sobrando no fim
 * das linhas, no máximo uma linha em branco seguida; vazio vira `null` (o banco recusa texto vazio).
 */
export function normalizeItemDetails(value: unknown): { details: string | null } | { error: string } {
  if (value == null) return { details: null }
  if (typeof value !== "string") return { error: "Detalhes do item inválidos" }
  const visible = Array.from(value.replace(/\r\n?/g, "\n"))
    .filter((ch) => { const c = ch.codePointAt(0) ?? 0; return c === 9 || c === 10 || (c >= 32 && c !== 127) })
    .join("")
  const text = visible.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim()
  if (!text) return { details: null }
  if (text.length > DEAL_ITEM_DETAILS_MAX) return { error: `Detalhes do item muito longos (máximo ${DEAL_ITEM_DETAILS_MAX} caracteres).` }
  return { details: text }
}

/** Primeira etapa de "Adicionar item": a escolha só aparece quando há duas opções de verdade;
 *  com uma só, vai direto a ela (escolher entre uma ativa e uma apagada é um clique a mais). */
export type ItemStartStep = "choose" | "catalog" | "manual" | "none"
export function itemStartStep(input: { hasCatalog: boolean; manualAllowed: boolean }): ItemStartStep {
  if (input.hasCatalog && input.manualAllowed) return "choose"
  if (input.hasCatalog) return "catalog"
  if (input.manualAllowed) return "manual"
  return "none"
}

export function parseItemMoney(value: string): number | null {
  const text = value.trim()
  if (!text) return null
  // BR thousands (1.500) and decimal comma; decimal dot remains accepted (15.50).
  const normalized = text.includes(",") || /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replace(/\./g, "").replace(",", ".") : text
  const result = Number(normalized)
  return Number.isFinite(result) && result >= 0 ? Math.round(result * 100) / 100 : null
}

export function reviewDealItem(input: {
  billing: "one_time" | "monthly" | "yearly"; listPrice: number; maxPct: number;
  price: string; quantity: string; discount: string; discountMode: "brl" | "pct"; term: string;
}) {
  const quantity = Number(input.quantity.replace(",", "."))
  const unitPrice = input.price.trim() ? parseItemMoney(input.price) : input.listPrice
  const rawDiscount = input.discount.trim() ? parseItemMoney(input.discount) : 0
  const termMonths = input.billing === "one_time" || !input.term.trim() ? null : Number(input.term)
  const subtotal = unitPrice == null ? 0 : unitPrice * quantity
  const discount = rawDiscount == null ? null : input.discountMode === "pct" ? Math.round(subtotal * rawDiscount) / 100 : rawDiscount
  const minimum = input.listPrice * quantity * (1 - input.maxPct / 100)
  let error: string | null = null
  if (!Number.isFinite(quantity) || quantity <= 0) error = "Informe uma quantidade maior que zero."
  else if (unitPrice == null) error = "Informe um preço válido, como 1.500,00."
  else if (discount == null || (input.discountMode === "pct" && rawDiscount! > 100)) error = "Informe um desconto válido entre zero e o limite permitido."
  else if (termMonths != null && (!Number.isInteger(termMonths) || termMonths <= 0)) error = "Informe um prazo inteiro maior que zero."
  else if (subtotal - discount < minimum - 0.01) error = input.maxPct > 0
    ? `Preço e desconto combinados ultrapassam o limite de ${input.maxPct}% sobre a tabela.`
    : "Este item não permite reduzir o preço da tabela."
  const summary = !error ? computeDealValue([{ billing: input.billing, unit_price: unitPrice!, quantity, discount: discount!, term_months: termMonths }]) : null
  return { quantity, unitPrice, discount, termMonths, subtotal, minimum, error, summary, periodTotal: summary ? Math.round((subtotal - discount!) * 100) / 100 : null, effectiveTerm: termMonths ?? DEFAULT_TERM_MONTHS }
}

/** Item avulso: nome e preço obrigatórios; sem desconto nem piso (o preço digitado é o final). */
export function reviewManualItem(input: { name: string; billing: "one_time" | "monthly" | "yearly"; price: string; quantity: string; term: string }) {
  const base = reviewDealItem({ billing: input.billing, listPrice: 0, maxPct: 0, price: input.price, quantity: input.quantity, discount: "", discountMode: "brl", term: input.term })
  const name = input.name.trim()
  const error = !name ? "Dê um nome ao item."
    : name.length > MANUAL_NAME_MAX ? `Nome muito longo (máximo ${MANUAL_NAME_MAX} caracteres).`
      : !input.price.trim() ? "Informe o preço do item."
        : base.error
  return { ...base, name, error, summary: error ? null : base.summary, periodTotal: error ? null : base.periodTotal }
}
