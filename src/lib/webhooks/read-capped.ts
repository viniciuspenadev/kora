import "server-only"
import { NextResponse, type NextRequest } from "next/server"

/**
 * Lê o body de um webhook com TETO de bytes (H-01, DoS — auditoria 2026-07-30).
 *
 * Sem isto, um atacante POSTa um corpo gigante (até o `bodySizeLimit` global de 100MB) e
 * ele é materializado no heap ANTES da verificação de assinatura — CPU/memória gastos pra
 * um evento que vai ser rejeitado. Rejeita por `Content-Length` (rápido) E por leitura com
 * cap via stream (cobre `Transfer-Encoding: chunked` sem Content-Length, que burlaria o header).
 *
 * Eventos de webhook (Meta/IG/Resend) são JSON KB-scale → 2MB é ~100x de folga (sem risco
 * de 413 falso em batch legítimo), e ainda barra o DoS de 100MB decisivamente. Retorna a
 * `raw` (string utf8, idêntica ao `req.text()` → a assinatura HMAC continua batendo) OU 413.
 */
export async function readWebhookBody(
  req: NextRequest,
  maxBytes = 2_097_152,
): Promise<{ raw: string } | { reject: NextResponse }> {
  const tooBig = () => ({ reject: new NextResponse("Payload too large", { status: 413 }) })

  const cl = Number(req.headers.get("content-length") ?? "")
  if (Number.isFinite(cl) && cl > maxBytes) return tooBig()

  // Sem stream (edge cases) → text() + checagem pós-leitura por BYTES (não chars UTF-16).
  if (!req.body) {
    const raw = await req.text()
    return Buffer.byteLength(raw, "utf8") > maxBytes ? tooBig() : { raw }
  }

  // Stream com contador de bytes: aborta assim que passar do teto.
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        return tooBig()
      }
      chunks.push(value)
    }
  } finally {
    try { reader.releaseLock() } catch { /* já liberado */ }
  }
  return { raw: Buffer.concat(chunks).toString("utf8") }
}
