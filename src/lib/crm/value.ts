// ─────────────────────────────────────────────────────────────────
// Valor do negócio COMPOSTO por itens (docs/crm-vision-capture.md).
// Lib PURA e compartilhada (server recomputa o cache; client faz preview).
//
// Semântica de cobrança:
//   one_time → entra 1× no total.
//   monthly  → mensalidade; total soma mensalidade × prazo (term_months).
//   yearly   → anuidade;    total soma anuidade × (prazo/12).
// Prazo NULL = contrato sem prazo definido → assume 12 meses no TOTAL
// (DEFAULT_TERM_MONTHS). MRR normaliza o anual (/12).
// Desconto é POR LINHA, abatido do subtotal (unit × qty − discount, piso 0).
// ─────────────────────────────────────────────────────────────────

export const DEFAULT_TERM_MONTHS = 12

export interface DealItemLike {
  billing:     "one_time" | "monthly" | "yearly"
  unit_price:  number
  quantity:    number
  discount:    number
  term_months: number | null
}

export interface DealValueSummary {
  /** Σ das linhas avulsas. */
  oneTime: number
  /** Σ das mensalidades (sem prazo aplicado). */
  monthly: number
  /** Σ das anuidades (sem prazo aplicado). */
  yearly:  number
  /** Receita recorrente mensal: mensal + anual/12. */
  mrr:     number
  /** Valor do negócio: avulso + mensal×prazo + anual×(prazo/12). */
  total:   number
}

const round2 = (v: number) => Math.round(v * 100) / 100

/** Subtotal de uma linha (unit × qty − desconto, nunca negativo). */
export function lineSubtotal(it: DealItemLike): number {
  return round2(Math.max(0, it.unit_price * it.quantity - it.discount))
}

export function computeDealValue(items: DealItemLike[]): DealValueSummary {
  let oneTime = 0, monthly = 0, yearly = 0, total = 0
  for (const it of items) {
    const line = lineSubtotal(it)
    const term = it.term_months ?? DEFAULT_TERM_MONTHS
    if (it.billing === "one_time")     { oneTime += line; total += line }
    else if (it.billing === "monthly") { monthly += line; total += line * term }
    else                               { yearly  += line; total += line * (term / 12) }
  }
  return { oneTime: round2(oneTime), monthly: round2(monthly), yearly: round2(yearly), mrr: round2(monthly + yearly / 12), total: round2(total) }
}
