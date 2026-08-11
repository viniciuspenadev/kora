import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { rateLimit } from "@/lib/rate-limit"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

// Remove a subscription deste device (usuário desligou avisos ou trocou de conta).
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const rl = rateLimit(`push:unsub:${session.user.id}`, 30, 60_000)
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } })
  }

  const body = await req.json().catch(() => null)
  const endpoint = (body as { endpoint?: string } | null)?.endpoint
  if (!endpoint) return NextResponse.json({ error: "bad" }, { status: 400 })

  await supabaseAdmin
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("user_id", session.user.id)

  return NextResponse.json({ ok: true })
}
