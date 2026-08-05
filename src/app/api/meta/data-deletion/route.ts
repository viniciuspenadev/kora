import { NextResponse, type NextRequest } from "next/server"
import crypto from "crypto"
import { supabaseAdmin } from "@/lib/supabase"
import { hasAnyAppSecret, readSignedRequest, verifySignedRequestAnyApp } from "@/lib/meta-signed-request"

/**
 * Callback de Solicitação de Exclusão de Dados (Facebook Login / Instagram Business Login).
 *   POST → recebe signed_request, EXECUTA a exclusão e devolve { url, confirmation_code }.
 *   GET  → página de status que a Meta/usuário acessa via a `url` retornada (?code=...).
 *
 * **Obrigatório pra Análise do App** — o wizard do Instagram exige esta URL antes de enviar
 * o app pra análise, e a Meta testa o endpoint.
 *
 * ── POLÍTICA (decisão do owner, 2026-07-28): apaga a CONEXÃO, não o histórico ──
 * Excluímos a linha de `channel_connections` (id da conta externa, @handle e token — os dados
 * que ligam a Kora àquela conta). **Conversas e contatos permanecem**: são registro de negócio
 * do tenant, que é o CONTROLADOR desses dados; apagá-los por um pedido feito à Meta destruiria
 * registro comercial de terceiro, de forma irreversível. Expurgo de histórico passa por
 * suporte, com o tenant ciente.
 *
 * A exclusão roda de forma SÍNCRONA antes da resposta — por isso a página de status pode
 * afirmar que já foi concluída, sem fila nem tabela de auditoria.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? "https://kora.bluedigitalhub.com.br").replace(/\/$/, "")
}

export async function POST(req: NextRequest) {
  if (!hasAnyAppSecret()) return new NextResponse("Not configured", { status: 503 })

  const raw    = await req.text()
  const signed = await readSignedRequest(raw, req.headers.get("content-type") ?? "")
  const ok     = signed ? verifySignedRequestAnyApp(signed) : null
  if (!ok) return new NextResponse("Invalid signed_request", { status: 401 })

  const userId = ok.payload.user_id
  const code   = "del_" + crypto.randomBytes(8).toString("hex")
  let deleted  = 0

  // Instagram: o `user_id` do signed_request é o mesmo IGID guardado em `external_account_id`.
  // Apaga a linha inteira — é pedido de exclusão, não de revogação.
  if (userId) {
    const { data, error } = await supabaseAdmin
      .from("channel_connections")
      .delete()
      .eq("channel", "instagram")
      .eq("external_account_id", userId)
      .select("id")
    if (error) console.error("[meta-data-deletion] delete:", error.code, error.message)
    deleted = data?.length ?? 0
  }

  // Log da FORMA, nunca do payload cru (regra de PII em log).
  console.log("[meta-data-deletion]", JSON.stringify({ app: ok.app, user_id: userId, deleted, code, at: Date.now() }))

  return NextResponse.json({ url: `${baseUrl()}/api/meta/data-deletion?code=${code}`, confirmation_code: code })
}

export function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get("code") ?? "").replace(/[^a-z0-9_]/gi, "")
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Exclusão de dados — Kora</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:72px auto;padding:0 24px;color:#1a1a1a;line-height:1.6">
<h1 style="font-size:20px;margin-bottom:8px">Solicitação de exclusão de dados</h1>
<p><strong>Concluída.</strong> A conexão da sua conta com a Kora foi removida: o identificador
da conta, o nome de usuário e as credenciais de acesso foram apagados dos nossos servidores, e
a Kora deixou de ter qualquer acesso à sua conta.</p>
<p>As conversas e os contatos permanecem com a empresa que realizou o atendimento. Ela é a
controladora desses dados e a Kora atua como operadora — por isso a exclusão desse histórico
precisa ser solicitada a ela, ou a nós com a ciência dela.</p>
${code ? `<p style="color:#555">Código de confirmação: <code>${code}</code></p>` : ""}
<p>Dúvidas: <a href="mailto:contato@bluedigitalhub.com.br">contato@bluedigitalhub.com.br</a>.</p>
</body></html>`
  return new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })
}
