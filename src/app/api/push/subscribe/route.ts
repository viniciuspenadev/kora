import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { rateLimit } from "@/lib/rate-limit"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

// Salva (ou atualiza) a subscription de Web Push deste device pro usuário logado.
// Service-role (RLS da push_subscriptions é deny-all): a confiança vem da sessão.
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id || !session.user.tenantId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  // Rate-limit por usuário — re-subscribe legítimo é raro; barra spam de device.
  const rl = rateLimit(`push:sub:${session.user.id}`, 30, 60_000)
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } })
  }

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }) }

  const sub = (body as { subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } })?.subscription
  const endpoint = sub?.endpoint
  const p256dh   = sub?.keys?.p256dh
  const authKey  = sub?.keys?.auth
  if (!endpoint || !p256dh || !authKey) {
    return NextResponse.json({ error: "bad_subscription" }, { status: 400 })
  }

  const ua = (body as { userAgent?: string })?.userAgent
  const { error } = await supabaseAdmin
    .from("push_subscriptions")
    .upsert({
      tenant_id:    session.user.tenantId,
      user_id:      session.user.id,
      endpoint,
      p256dh,
      auth:         authKey,
      user_agent:   typeof ua === "string" ? ua.slice(0, 400) : null,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "endpoint" })

  if (error) {
    console.error("[push subscribe]", error.message)
    return NextResponse.json({ error: "db" }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
