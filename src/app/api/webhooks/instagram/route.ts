import { NextResponse, after, type NextRequest } from "next/server"
import crypto from "crypto"
import { processInstagramWebhook } from "@/lib/channels/instagram-inbound"

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

  if (mode === "subscribe" && token && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 })
  }
  return new NextResponse("Forbidden", { status: 403 })
}

export async function POST(req: NextRequest) {
  const raw = await req.text()

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
