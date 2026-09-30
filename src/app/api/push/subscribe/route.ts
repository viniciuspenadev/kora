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

  // device_id do device-trust (pentest 2026-08-01): resolve pela sessão atual (sid → device_id)
  // pra que a revogação de device possa limpar o push seletivamente. Legado sem sid → null.
  let deviceId: string | null = null
  if (session.user.sid) {
    const { data: s } = await supabaseAdmin
      .from("user_sessions").select("device_id").eq("sid", session.user.sid).maybeSingle()
    deviceId = (s?.device_id as string | null) ?? null
  }

  // DELETE-then-INSERT (não upsert): o `endpoint` é de UM browser. Se ele já existia sob outro
  // user/tenant (device compartilhado, ou usuário multi-tenant re-inscrevendo), reatribui LIMPO
  // pro dono atual. Também evita a parede tenant_id-imutável — um upsert que mudasse tenant_id no
  // conflito de endpoint seria BLOQUEADO pela trigger. Insert fresco nunca muda tenant_id.
  await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", endpoint)
  const { error } = await supabaseAdmin
    .from("push_subscriptions")
    .insert({
      tenant_id:    session.user.tenantId,
      user_id:      session.user.id,
      device_id:    deviceId,
      endpoint,
      p256dh,
      auth:         authKey,
      user_agent:   typeof ua === "string" ? ua.slice(0, 400) : null,
      last_seen_at: new Date().toISOString(),
    })

  if (error) {
    console.error("[push subscribe]", error.message)
    return NextResponse.json({ error: "db" }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
