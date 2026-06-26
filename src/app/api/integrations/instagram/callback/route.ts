import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { encryptSecret } from "@/lib/crypto/secrets"
import { exchangeIgCode, fetchIgAccount } from "@/lib/instagram/api"

/**
 * Callback do Instagram Business Login. Verifica CSRF (cookie), troca o code por
 * token long-lived, valida a conta, cifra o token e grava em `channel_connections`.
 * Gated owner/admin (sessão no mesmo browser do redirect). Doc: docs/instagram-direct-design.md.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function back(req: NextRequest, q: string) {
  return NextResponse.redirect(new URL(`/integracoes/instagram?${q}`, req.url))
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.tenantId || !["owner", "admin"].includes(session.user.role)) {
    return NextResponse.redirect(new URL("/inbox", req.url))
  }

  const sp = req.nextUrl.searchParams
  if (sp.get("error")) return back(req, `error=${encodeURIComponent(sp.get("error_description") ?? sp.get("error")!)}`)

  const code  = sp.get("code")
  const state = sp.get("state")
  const cookieState = req.cookies.get("ig_oauth_state")?.value
  if (!code || !state || !cookieState || state !== cookieState) return back(req, "error=Sess%C3%A3o+inv%C3%A1lida+(CSRF)")

  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI ?? `${req.nextUrl.origin}/api/integrations/instagram/callback`
  const ex = await exchangeIgCode(code, redirectUri)
  if ("error" in ex) return back(req, `error=${encodeURIComponent(ex.error)}`)

  // @handle pra display (o user_id já veio do exchange).
  const acc = await fetchIgAccount(ex.token)
  const externalAccountId = "error" in acc ? ex.userId : acc.userId
  const username = "error" in acc ? null : acc.username

  // Anti-hijack: conta já em outro workspace?
  const { data: existing } = await supabaseAdmin.from("channel_connections")
    .select("tenant_id").eq("channel", "instagram").eq("external_account_id", externalAccountId).maybeSingle()
  if (existing && existing.tenant_id !== session.user.tenantId) return back(req, "error=Conta+j%C3%A1+conectada+a+outro+workspace")

  const expiresAt = ex.expiresIn ? new Date(Date.now() + ex.expiresIn * 1000).toISOString() : null
  const { error } = await supabaseAdmin.from("channel_connections").upsert({
    tenant_id:           session.user.tenantId,
    channel:             "instagram",
    external_account_id: externalAccountId,
    username,
    access_token:        encryptSecret(ex.token),
    token_expires_at:    expiresAt,
    status:              "active",
    updated_at:          new Date().toISOString(),
  }, { onConflict: "channel,external_account_id" })
  if (error) return back(req, `error=${encodeURIComponent(error.message)}`)

  const res = back(req, "connected=1")
  res.cookies.delete("ig_oauth_state")
  return res
}
