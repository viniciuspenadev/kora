import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { publicOrigin } from "@/lib/http"

/**
 * Callback de OAuth do TikTok — a URL que o dono da conta acessa DEPOIS de autorizar.
 *
 * 🔴 ESTADO: ESQUELETO CONSCIENTE, NÃO INTEGRAÇÃO PRONTA (2026-08-03).
 *    Existe porque o formulário de aplicação do TikTok exige uma "callback URL publicamente
 *    alcançável", e um 404 na análise reprova. O que está aqui é REAL e testável: origem,
 *    sessão, papel, CSRF e o tratamento do `error` que o próprio TikTok devolve.
 *    O que NÃO está: a troca do `code` por token — ela exige `client_key`/`client_secret`
 *    do app (que ainda não foi aprovado) e o endpoint de token, que eu **não vou inventar**.
 *    Ver o bloco TODO no fim.
 *
 * ⚠️ POR QUE ISTO NÃO CONECTA NADA HOJE, e é de propósito: uma rota que fingisse gravar
 *    conexão daria a impressão de canal ativo. Prefiro devolver uma mensagem honesta a
 *    criar uma linha em `channel_connections` que ninguém consegue usar.
 *
 * Espelha `integrations/instagram/callback` ponto a ponto — mesma gate de papel, mesmo
 * cookie de CSRF, mesma volta pra tela de integrações. Divergir do padrão aqui seria criar
 * uma segunda forma de conectar canal, que é como esse tipo de código apodrece.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const COOKIE = "tiktok_oauth_state"

function back(origin: string, q: string) {
  return NextResponse.redirect(new URL(`/integracoes?${q}`, origin))
}

export async function GET(req: NextRequest) {
  const origin = publicOrigin(req)

  // Gate de sessão + papel. O callback é URL chamada pelo TikTok, não pelo nosso botão —
  // então NÃO dá pra assumir que passou pelo /start. Mesma razão do comentário no IG.
  const session = await auth()
  if (!session?.user?.tenantId || !["owner", "admin"].includes(session.user.role)) {
    return NextResponse.redirect(new URL("/inbox", origin))
  }

  const sp = req.nextUrl.searchParams

  // O TikTok devolve `error`/`error_description` quando o dono NEGA a autorização.
  // Tratar isso é o que diferencia "cancelei" de "quebrou" na tela do cliente.
  if (sp.get("error")) {
    return back(origin, `error=${encodeURIComponent(sp.get("error_description") ?? sp.get("error")!)}`)
  }

  // CSRF: o nonce foi para um cookie httpOnly no /start e volta aqui no `state`.
  // Sem isso, um terceiro induz o dono a autorizar uma conta que não é dele.
  const code  = sp.get("code")
  const state = sp.get("state")
  const cookieState = req.cookies.get(COOKIE)?.value
  if (!code || !state || !cookieState || state !== cookieState) {
    return back(origin, "error=Sess%C3%A3o+inv%C3%A1lida+(CSRF)")
  }

  // ── TODO(tiktok): troca do code por token ────────────────────────────────────
  // Quando o app for aprovado e existirem `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`,
  // o restante espelha o Instagram, nesta ordem — e cada passo existe por um motivo:
  //   1. POST no endpoint de token do TikTok com { code, redirect_uri, client_key,
  //      client_secret, grant_type: "authorization_code" }
  //   2. Buscar o id/handle da conta autorizada (vira `external_account_id`)
  //   3. 🔒 ANTI-HIJACK: se a conta já existe em `channel_connections` com OUTRO
  //      `tenant_id`, RECUSAR. Sem isso, um workspace sequestra a conta de outro.
  //   4. `encryptSecret(token)` antes de gravar — token em texto puro é achado de
  //      auditoria (skill database-rules §5). NUNCA o token cru na coluna.
  //   5. upsert em `channel_connections` com `onConflict: "channel,external_account_id"`
  //      (o índice único existe, verificado) e `channel: "tiktok"` — a coluna não tem
  //      CHECK, aceita canal novo sem migration.
  //   6. Assinar os webhooks de mensagem, se o TikTok exigir provisionamento explícito
  //      (no Instagram isso é o que faz a conta receber evento; sem, conecta e não chega
  //      nada, calado — foi dor real lá).
  // ⚠️ NÃO copie o `access_token` para log em nenhum passo.
  console.warn("[tiktok-callback] autorização recebida, mas a integração não está implementada", {
    tenantId: session.user.tenantId,
    hasCode:  !!code,
  })

  const res = back(origin, `error=${encodeURIComponent("A integração com o TikTok ainda não está disponível nesta conta.")}`)
  res.cookies.delete(COOKIE)
  return res
}
