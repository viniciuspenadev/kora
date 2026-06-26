import { NextResponse, type NextRequest } from "next/server"
import crypto from "crypto"
import { auth } from "@/auth"
import { buildIgAuthorizeUrl } from "@/lib/instagram/api"
import { publicOrigin } from "@/lib/http"

/**
 * Inicia o Instagram Business Login (o "botão Conectar"). Gated owner/admin.
 * CSRF: nonce em cookie httpOnly conferido no callback. Doc: docs/instagram-direct-design.md.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function redirectUriFor(req: NextRequest): string {
  return process.env.INSTAGRAM_REDIRECT_URI ?? `${publicOrigin(req)}/api/integrations/instagram/callback`
}

export async function GET(req: NextRequest) {
  const origin = publicOrigin(req)
  const session = await auth()
  if (!session?.user?.tenantId || !["owner", "admin"].includes(session.user.role)) {
    return NextResponse.redirect(new URL("/inbox", origin))
  }
  if (!process.env.INSTAGRAM_APP_ID) {
    return NextResponse.redirect(new URL("/integracoes/instagram?error=Falta+INSTAGRAM_APP_ID", origin))
  }

  const nonce = crypto.randomBytes(16).toString("hex")
  const res = NextResponse.redirect(buildIgAuthorizeUrl(redirectUriFor(req), nonce))
  res.cookies.set("ig_oauth_state", nonce, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" })
  return res
}
