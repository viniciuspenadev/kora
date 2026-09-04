// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — embeddings (OpenAI text-embedding-3-small)
// ═══════════════════════════════════════════════════════════════
// 1536 dims = coluna vector(1536) do schema. Cliente próprio (fino) pra
// não acoplar ao wrapper de chat. Barato (~$0.02/1M tokens).

import "server-only"
import OpenAI from "openai"

export const EMBED_MODEL = "text-embedding-3-small"
export const EMBED_DIM   = 1536

let _client: OpenAI | null = null
function client(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error("OPENAI_API_KEY ausente")
    _client = new OpenAI({ apiKey })
  }
  return _client
}

const cap = (t: string) => t.slice(0, 8000)

/** Embedding de um texto. Lança em erro de API (caller captura). */
export async function embedText(text: string): Promise<number[]> {
  const r = await client().embeddings.create({ model: EMBED_MODEL, input: cap(text) })
  return r.data[0].embedding
}

/** Embeddings em lote (1 chamada). Mantém a ordem da entrada. */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const r = await client().embeddings.create({ model: EMBED_MODEL, input: texts.map(cap) })
  return r.data.map((d) => d.embedding)
}
