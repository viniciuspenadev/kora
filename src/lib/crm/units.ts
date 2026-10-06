// ─────────────────────────────────────────────────────────────────
// Unidades de medida do catálogo — SPEC de formato (fonte única).
// A unidade não é só rótulo: carrega casas decimais + símbolo + se é inteiro.
// A digitação da quantidade se molda à unidade (vírgula BR, casas, sufixo).
// Lib PURA (server e client). Doc: docs/catalog-uom-inventory-design.md §2.1.
// ─────────────────────────────────────────────────────────────────

export interface UnitSpec {
  code:        string   // valor gravado em catalog_items.unit
  label:       string   // nome no seletor ("Quilograma")
  symbol:      string   // sufixo exibido na digitação/preço ("kg")
  decimals:    number   // casas decimais permitidas
  integerOnly: boolean  // contáveis (un, cx, dúzia…) — sem decimais
}

// Lista CURADA e fechada (o tenant escolhe, não inventa — evita bagunça).
export const UNITS: UnitSpec[] = [
  { code: "un",  label: "Unidade",        symbol: "un", decimals: 0, integerOnly: true  },
  { code: "pc",  label: "Peça",           symbol: "pç", decimals: 0, integerOnly: true  },
  { code: "cx",  label: "Caixa",          symbol: "cx", decimals: 0, integerOnly: true  },
  { code: "pct", label: "Pacote",         symbol: "pct",decimals: 0, integerOnly: true  },
  { code: "dz",  label: "Dúzia",          symbol: "dz", decimals: 0, integerOnly: true  },
  { code: "par", label: "Par",            symbol: "par",decimals: 0, integerOnly: true  },
  { code: "kg",  label: "Quilograma",     symbol: "kg", decimals: 3, integerOnly: false },
  { code: "g",   label: "Grama",          symbol: "g",  decimals: 0, integerOnly: false },
  { code: "t",   label: "Tonelada",       symbol: "t",  decimals: 3, integerOnly: false },
  { code: "l",   label: "Litro",          symbol: "L",  decimals: 3, integerOnly: false },
  { code: "ml",  label: "Mililitro",      symbol: "mL", decimals: 0, integerOnly: false },
  { code: "m",   label: "Metro",          symbol: "m",  decimals: 2, integerOnly: false },
  { code: "cm",  label: "Centímetro",     symbol: "cm", decimals: 1, integerOnly: false },
  { code: "m2",  label: "Metro quadrado", symbol: "m²", decimals: 2, integerOnly: false },
  { code: "m3",  label: "Metro cúbico",   symbol: "m³", decimals: 3, integerOnly: false },
]

export const DEFAULT_UNIT = "un"

const BY_CODE = new Map(UNITS.map((u) => [u.code, u]))

/** Spec da unidade (fallback pra 'un' se código desconhecido/nulo). */
export function unitSpec(code: string | null | undefined): UnitSpec {
  return BY_CODE.get(code ?? DEFAULT_UNIT) ?? BY_CODE.get(DEFAULT_UNIT)!
}

/** Quantidade no padrão BR conforme a unidade. Ex: (2.35,'kg') → "2,350". */
export function formatQuantity(qty: number, code?: string | null): string {
  const u = unitSpec(code)
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: u.integerOnly ? 0 : u.decimals,
    maximumFractionDigits: u.decimals,
  }).format(qty)
}

/** Com o símbolo: "2,350 kg" · "3 un". */
export function formatQuantityWithUnit(qty: number, code?: string | null): string {
  return `${formatQuantity(qty, code)} ${unitSpec(code).symbol}`
}

/** Preço por unidade: "R$ 99,90/kg". */
export function formatUnitPrice(price: number, code?: string | null): string {
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(price)
  return `${brl}/${unitSpec(code).symbol}`
}

/** String BR digitada → número, arredondado pela spec (ponto=milhar, vírgula=decimal). */
export function parseQuantity(input: string, code?: string | null): number {
  const u = unitSpec(code)
  const n = Number(String(input).replace(/\./g, "").replace(",", ".").replace(/[^0-9.]/g, ""))
  if (!Number.isFinite(n)) return 0
  if (u.integerOnly) return Math.round(n)
  const f = 10 ** u.decimals
  return Math.round(n * f) / f
}
