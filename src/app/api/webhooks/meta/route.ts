import { NextResponse, after, type NextRequest } from "next/server"
import crypto from "crypto"
import { processMetaWebhook } from "@/lib/channels/meta-inbound"
import { readWebhookBody } from "@/lib/webhooks/read-capped"

/**
 * Webhook do WhatsApp Cloud API (oficial) — ISOLADO do webhook Evolution.
 *   GET  → verify challenge (Meta valida a URL de callback).
 *   POST → eventos (mensagens/status); valida assinatura e processa em after().
 * Doc: docs/whatsapp-cloud-api.md.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const mode      = sp.get("hub.mode")
  const token     = sp.get("hub.verify_token")
  const challenge = sp.get("hub.challenge")

  if (mode === "subscribe" && token && token === process.env.META_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 })
  }
  return new NextResponse("Forbidden", { status: 403 })
}

export async function POST(req: NextRequest) {
  // H-01: lê o body com teto de bytes ANTES de qualquer processamento (heap-DoS).
  const read = await readWebhookBody(req)
  if ("reject" in read) return read.reject
  const raw = read.raw

  // Valida assinatura — FAIL-CLOSED: sem o app secret, recusa (não processa sem verificar).
  const secret = process.env.META_APP_SECRET
  if (!secret) return new NextResponse("Webhook not configured", { status: 503 })
  const sig = req.headers.get("x-hub-signature-256") ?? ""
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex")
  const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  if (!ok) return new NextResponse("Invalid signature", { status: 401 })

  let body: unknown
  try { body = JSON.parse(raw) } catch { return new NextResponse("Bad JSON", { status: 400 }) }

  // Ack rápido (Meta exige 200 em poucos segundos) + processa fora do request.
  //
  // 🔴 O gate de status do cliente NÃO mora aqui — mora dentro de `processMetaWebhook`,
  //    no ponto em que o `phone_number_id` vira instância e o tenant fica conhecido.
  //    Duas razões: (1) resolver o tenant na rota duplicaria a busca por phone_number_id,
  //    e a cópia divergiria; (2) o ACK 200 tem que sair ANTES de qualquer decisão — a Meta
  //    re-tenta em não-2xx e, insistindo, DESABILITA a inscrição do app inteiro, o que
  //    derrubaria o canal oficial de todos os clientes por causa de um inadimplente.
  after(() => processMetaWebhook(body).catch((e) => console.error("[meta-webhook] process:", e)))
  return NextResponse.json({ received: true })
}
