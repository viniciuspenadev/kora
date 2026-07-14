// ─────────────────────────────────────────────────────────────────
// Dinheiro no cliente do Catálogo — helpers PUROS (client-safe).
// NÃO importar de @/lib/commercial/entries: aquele módulo puxa supabaseAdmin
// (server-only). O domínio guarda dinheiro em CENTAVOS (bigint); a UI converte
// só na fronteira de exibição/entrada. Máscara BR (vírgula decimal).
// ─────────────────────────────────────────────────────────────────

/** Centavos → "R$ 1.234,56". */
export function brlFromCents(cents: number | null | undefined): string {
  return (Number(cents ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

/** Centavos → texto de input BR ("1234,56"), vazio quando null. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return ""
  return (Number(cents) / 100).toFixed(2).replace(".", ",")
}

/**
 * Texto digitado (BR: ponto=milhar, vírgula=decimal) → centavos inteiros.
 * Aceita negativo (reajuste em R$). Retorna NaN se inválido.
 */
export function parseMoneyToCents(input: string): number {
  const t = String(input).trim()
  if (t === "" || t === "-") return NaN
  const clean = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t
  const n = Number(clean)
  return Number.isFinite(n) ? Math.round(n * 100) : NaN
}

/** Percentual digitado ("8" / "-5,5") → número. NaN se inválido. */
export function parsePct(input: string): number {
  const n = Number(String(input).trim().replace(",", "."))
  return Number.isFinite(n) ? n : NaN
}
