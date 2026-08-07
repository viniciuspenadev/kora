import { NextResponse, after, type NextRequest } from "next/server"
import crypto from "crypto"
import { processInstagramWebhook } from "@/lib/channels/instagram-inbound"
import { readWebhookBody } from "@/lib/webhooks/read-capped"

/**
 * Webhook do Instagram Direct (app Kora-IG, ISOLADO do webhook do WhatsApp/Meta).
 *   GET  → verify challenge (Meta valida a URL de callback).
 *   POST → eventos (DM/comentários); valida assinatura e processa em after().
 * Doc: docs/instagram-direct-design.md. Env: INSTAGRAM_VERIFY_TOKEN, INSTAGRAM_APP_SECRET.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const mode      = sp.get("hub.mode")
  const token     = sp.get("hub.verify_token")
  const challenge = sp.get("hub.challenge")

  // ⚠️ Comparação de tempo CONSTANTE, igual à da assinatura no POST. Era `===`, que sai
  //    no primeiro byte diferente e, em tese, deixa o token ser descoberto caractere a
  //    caractere. Risco baixo (endpoint só usado na configuração, segredo de pouco valor),
  //    mas era a única linha do arquivo fora do padrão. Auditoria 2026-08-07.
  // ⚠️ Compara o tamanho dos BUFFERS, não das strings: caractere multi-byte tem 1 de
  //    comprimento e 2+ bytes, e `timingSafeEqual` LANÇA com tamanhos diferentes — o que
  //    viraria erro 500 no lugar do 403, quebrando a verificação da URL na Meta.
  const a = Buffer.from(token ?? "")
  const b = Buffer.from(process.env.INSTAGRAM_VERIFY_TOKEN ?? "")
  const match = b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b)
  if (mode === "subscribe" && match) {
    return new NextResponse(challenge ?? "", { status: 200 })
  }
  return new NextResponse("Forbidden", { status: 403 })
}

export async function POST(req: NextRequest) {
  // H-01: body com teto de bytes ANTES de processar (heap-DoS).
  const read = await readWebhookBody(req)
  if ("reject" in read) return read.reject
  const raw = read.raw

  // Assinatura — FAIL-CLOSED: sem app secret, recusa (não processa sem verificar).
  const secret = process.env.INSTAGRAM_APP_SECRET
  if (!secret) return new NextResponse("Webhook not configured", { status: 503 })
  const sig = req.headers.get("x-hub-signature-256") ?? ""
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex")
  const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  if (!ok) return new NextResponse("Invalid signature", { status: 401 })

  let body: unknown
  try { body = JSON.parse(raw) } catch { return new NextResponse("Bad JSON", { status: 400 }) }

  // Ack rápido (Meta exige 200 em poucos segundos) + processa fora do request.
  after(() => processInstagramWebhook(body).catch((e) => console.error("[ig-webhook] process:", e)))
  return NextResponse.json({ received: true })
}
