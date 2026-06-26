import { NextResponse, type NextRequest } from "next/server"
import { parseSignedRequest, readSignedRequest } from "@/lib/meta-signed-request"

/**
 * Callback de Desautorização (Facebook Login).
 * A Meta chama quando um usuário remove a permissão do app.
 * Hoje só registra (Embedded Signup ainda não está ligado, não há token de usuário pra revogar).
 * Quando o Embedded Signup entrar, remover aqui a integração/token do tenant correspondente.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const secret = process.env.META_APP_SECRET
  if (!secret) return new NextResponse("Not configured", { status: 503 })

  const signed = await readSignedRequest(raw, req.headers.get("content-type") ?? "")
  const payload = signed ? parseSignedRequest(signed, secret) : null
  if (!payload) return new NextResponse("Invalid signed_request", { status: 401 })

  console.log("[meta-deauthorize]", JSON.stringify({ user_id: payload.user_id, at: Date.now() }))
  // TODO(embedded-signup): revogar token/integração do tenant ligado a payload.user_id.

  return NextResponse.json({ received: true })
}
