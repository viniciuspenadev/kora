// Kora Formulários — identidade do formulário (pura, testável).
//   • public_id: o que o código colado no site e o link carregam. Aleatório, 20 caracteres
//     [a-z0-9] (~103 bits), sorteio sem viés (rejeição). Permanente (o banco recusa trocar).
//   • slug: o pedaço legível do link próprio (/f/<empresa>/<slug>). Único por empresa.

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"

export function newPublicId(): string {
  let out = ""
  const buf = new Uint8Array(64)
  while (out.length < 20) {
    crypto.getRandomValues(buf)
    for (const b of buf) {
      // 252 = 7 × 36: descartar 252..255 tira o viés do módulo.
      if (b < 252) out += ALPHABET[b % 36]
      if (out.length === 20) break
    }
  }
  return out
}

/** "Orçamento de Sacada!" → "orcamento-de-sacada" (≤60). Vazio → "formulario". */
export function formSlugFrom(name: string): string {
  const s = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "")
  return s || "formulario"
}

/** `base`, `base-2`, `base-3`… sem colidir com `taken` (≤60). */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let n = 2; n < 10_000; n++) {
    const suffix = `-${n}`
    const candidate = base.slice(0, 60 - suffix.length).replace(/-+$/g, "") + suffix
    if (!used.has(candidate)) return candidate
  }
  return `${base.slice(0, 40)}-${newPublicId().slice(0, 8)}`
}

/** "Orçamento guiado", "Orçamento guiado 2"… sem repetir nome na lista da empresa. */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.trim().toLocaleLowerCase("pt-BR")))
  const clean = base.trim().slice(0, 120) || "Novo formulário"
  if (!used.has(clean.toLocaleLowerCase("pt-BR"))) return clean
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${clean.slice(0, 120 - String(n).length - 1)} ${n}`
    if (!used.has(candidate.toLocaleLowerCase("pt-BR"))) return candidate
  }
  return clean
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v)

/** Nome visível: 1..120 e ao menos um caractere que não seja espaço (espelha o CHECK). */
export function cleanFormName(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const name = raw.replace(/\s+/g, " ").trim()
  return name && name.length <= 120 ? name : null
}
