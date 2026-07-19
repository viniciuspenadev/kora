// ═══════════════════════════════════════════════════════════════
// Preços de IA — TABELA ÚNICA da plataforma (USD por 1M tokens)
// ═══════════════════════════════════════════════════════════════
// Fonte única de preço pra TODO cálculo de custo (v1, v2, transcrição).
// Atualizar AQUI quando a OpenAI mudar tabela ou entrarmos em modelo novo.
// Valores da tabela pública da OpenAI (conferidos 2026-07). Modelo fora da
// tabela → custo null (aparece como "não precificado", nunca 0 silencioso).

/** Chat/completions — USD por 1M tokens (in/out). */
export const MODEL_PRICES: Record<string, { in: number; out: number }> = {
  "gpt-4.1":      { in: 2.00, out: 8.00 },
  "gpt-4.1-mini": { in: 0.40, out: 1.60 },
  "gpt-4.1-nano": { in: 0.10, out: 0.40 },
  "gpt-4o":       { in: 2.50, out: 10.00 },
  "gpt-4o-mini":  { in: 0.15, out: 0.60 },
  "text-embedding-3-small": { in: 0.02, out: 0 },
}

/** Transcrição — USD por 1M tokens (áudio na entrada, texto na saída). */
export const TRANSCRIBE_PRICES: Record<string, { audioIn: number; out: number }> = {
  "gpt-4o-mini-transcribe": { audioIn: 3.00, out: 5.00 },
  "gpt-4o-transcribe":      { audioIn: 6.00, out: 10.00 },
}

export function costOfTokens(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = MODEL_PRICES[model]
  if (!p) return null
  return (inputTokens / 1_000_000) * p.in + (outputTokens / 1_000_000) * p.out
}

export function costOfTranscription(model: string, audioTokens: number, outputTokens: number): number | null {
  const p = TRANSCRIBE_PRICES[model]
  if (!p) return null
  return (audioTokens / 1_000_000) * p.audioIn + (outputTokens / 1_000_000) * p.out
}
