/**
 * Parser de variáveis de template do WhatsApp — fonte única usada pelo builder,
 * pela action de criação, pelo envio e pelo composer do inbox.
 *
 * A Meta suporta DOIS tipos (nunca misturados num mesmo template):
 *   - posicional: {{1}}, {{2}} … (sequencial)
 *   - nomeado:    {{nome}}, {{numero_pedido}} … (auto-documentado)
 * O tipo é detectado pelo formato: qualquer variável não-numérica → nomeado.
 */

export interface TemplateVar {
  key:   string   // "1" (posicional) ou "nome" (nomeado)
  named: boolean
}

const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

/** Extrai as variáveis em ordem de aparição, deduplicadas. */
export function parseVars(text: string): TemplateVar[] {
  const seen = new Set<string>()
  const out: TemplateVar[] = []
  for (const m of text.matchAll(VAR_RE)) {
    const key = m[1]
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key, named: !/^\d+$/.test(key) })
  }
  return out
}

/** True se o texto usa variáveis nomeadas (qualquer {{x}} não-numérico). */
export function isNamed(text: string): boolean {
  return parseVars(text).some((v) => v.named)
}

/**
 * Heurística pro pré-preenchimento: a variável que representa o NOME do cliente
 * (pra o composer auto-preencher com o 1º nome). Cobre nomeadas (nome/first_name/…)
 * e o posicional {{1}} (convenção). Retorna a `key` ou null.
 */
const NAME_KEYS = new Set(["nome", "name", "first_name", "primeiro_nome", "firstname", "cliente", "customer_name"])
export function nameVarKey(vars: TemplateVar[]): string | null {
  const named = vars.find((v) => v.named && NAME_KEYS.has(v.key.toLowerCase()))
  if (named) return named.key
  // posicional: convenção {{1}} = nome
  const first = vars.find((v) => !v.named && v.key === "1")
  return first ? first.key : null
}
