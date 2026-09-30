// ═══════════════════════════════════════════════════════════════
// RichDoc — modelo de TEXTO RICO portável da cotação (não HTML)
// ═══════════════════════════════════════════════════════════════
// Doc: docs/crm-quote-composer-design.md §3. Uma estrutura que o EDITOR, o
// PDF (richdoc-pdf.tsx) e o HASH (snapshotHash) entendem igual. Conjunto
// CURADO e FECHADO (fail-closed no parse: bloco/marca desconhecida é descartada
// — nunca lança). Sem tabelas-no-texto, imagens ou fontes custom (mapeia limpo
// pro react-pdf e mantém o PDF confiável).

export interface RichDoc { v: 1; blocks: Block[] }

export type Block =
  | { t: "p";  runs: Run[] }        // parágrafo
  | { t: "h";  runs: Run[] }        // título (1 nível)
  | { t: "ul"; items: Run[][] }     // lista com marcador
  | { t: "ol"; items: Run[][] }     // lista numerada
  | { t: "hr" }                     // divisória

export interface Run {
  text: string
  b?:    true      // negrito
  i?:    true      // itálico
  u?:    true      // sublinhado
  link?: string    // href (só http/https — validado)
  /** SÓ no rascunho: token de variável (ex "cliente.nome"). Ao GERAR, resolve
   *  pro valor real e vira `text` puro (imutabilidade do snapshot) — F2. */
  var?:  string
}

export const EMPTY_RICHDOC: RichDoc = { v: 1, blocks: [] }

// ── Type guard ─────────────────────────────────────────────────
export function isRichDoc(v: unknown): v is RichDoc {
  return !!v && typeof v === "object" && (v as { v?: unknown }).v === 1 && Array.isArray((v as { blocks?: unknown }).blocks)
}

// ── Parse FAIL-CLOSED (aceita lixo, devolve RichDoc limpo) ──────
const SAFE_LINK = /^https?:\/\//i

function cleanRun(raw: unknown): Run | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const text = typeof r.text === "string" ? r.text : ""
  const out: Run = { text }
  if (r.b === true) out.b = true
  if (r.i === true) out.i = true
  if (r.u === true) out.u = true
  if (typeof r.link === "string" && SAFE_LINK.test(r.link)) out.link = r.link
  if (typeof r.var === "string" && r.var.trim()) out.var = r.var.trim()
  return out
}

function cleanRuns(raw: unknown): Run[] {
  return Array.isArray(raw) ? raw.map(cleanRun).filter((x): x is Run => x !== null) : []
}

function cleanBlock(raw: unknown): Block | null {
  if (!raw || typeof raw !== "object") return null
  const b = raw as Record<string, unknown>
  switch (b.t) {
    case "p":  return { t: "p",  runs: cleanRuns(b.runs) }
    case "h":  return { t: "h",  runs: cleanRuns(b.runs) }
    case "ul": return { t: "ul", items: Array.isArray(b.items) ? b.items.map(cleanRuns) : [] }
    case "ol": return { t: "ol", items: Array.isArray(b.items) ? b.items.map(cleanRuns) : [] }
    case "hr": return { t: "hr" }
    default:   return null   // bloco desconhecido → descartado (fail-closed)
  }
}

/** Normaliza qualquer entrada num RichDoc válido. Lixo/undefined → doc vazio. */
export function normalizeRichDoc(input: unknown): RichDoc {
  if (!isRichDoc(input)) return { v: 1, blocks: [] }
  return { v: 1, blocks: input.blocks.map(cleanBlock).filter((x): x is Block => x !== null) }
}

// ── Interop com texto puro (legado + campos plain) ─────────────
/** String legada / valor inicial → RichDoc (parágrafos por quebra de linha). */
export function plainToRichDoc(s: string | null | undefined): RichDoc {
  const text = (s ?? "").trim()
  if (!text) return { v: 1, blocks: [] }
  const blocks: Block[] = text.split(/\n{2,}|\n/).map((line) => ({ t: "p", runs: [{ text: line }] }))
  return { v: 1, blocks }
}

/** Aceita RichDoc OU string legada → sempre RichDoc (leitura de snapshot). */
export function toRichDoc(v: RichDoc | string | null | undefined): RichDoc {
  if (isRichDoc(v)) return v
  if (typeof v === "string") return plainToRichDoc(v)
  return { v: 1, blocks: [] }
}

/** Achata pra texto puro (busca, contextos sem formatação). */
export function richDocToPlain(doc: RichDoc): string {
  const runsText = (runs: Run[]) => runs.map((r) => r.text).join("")
  return doc.blocks.map((b) => {
    if (b.t === "hr") return "—"
    if (b.t === "ul" || b.t === "ol") return b.items.map((it) => `• ${runsText(it)}`).join("\n")
    return runsText(b.runs)
  }).join("\n").trim()
}

export function isEmptyRichDoc(doc: RichDoc | null | undefined): boolean {
  if (!doc || !doc.blocks.length) return true
  return richDocToPlain(doc).trim() === ""
}
