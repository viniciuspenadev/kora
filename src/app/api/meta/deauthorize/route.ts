import { NextResponse, type NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { hasAnyAppSecret, readSignedRequest, verifySignedRequestAnyApp } from "@/lib/meta-signed-request"

/**
 * Callback de Desautorização (Facebook Login / Instagram Business Login).
 * A Meta chama quando a pessoa remove a permissão do app.
 *
 * **Obrigatório pra Análise do App** — o wizard do Instagram exige esta URL (junto com a
 * de exclusão de dados) ANTES de enviar o app pra análise.
 *
 * Dois apps podem chamar aqui (Kora WhatsApp e Kora-IG), cada um assinando com o seu
 * próprio segredo — por isso a validação tenta os dois.
 *
 * **Instagram:** o `user_id` do signed_request é o mesmo IGID que guardamos em
 * `channel_connections.external_account_id` → dá pra revogar com precisão.
 * **WhatsApp:** o Embedded Signup não guarda o ASID de quem autorizou, então não há
 * como mapear hoje. Fica registrado no log e o número segue até falhar no envio —
 * dívida conhecida (exige capturar o ASID no connect).
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  if (!hasAnyAppSecret()) return new NextResponse("Not configured", { status: 503 })

  const raw    = await req.text()
  const signed = await readSignedRequest(raw, req.headers.get("content-type") ?? "")
  const ok     = signed ? verifySignedRequestAnyApp(signed) : null
  if (!ok) return new NextResponse("Invalid signed_request", { status: 401 })

  const userId = ok.payload.user_id
  let revoked  = 0

  // Instagram: derruba a conexão (status ≠ 'active' já basta — `connectionFor` filtra por
  // ele) e apaga o token, que morreu junto com a autorização.
  if (userId) {
    const { data, error } = await supabaseAdmin
      .from("channel_connections")
      .update({ status: "revoked", access_token: null, updated_at: new Date().toISOString() })
      .eq("channel", "instagram")
      .eq("external_account_id", userId)
      .select("id")
    if (error) console.error("[meta-deauthorize] revoke:", error.code, error.message)
    revoked = data?.length ?? 0
  }

  // Log da FORMA, nunca do payload cru (regra de PII em log).
  console.log("[meta-deauthorize]", JSON.stringify({ app: ok.app, user_id: userId, revoked, at: Date.now() }))

  return NextResponse.json({ received: true })
}
