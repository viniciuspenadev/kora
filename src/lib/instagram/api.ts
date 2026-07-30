import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { decryptSecret } from "@/lib/crypto/secrets"

/**
 * Cliente mínimo da Graph API do Instagram (caminho "Instagram Login").
 * Base: graph.instagram.com. Usado pra (a) validar/descobrir a conta no connect,
 * (b) enriquecer o contato (nome/@/foto) e (c) ENVIAR DM (outbound). Token decifrado.
 * Doc: docs/instagram-direct-design.md.
 */

const IG_BASE = "https://graph.instagram.com"

/**
 * ⏱️ TODA chamada à Graph API leva timeout. `fetch` no Node não tem prazo default:
 * Meta pendurada = o `after()` do webhook fica preso até a plataforma matar o processo,
 * e o claim daquele comentário fica `claimed` pra sempre (o índice único de dedup
 * `uq_ig_runs_dedup` impede reprocessar o mesmo comment_id).
 *
 * Os valores saem do custo real de cada chamada, não de um número redondo único:
 *   • TEXT  — envio de DM / private reply / resposta pública: payload minúsculo, no
 *             caminho quente do webhook e do inbox. Esperar mais atrasa o atendente.
 *   • READ  — leitura curta (/me, perfil, subscribe, refresh de token, wake).
 *   • MEDIA — /me/media: a Meta monta thumbnails de ~24 posts; é a chamada mais pesada
 *             do arquivo e roda numa grade que já mostra "carregando".
 *   • OAUTH — code → token: dois saltos (api.instagram.com → graph) com o cliente
 *             parado no redirect; falhar aqui obriga refazer o login inteiro.
 */
const T_TEXT  = 10_000
const T_READ  =  8_000
const T_MEDIA = 25_000
const T_OAUTH = 15_000

/**
 * `AbortSignal.timeout()` rejeita com DOMException `TimeoutError`, mas o undici do Node
 * às vezes embrulha num `TypeError: fetch failed` com a causa dentro — daí os dois testes.
 */
function isTimeoutError(e: unknown): boolean {
  const err   = e as { name?: string; cause?: { name?: string } } | null
  const names = [err?.name, err?.cause?.name]
  return names.some((n) => n === "TimeoutError" || n === "AbortError")
}

/** Erro de rede legível: timeout vira "não respondeu em Ns", não uma string opaca. */
function netErr(e: unknown, ms: number, what: string): string {
  if (isTimeoutError(e)) {
    return `O Instagram não respondeu em ${Math.round(ms / 1000)}s (${what}). Tente de novo em instantes.`
  }
  return (e as Error)?.message ?? String(e)
}

/**
 * Conta IG conectada + token (decifrado) do tenant — pra OUTBOUND.
 *
 * ⚠️ `.order(created_at).limit(1)` e **nunca** `.maybeSingle()`: com DUAS conexões
 * ativas no mesmo tenant o PostgREST devolve `PGRST116` e — se o erro for descartado —
 * a função retorna `null`, derrubando TODO o outbound do Instagram de uma vez (resposta
 * do atendente no inbox, fluxo do Studio, re-subscribe do webhook) com a mensagem
 * "conta não conectada" enquanto a tela de Integrações mostra as duas conectadas.
 * Mesma armadilha, mesmo remédio de `activeIgConnectionId` (actions/studio/flows.ts).
 * A mais antiga vence — escolha determinística, igual à da projeção de regras.
 */
export async function getInstagramSender(tenantId: string): Promise<{ igAccountId: string; token: string } | null> {
  const { data, error } = await supabaseAdmin.from("channel_connections")
    .select("external_account_id, access_token")
    .eq("tenant_id", tenantId).eq("channel", "instagram").eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
  if (error) { console.error("[ig-sender] select:", error.code, error.message); return null }
  const row   = data?.[0]
  const acc   = (row?.external_account_id as string | null) ?? null
  const token = decryptSecret((row?.access_token as string | null) ?? null)
  if (!acc || !token) return null
  return { igAccountId: acc, token }
}

/** Envia um texto via Instagram Send API (Graph). Só vale dentro da janela 24h. */
export async function sendInstagramText(
  igAccountId: string, recipientIgsid: string, token: string, text: string,
): Promise<{ messageId: string | null } | { error: string }> {
  try {
    const r = await fetch(`${IG_BASE}/${igAccountId}/messages?access_token=${encodeURIComponent(token)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: recipientIgsid }, message: { text } }),
      signal: AbortSignal.timeout(T_TEXT),
    })
    const j = await r.json() as { message_id?: string; error?: { message?: string } }
    if (!r.ok || j.error) return { error: j.error?.message ?? `HTTP ${r.status}` }
    return { messageId: j.message_id ?? null }
  } catch (e) {
    return { error: netErr(e, T_TEXT, "envio de mensagem") }
  }
}

/**
 * Campos de webhook que o nosso ingestor trata. Reação chega APENAS via
 * `message_reactions` (separado de `messages` — confirmado na doc da Meta);
 * sem assinar esse campo, a reação reverte no app e nunca chega no webhook.
 */
export const IG_WEBHOOK_FIELDS = "messages,message_reactions,messaging_postbacks,messaging_seen,messaging_referral"
// ⚠️ `comments` sai daqui junto com o escopo de comentários (ver IG_SCOPES). Assinar um
// campo cuja permissão não foi aprovada faz a chamada inteira de subscribe falhar — e como
// ela é não-fatal, a conta ficaria conectada SEM receber mensagem nenhuma.
// 🔴 O RUNTIME da F2 já existe (handleComment em channels/instagram-inbound.ts) e fica
// INERTE de propósito até a Meta aprovar `instagram_business_manage_comments`. Ao aprovar,
// a virada é de DOIS lugares, na ordem: (1) `comments` aqui, (2) o escopo em IG_SCOPES —
// e o (2) obriga TODA conta já conectada a refazer o OAuth (refreshIgToken renova o token,
// NÃO o escopo). Isso é comunicação de produto, não código.

/**
 * Auto-assina a conta autorizada nos campos de webhook (self-provision — o controle
 * fica no backend, não num toggle manual do painel da Meta). Idempotente; não-fatal.
 */
export async function subscribeIgWebhooks(token: string): Promise<{ ok: true } | { error: string }> {
  try {
    const r = await fetch(`${IG_BASE}/me/subscribed_apps?subscribed_fields=${encodeURIComponent(IG_WEBHOOK_FIELDS)}&access_token=${encodeURIComponent(token)}`, {
      method: "POST", signal: AbortSignal.timeout(T_READ),
    })
    const j = await r.json() as { success?: boolean; error?: { message?: string } }
    if (!r.ok || j.error) return { error: j.error?.message ?? `HTTP ${r.status}` }
    return { ok: true }
  } catch (e) {
    return { error: netErr(e, T_READ, "assinatura do webhook") }
  }
}

const APP_ID     = () => process.env.INSTAGRAM_APP_ID ?? ""
const APP_SECRET = () => process.env.INSTAGRAM_APP_SECRET ?? ""

/**
 * Escopos pedidos no Business Login. **Tem que bater exatamente com o que foi APROVADO
 * na Análise do App** — pedir permissão não aprovada faz o OAuth do cliente falhar.
 *
 * `instagram_business_manage_comments` foi REMOVIDO na 1ª submissão (2026-07-28): o
 * ingestor recebe comentário mas só loga (comment-to-DM é a F2), e a Meta reprova
 * permissão que o screencast não demonstra em uso. Volta na 2ª rodada, junto com a F2 —
 * e aí `comments` volta também pro IG_WEBHOOK_FIELDS.
 */
export const IG_SCOPES = "instagram_business_basic,instagram_business_manage_messages"

/** URL de autorização do Instagram Business Login (o "botão Conectar"). */
export function buildIgAuthorizeUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id:     APP_ID(),
    redirect_uri:  redirectUri,
    response_type: "code",
    scope:         IG_SCOPES,
    state,
  })
  return `https://www.instagram.com/oauth/authorize?${p.toString()}`
}

/** Troca o `code` do OAuth por um token LONG-LIVED (~60d, renovável). */
export async function exchangeIgCode(
  code: string, redirectUri: string,
): Promise<{ token: string; userId: string; expiresIn: number | null } | { error: string }> {
  try {
    // 1) code → token short-lived
    const form = new URLSearchParams({
      client_id: APP_ID(), client_secret: APP_SECRET(),
      grant_type: "authorization_code", redirect_uri: redirectUri, code,
    })
    const r = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST", body: form, signal: AbortSignal.timeout(T_OAUTH),
    })
    const j = await r.json() as { access_token?: string; user_id?: string | number; error_message?: string }
    if (!r.ok || !j.access_token) return { error: j.error_message ?? `HTTP ${r.status}` }
    const shortToken = j.access_token
    const userId = String(j.user_id ?? "")

    // 2) short-lived → long-lived
    const r2 = await fetch(
      `${IG_BASE}/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(APP_SECRET())}&access_token=${encodeURIComponent(shortToken)}`,
      { signal: AbortSignal.timeout(T_OAUTH) },
    )
    const j2 = await r2.json() as { access_token?: string; expires_in?: number }
    return { token: j2.access_token ?? shortToken, userId, expiresIn: j2.expires_in ?? null }
  } catch (e) {
    return { error: netErr(e, T_OAUTH, "troca do código de autorização") }
  }
}

/** Um post/reel da conta conectada — o que a grade do seletor precisa mostrar. */
export interface IgMediaItem {
  id:            string
  caption:       string | null
  mediaType:     string          // IMAGE | VIDEO | CAROUSEL_ALBUM
  isReel:        boolean
  thumbUrl:      string | null   // ⚠️ URL de CDN — EXPIRA. Ver nota abaixo.
  permalink:     string | null
  timestamp:     string | null
  commentsCount: number | null   // dado-herói do tile: é o que faz escolher o post certo
}

/**
 * Lista os posts/reels da conta conectada — alimenta o seletor visual de post da
 * automação de comentário. Coberto por `instagram_business_basic` (leitura de mídia
 * da própria conta), **sem permissão nova**.
 *
 * ⚠️ **`thumbUrl` é URL de CDN da Meta e EXPIRA** (mesma dor já resolvida no avatar do
 * Instagram). Vale pra grade, que é efêmera. Pro card do fluxo — que fica semanas na
 * tela — a thumbnail do post ESCOLHIDO tem que ser baixada e congelada no momento da
 * escolha, senão o canvas quebra em dias.
 *
 * ⚠️ A API **não busca por legenda**. A busca do seletor é client-side sobre o que já
 * foi carregado; pro arquivo antigo, o caminho é colar o link do post.
 *
 * Paginação por cursor (`after`), como o resto do Graph.
 */
export async function listIgMedia(
  token: string, opts?: { limit?: number; after?: string },
): Promise<{ items: IgMediaItem[]; nextCursor: string | null } | { error: string }> {
  const fields = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,comments_count"
  const params = new URLSearchParams({
    fields,
    limit:        String(opts?.limit ?? 24),
    access_token: token,
  })
  if (opts?.after) params.set("after", opts.after)

  try {
    const r = await fetch(`${IG_BASE}/me/media?${params.toString()}`, { signal: AbortSignal.timeout(T_MEDIA) })
    const j = await r.json() as {
      data?: Array<{
        id?: string; caption?: string; media_type?: string; media_product_type?: string
        media_url?: string; thumbnail_url?: string; permalink?: string
        timestamp?: string; comments_count?: number
      }>
      paging?: { cursors?: { after?: string }; next?: string }
      error?: { message?: string }
    }
    if (!r.ok || j.error) return { error: j.error?.message ?? `HTTP ${r.status}` }

    const items: IgMediaItem[] = (j.data ?? []).map((m) => ({
      id:            String(m.id ?? ""),
      caption:       m.caption?.trim() || null,
      mediaType:     m.media_type ?? "IMAGE",
      isReel:        m.media_product_type === "REELS",
      // Vídeo/reel não tem `media_url` servível como imagem → usa a thumbnail.
      thumbUrl:      m.thumbnail_url ?? m.media_url ?? null,
      permalink:     m.permalink ?? null,
      timestamp:     m.timestamp ?? null,
      commentsCount: typeof m.comments_count === "number" ? m.comments_count : null,
    })).filter((m) => m.id)

    // Só devolve cursor se há próxima página de verdade (senão a UI pagina no vazio).
    const nextCursor = j.paging?.next ? (j.paging?.cursors?.after ?? null) : null
    return { items, nextCursor }
  } catch (e) {
    return { error: netErr(e, T_MEDIA, "lista de publicações") }
  }
}

/**
 * **Private Reply** — resposta privada no Direct a quem comentou num post/reel.
 *
 * É a ÚNICA porta de entrada sancionada pra conversa fria no Instagram: quem só comentou
 * nunca te mandou mensagem, então a janela de 24h não existe — mas a Meta abre uma exceção
 * pro comentário.
 *
 * Regras (docs/instagram-api/private-replies-and-entry-points.md):
 *  • **1 mensagem por comentário**, e só uma. Não há segunda chance.
 *  • **7 dias** a partir do comentário (em Live, só durante a transmissão).
 *  • A conversa só continua se a pessoa RESPONDER — aí abre a janela de 24h normal.
 *  • Cai na caixa de entrada de quem segue, e em "Solicitações" de quem não segue.
 *
 * O retorno traz o **IGSID** de quem comentou (`recipient_id`) — é assim que a gente
 * descobre a identidade, já que o perfil dele é inacessível enquanto não responder
 * (regra de consentimento da User Profile API).
 */
export async function sendIgPrivateReply(
  token: string, igAccountId: string, commentId: string, text: string,
): Promise<{ recipientId: string; messageId: string } | { error: string }> {
  try {
    const r = await fetch(`${IG_BASE}/${igAccountId}/messages`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ recipient: { comment_id: commentId }, message: { text } }),
      signal:  AbortSignal.timeout(T_TEXT),
    })
    const j = await r.json() as { recipient_id?: string; message_id?: string; error?: { message?: string } }
    if (!r.ok || j.error || !j.recipient_id) return { error: j.error?.message ?? `HTTP ${r.status}` }
    return { recipientId: String(j.recipient_id), messageId: String(j.message_id ?? "") }
  } catch (e) {
    // Timeout aqui é o caso mais delicado do arquivo: a bala é ÚNICA por comentário e a
    // Meta pode ter aceitado a DM mesmo sem a resposta chegar. Vira `failed` no ledger
    // (devolve a cota) e não é re-tentado — o dedup por comment_id impede segundo disparo.
    return { error: netErr(e, T_TEXT, "resposta privada do comentário") }
  }
}

/**
 * Ledger (`instagram_automation_runs`): o 1º reply da pessoa fecha o funil da automação
 * premium — claimed → sent → **replied**. Forward-only (só sai de `sent`), espelhando
 * `markRecipientReplied` das campanhas.
 *
 * ⚠️ Mora AQUI, e não no ingestor que escreve o resto do ledger, só por dependência:
 * quem consome é o `run.ts`, e `run.ts → instagram-inbound → dispatch → run.ts` fecharia
 * um ciclo de import. Este módulo não importa nada do motor.
 */
export async function markIgAutomationReplied(tenantId: string, runId: string): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin.from("instagram_automation_runs")
    .update({ status: "replied", replied_at: now, updated_at: now })
    .eq("id", runId).eq("tenant_id", tenantId).eq("status", "sent")
  if (error) console.error("[ig-ledger] markReplied:", error.code, error.message)
}

/**
 * **Resposta PÚBLICA ao comentário** — o *"te chamei no direct 👀"* visível a todos,
 * respondendo o próprio comentário.
 *
 * Não é enfeite (decisão do owner, §8.2 do desenho): quem **não segue** recebe a private
 * reply em **"Solicitações"**, aba que muita gente nunca abre. A resposta pública é o que
 * avisa a pessoa a ir olhar — sem ela, a bala única é gasta numa mensagem que talvez nem
 * seja vista. De quebra puxa mais comentários e sinaliza engajamento pro algoritmo.
 *
 * Caminho do Instagram Login: `POST /<IG_COMMENT_ID>/replies?message=…` em
 * graph.instagram.com (o `message` vai na query string, forma documentada pela Meta —
 * esta edge não aceita corpo JSON como a de mensagens). Mesma permissão da private
 * reply: `instagram_business_manage_comments`.
 *
 * Best-effort no runtime: falhar aqui NÃO invalida o Direct que já saiu.
 */
export async function replyToIgComment(
  token: string, commentId: string, text: string,
): Promise<{ id: string } | { error: string }> {
  try {
    const r = await fetch(`${IG_BASE}/${commentId}/replies?message=${encodeURIComponent(text)}`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal:  AbortSignal.timeout(T_TEXT),
    })
    const j = await r.json() as { id?: string; error?: { message?: string } }
    if (!r.ok || j.error || !j.id) return { error: j.error?.message ?? `HTTP ${r.status}` }
    return { id: String(j.id) }
  } catch (e) {
    return { error: netErr(e, T_TEXT, "resposta pública do comentário") }
  }
}

/**
 * "Acorda" a conta na Conversations API — best-effort, chamado uma vez no connect.
 *
 * ⚠️ Gotcha documentado pela Meta: conta **Creator** (não Business) **só passa a receber
 * webhook depois** que o app faz uma primeira chamada à Conversations API. Sem isso o
 * cliente conecta, vê "conectado", e nenhuma mensagem chega — sem erro nenhum.
 * Em conta Business é inofensivo (uma leitura a mais no connect).
 */
export async function wakeIgConversations(token: string): Promise<{ ok: boolean }> {
  try {
    const r = await fetch(
      `${IG_BASE}/me/conversations?platform=instagram&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(T_READ) },
    )
    return { ok: r.ok }
  } catch (e) {
    // Best-effort: nunca derruba o connect. Mas timeout aqui explica conta Creator que
    // conecta e não recebe webhook — por isso o motivo vai pro log, não pro vazio.
    console.error("[ig-wake]", netErr(e, T_READ, "wake da Conversations API"))
    return { ok: false }
  }
}

/**
 * Renova um token long-lived por mais ~60 dias (`ig_refresh_token`).
 *
 * Sem isso, TODA conexão de cliente morre sozinha ~60 dias depois de conectar — e morre
 * calada: o webhook simplesmente para de ser aceito. Chamado pelo cron diário
 * (`/api/cron/instagram-refresh`).
 *
 * Regras da Meta: o token precisa ter **mais de 24h de vida** e **ainda não ter expirado**.
 * Token expirado é irrecuperável — só reconectando pelo OAuth.
 */
export async function refreshIgToken(
  token: string,
): Promise<{ token: string; expiresIn: number | null } | { error: string }> {
  try {
    const r = await fetch(
      `${IG_BASE}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(T_READ) },
    )
    const j = await r.json() as { access_token?: string; expires_in?: number; error?: { message?: string } }
    if (!r.ok || j.error || !j.access_token) return { error: j.error?.message ?? `HTTP ${r.status}` }
    return { token: j.access_token, expiresIn: j.expires_in ?? null }
  } catch (e) {
    return { error: netErr(e, T_READ, "renovação do token") }
  }
}

/** /me — valida o token e descobre a conta conectada (id + @handle). */
export async function fetchIgAccount(token: string): Promise<{ userId: string; username: string } | { error: string }> {
  try {
    const r = await fetch(
      `${IG_BASE}/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(T_READ) },
    )
    const j = await r.json() as { user_id?: string | number; id?: string | number; username?: string; error?: { message?: string } }
    if (!r.ok || j.error) return { error: j.error?.message ?? `HTTP ${r.status}` }
    const userId = String(j.user_id ?? j.id ?? "")
    if (!userId) return { error: "resposta sem user_id" }
    return { userId, username: j.username ?? "" }
  } catch (e) {
    return { error: netErr(e, T_READ, "validação da conta") }
  }
}

/** Perfil de um usuário (por IGSID) — nome real, @handle e foto. Best-effort. */
export async function fetchIgProfile(igsid: string, token: string): Promise<{ name?: string; username?: string; profilePic?: string } | null> {
  try {
    const r = await fetch(
      `${IG_BASE}/${igsid}?fields=name,username,profile_pic&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(T_READ) },
    )
    const j = await r.json() as { name?: string; username?: string; profile_pic?: string; error?: { message?: string } }
    if (!r.ok || j.error) { console.error("[ig-profile]", j.error?.message ?? `HTTP ${r.status}`); return null }
    return { name: j.name, username: j.username, profilePic: j.profile_pic }
  } catch (e) {
    console.error("[ig-profile]", netErr(e, T_READ, "perfil do usuário"))
    return null
  }
}
