import { NextResponse, type NextRequest } from "next/server"
import { createHmac, timingSafeEqual } from "node:crypto"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * POST /api/webhooks/resend
 *
 * Recebe eventos do Resend (delivery, bounce, open, click, etc) e atualiza
 * a linha correspondente em email_outbox pelo `resend_id`.
 *
 * Auth: HMAC-SHA256 do body assinado com RESEND_WEBHOOK_SECRET. Headers do
 * Resend usam padrão Svix (svix-id + svix-timestamp + svix-signature).
 *
 * Config no painel do Resend:
 *   - URL: https://<seu-dominio>/api/webhooks/resend
 *   - Events: email.sent, email.delivered, email.bounced, email.complained,
 *             email.opened, email.clicked, email.delivery_delayed
 *   - Copia o "Signing Secret" → env RESEND_WEBHOOK_SECRET=whsec_xxx
 */

interface ResendEvent {
  type: string
  created_at: string
  data: {
    email_id?: string
    to?: string[]
    from?: string
    subject?: string
    bounce?: { message?: string }
    [k: string]: unknown
  }
}

const EVENT_TO_STATUS: Record<string, { status: string; tsField: string }> = {
  "email.sent":              { status: "sent",        tsField: "sent_at" },
  "email.delivered":         { status: "delivered",   tsField: "delivered_at" },
  "email.delivery_delayed":  { status: "sent",        tsField: "sent_at" },
  "email.opened":            { status: "opened",      tsField: "opened_at" },
  "email.clicked":           { status: "clicked",     tsField: "clicked_at" },
  "email.bounced":           { status: "bounced",     tsField: "bounced_at" },
  "email.complained":        { status: "complained",  tsField: "complained_at" },
  "email.failed":            { status: "failed",      tsField: "sent_at" },
}

function verifySignature(body: string, headers: Headers, secret: string): boolean {
  // Svix usa: v1,<base64-hmac> separados por espaço se múltiplas keys
  const svixId        = headers.get("svix-id")
  const svixTimestamp = headers.get("svix-timestamp")
  const svixSignature = headers.get("svix-signature")
  if (!svixId || !svixTimestamp || !svixSignature) return false

  // Secret do Resend vem como "whsec_xxxx" — remove o prefix, decodifica base64
  const cleanSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret
  const secretBytes = Buffer.from(cleanSecret, "base64")

  // toBeSigned = `${svix_id}.${svix_timestamp}.${body}`
  const toSign = `${svixId}.${svixTimestamp}.${body}`
  const expected = createHmac("sha256", secretBytes).update(toSign).digest("base64")

  // Header pode ter múltiplas signatures separadas por espaço (rotation)
  const sigs = svixSignature.split(" ").map((s) => s.split(",")[1]).filter(Boolean)
  for (const sig of sigs) {
    try {
      const a = Buffer.from(expected, "base64")
      const b = Buffer.from(sig, "base64")
      if (a.length === b.length && timingSafeEqual(a, b)) return true
    } catch {
      // sig malformada
    }
  }
  return false
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  const body   = await req.text()

  // FAIL-CLOSED: sem secret, recusa em vez de aceitar evento não-assinado.
  if (!secret) {
    return NextResponse.json({ error: "webhook not configured" }, { status: 503 })
  }
  if (!verifySignature(body, req.headers, secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 })
  }

  let event: ResendEvent
  try {
    event = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }

  const mapping = EVENT_TO_STATUS[event.type]
  const resendId = event.data?.email_id
  if (!mapping || !resendId) {
    // Evento que não modelamos — não é erro, só ignora
    return NextResponse.json({ ok: true, ignored: event.type })
  }

  const update: Record<string, unknown> = {
    status:           mapping.status,
    [mapping.tsField]: new Date().toISOString(),
  }
  if (event.type === "email.bounced" && event.data?.bounce?.message) {
    update.error = event.data.bounce.message
  }

  const { error } = await supabaseAdmin
    .from("email_outbox")
    .update(update)
    .eq("resend_id", resendId)

  if (error) {
    console.error("[resend-webhook] DB update failed:", error.message)
    return NextResponse.json({ error: "db update failed" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
