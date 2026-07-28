import { NextResponse, type NextRequest } from "next/server"
import crypto from "crypto"
import { parseSignedRequest, readSignedRequest } from "@/lib/meta-signed-request"

/**
 * Callback de Solicitação de Exclusão de Dados (Facebook Login) — obrigatório p/ App Review.
 *   POST → recebe signed_request, registra a solicitação e devolve { url, confirmation_code }.
 *   GET  → página de status que a Meta/usuário acessa via a `url` retornada (?code=...).
 * Quando o Embedded Signup entrar, executar aqui a exclusão real dos dados do usuário.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? "https://kora.bluedigitalhub.com.br").replace(/\/$/, "")
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const secret = process.env.META_APP_SECRET
  if (!secret) return new NextResponse("Not configured", { status: 503 })

  const signed = await readSignedRequest(raw, req.headers.get("content-type") ?? "")
  const payload = signed ? parseSignedRequest(signed, secret) : null
  if (!payload) return new NextResponse("Invalid signed_request", { status: 401 })

  const code = "del_" + crypto.randomBytes(8).toString("hex")
  console.log("[meta-data-deletion]", JSON.stringify({ user_id: payload.user_id, code, at: Date.now() }))
  // TODO(embedded-signup): excluir dados do tenant/usuário ligado a payload.user_id.

  return NextResponse.json({
    url: `${baseUrl()}/api/meta/data-deletion?code=${code}`,
    confirmation_code: code,
  })
}

export function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code") ?? ""
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Exclusão de dados — Kora</title></head>
<body style="font-family:system-ui;max-width:480px;margin:80px auto;padding:0 24px;color:#1a1a1a">
<h1 style="font-size:20px">Solicitação de exclusão de dados</h1>
<p>Sua solicitação de exclusão de dados foi recebida e está sendo processada.</p>
${code ? `<p>Código de confirmação: <code>${code.replace(/[^a-z0-9_]/gi, "")}</code></p>` : ""}
<p>Em caso de dúvidas, contate <a href="mailto:contato@bluedigitalhub.com.br">contato@bluedigitalhub.com.br</a>.</p>
</body></html>`
  return new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })
}
