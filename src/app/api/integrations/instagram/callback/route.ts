import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { encryptSecret } from "@/lib/crypto/secrets"
import { exchangeIgCode, fetchIgAccount, subscribeIgWebhooks, wakeIgConversations } from "@/lib/instagram/api"
import { recordIgSubscription } from "@/lib/instagram/subscription-record"
import { getEnabledModuleSlugs } from "@/lib/modules"
import { publicOrigin } from "@/lib/http"

/**
 * Callback do Instagram Business Login. Verifica CSRF (cookie), troca o code por
 * token long-lived, valida a conta, cifra o token e grava em `channel_connections`.
 * Gated owner/admin (sessão no mesmo browser do redirect). Doc: docs/instagram-direct-design.md.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function back(origin: string, q: string) {
  return NextResponse.redirect(new URL(`/integracoes/instagram?${q}`, origin))
}

export async function GET(req: NextRequest) {
  const origin = publicOrigin(req)
  const session = await auth()
  if (!session?.user?.tenantId || !["owner", "admin"].includes(session.user.role)) {
    return NextResponse.redirect(new URL("/inbox", origin))
  }

  // Gate de licença — fail-closed. Repetido aqui de propósito: esta URL é chamada pela
  // Meta, não pelo nosso botão, então não dá pra assumir que passou pelo /start.
  const modules = await getEnabledModuleSlugs(session.user.tenantId)
  if (!modules.has("instagram_direct")) {
    return back(origin, `error=${encodeURIComponent("O módulo Instagram Direct não está habilitado para sua conta.")}`)
  }

  const sp = req.nextUrl.searchParams
  if (sp.get("error")) return back(origin, `error=${encodeURIComponent(sp.get("error_description") ?? sp.get("error")!)}`)

  const code  = sp.get("code")
  const state = sp.get("state")
  const cookieState = req.cookies.get("ig_oauth_state")?.value
  if (!code || !state || !cookieState || state !== cookieState) return back(origin, "error=Sess%C3%A3o+inv%C3%A1lida+(CSRF)")

  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI ?? `${origin}/api/integrations/instagram/callback`
  const ex = await exchangeIgCode(code, redirectUri)
  if ("error" in ex) return back(origin, `error=${encodeURIComponent(ex.error)}`)

  /**
   * 🔴 LER A CONTA É REQUISITO, NÃO ENFEITE — e a versão anterior tratava como enfeite.
   *
   * Antes: falhou a leitura? gravava assim mesmo, com `username: null` e caindo pro
   * `ex.userId` como id da conta. A tela então dizia **"conectado"** — e nada funcionava.
   * Diagnóstico real (Moises Pena, 2026-08-07): autorização OK, mas leitura da conta,
   * token de longa duração e assinatura de webhook **falharam os três**, e a conexão
   * ficou `active` com `@` vazio, sem validade e sem webhook.
   *
   * ⚠️ O `ex.userId` **não é o id da conta do Instagram** — é o id do usuário no app, outro
   *    namespace. O ingestor casa o webhook por id da CONTA, então uma conexão gravada com
   *    o id errado jamais receberia comentário ou mensagem, mesmo com token bom. Gravar
   *    aquilo não era "melhor que nada": era pior, porque parecia certo.
   *
   * Causa típica: app ainda em Análise (ou conta sem papel no app) — a Meta deixa
   * autorizar e nega o resto.
   */
  const acc = await fetchIgAccount(ex.token)
  if ("error" in acc) {
    console.error(JSON.stringify({ src: "ig-connect", kind: "account-read-failed", err: acc.error }))
    return back(origin, `error=${encodeURIComponent(
      "A Meta autorizou o acesso mas não liberou os dados da conta. Se o app ainda está em Análise, adicione esta conta como testadora no painel da Meta e tente de novo.",
    )}`)
  }
  const externalAccountId = acc.userId
  const username = acc.username?.trim()
  /**
   * ⚠️ `fetchIgAccount` devolve `username: j.username ?? ""` — o tipo diz `string`, mas o
   *    valor pode ser VAZIO. Sem esta guarda, a linha nasceria com `username: ""`, e aí as
   *    duas réguas de "sabemos qual conta é" divergiriam: a tela (que testa se tem
   *    conteúdo) diria "conexão incompleta", e o envio (que testa se não é nulo) usaria a
   *    conexão numa boa. Estado que contradiz a si mesmo é pior que estado ruim.
   *
   * Fechado AQUI, na origem, e não nas duas pontas: assim a invariante "conexão gravada
   * sempre sabe de quem é" vale pra todo mundo que ler a tabela, inclusive código futuro.
   */
  if (!username) {
    console.error(JSON.stringify({ src: "ig-connect", kind: "empty-username", account: externalAccountId }))
    return back(origin, `error=${encodeURIComponent(
      "A Meta não informou qual conta foi autorizada. Tente conectar novamente; se persistir, verifique se a conta é Comercial ou de Criador de conteúdo.",
    )}`)
  }

  /**
   * ⚠️ Token de LONGA duração ausente = a troca do §2 do `exchangeIgCode` falhou e sobrou o
   *    curto (≈1h). Conexão que morre em uma hora não é conexão — e antes isso passava
   *    calado, virando "parou de funcionar sozinho" dias depois.
   */
  if (!ex.expiresIn) {
    console.error(JSON.stringify({ src: "ig-connect", kind: "no-long-lived-token", account: externalAccountId }))
    return back(origin, `error=${encodeURIComponent(
      "A Meta não emitiu o acesso de longa duração para esta conta — a conexão duraria menos de uma hora. Normalmente é app em Análise ou conta sem papel no app.",
    )}`)
  }

  // Anti-hijack: conta já em outro workspace?
  const { data: existing } = await supabaseAdmin.from("channel_connections")
    .select("tenant_id").eq("channel", "instagram").eq("external_account_id", externalAccountId).maybeSingle()
  if (existing && existing.tenant_id !== session.user.tenantId) return back(origin, "error=Conta+j%C3%A1+conectada+a+outro+workspace")

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
  if (error) return back(origin, `error=${encodeURIComponent(error.message)}`)

  /**
   * 🔴 UMA CONTA POR TENANT — derruba as OUTRAS conexões de Instagram deste workspace.
   *
   * O upsert casa por `(canal, id_da_conta)`. Quando uma tentativa anterior falhou no meio,
   * o id gravado foi o do USUÁRIO no app (namespace diferente do id da CONTA), então a
   * reconexão bem-sucedida **não sobrescreve** aquela linha: cria uma segunda. As duas
   * ficam `active`, e o envio precisa desempatar — desempate que, até a auditoria de
   * 2026-08-07, era "a mais antiga", ou seja, sempre o lixo.
   *
   * Consertar só a ordem trataria o sintoma. Aqui a linha velha simplesmente **para de ser
   * elegível**: conectou uma conta, as anteriores do mesmo tenant saem de cena.
   *
   * ⚠️ Revoga, não apaga: o ledger de automações aponta pra `connection_id`, e apagar
   *    deixaria o relatório do funil órfão. Também limpa o token — ele não vale mais nada
   *    e não pode ficar guardado.
   */
  const { error: dedupErr } = await supabaseAdmin.from("channel_connections")
    .update({ status: "revoked", access_token: null, updated_at: new Date().toISOString() })
    .eq("tenant_id", session.user.tenantId)
    .eq("channel", "instagram")
    .neq("external_account_id", externalAccountId)
    .eq("status", "active")
  if (dedupErr) console.error("[ig-connect] dedup:", dedupErr.code, dedupErr.message)

  // Auto-assina os campos de webhook (inclui message_reactions) — self-provision,
  // não depende de toggle manual no painel. Não-fatal: conexão vale mesmo se falhar.
  const sub = await subscribeIgWebhooks(ex.token)
  // `comments:false` = a conta NÃO recebe comentário (caiu pros campos base). É o sinal
  // que explica "criei o fluxo de comentário e não acontece nada" — sem ele no log, esse
  // diagnóstico custa horas.
  console.log(JSON.stringify({ src: "ig-connect", kind: "subscribe", account: externalAccountId,
    result: "error" in sub ? sub.error : "ok", comments: "error" in sub ? null : sub.comments }))
  // Carimba no banco também: log de container não responde "essa conta recebe comentário?"
  // dois dias depois, e é exatamente essa a pergunta quando o fluxo "não faz nada".
  if (!("error" in sub)) await recordIgSubscription(externalAccountId, sub)

  // Conta Creator só recebe webhook DEPOIS da 1ª chamada à Conversations API (regra da
  // Meta). Sem isso o cliente conecta e nada chega, calado. Best-effort, não-fatal.
  const woke = await wakeIgConversations(ex.token)
  console.log(JSON.stringify({ src: "ig-connect", kind: "wake", account: externalAccountId, ok: woke.ok }))

  const res = back(origin, "connected=1")
  res.cookies.delete("ig_oauth_state")
  return res
}
