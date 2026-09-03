import { computeDealValue, DEFAULT_TERM_MONTHS } from "./value"

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
