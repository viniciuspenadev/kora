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

/** Conta IG conectada + token (decifrado) do tenant — pra OUTBOUND. */
export async function getInstagramSender(tenantId: string): Promise<{ igAccountId: string; token: string } | null> {
  const { data } = await supabaseAdmin.from("channel_connections")
    .select("external_account_id, access_token")
    .eq("tenant_id", tenantId).eq("channel", "instagram").eq("status", "active").maybeSingle()
  const acc   = data?.external_account_id as string | null
  const token = decryptSecret((data?.access_token as string | null) ?? null)
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
    })
    const j = await r.json() as { message_id?: string; error?: { message?: string } }
    if (!r.ok || j.error) return { error: j.error?.message ?? `HTTP ${r.status}` }
    return { messageId: j.message_id ?? null }
  } catch (e) {
    return { error: (e as Error).message }
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
// ela é não-fatal, a conta ficaria conectada SEM receber mensagem nenhuma. Volta na F2.

/**
 * Auto-assina a conta autorizada nos campos de webhook (self-provision — o controle
 * fica no backend, não num toggle manual do painel da Meta). Idempotente; não-fatal.
 */
export async function subscribeIgWebhooks(token: string): Promise<{ ok: true } | { error: string }> {
  try {
    const r = await fetch(`${IG_BASE}/me/subscribed_apps?subscribed_fields=${encodeURIComponent(IG_WEBHOOK_FIELDS)}&access_token=${encodeURIComponent(token)}`, { method: "POST" })
    const j = await r.json() as { success?: boolean; error?: { message?: string } }
    if (!r.ok || j.error) return { error: j.error?.message ?? `HTTP ${r.status}` }
    return { ok: true }
  } catch (e) {
    return { error: (e as Error).message }
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
    const r = await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: form })
    const j = await r.json() as { access_token?: string; user_id?: string | number; error_message?: string }
    if (!r.ok || !j.access_token) return { error: j.error_message ?? `HTTP ${r.status}` }
    const shortToken = j.access_token
    const userId = String(j.user_id ?? "")

    // 2) short-lived → long-lived
    const r2 = await fetch(`${IG_BASE}/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(APP_SECRET())}&access_token=${encodeURIComponent(shortToken)}`)
    const j2 = await r2.json() as { access_token?: string; expires_in?: number }
    return { token: j2.access_token ?? shortToken, userId, expiresIn: j2.expires_in ?? null }
  } catch (e) {
    return { error: (e as Error).message }
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
    const r = await fetch(`${IG_BASE}/me/media?${params.toString()}`)
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
    return { error: (e as Error).message }
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
    })
    const j = await r.json() as { recipient_id?: string; message_id?: string; error?: { message?: string } }
    if (!r.ok || j.error || !j.recipient_id) return { error: j.error?.message ?? `HTTP ${r.status}` }
    return { recipientId: String(j.recipient_id), messageId: String(j.message_id ?? "") }
  } catch (e) {
    return { error: (e as Error).message }
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
    const r = await fetch(`${IG_BASE}/me/conversations?platform=instagram&access_token=${encodeURIComponent(token)}`)
    return { ok: r.ok }
  } catch {
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
    )
    const j = await r.json() as { access_token?: string; expires_in?: number; error?: { message?: string } }
    if (!r.ok || j.error || !j.access_token) return { error: j.error?.message ?? `HTTP ${r.status}` }
    return { token: j.access_token, expiresIn: j.expires_in ?? null }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

/** /me — valida o token e descobre a conta conectada (id + @handle). */
export async function fetchIgAccount(token: string): Promise<{ userId: string; username: string } | { error: string }> {
  try {
    const r = await fetch(`${IG_BASE}/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`)
    const j = await r.json() as { user_id?: string | number; id?: string | number; username?: string; error?: { message?: string } }
    if (!r.ok || j.error) return { error: j.error?.message ?? `HTTP ${r.status}` }
    const userId = String(j.user_id ?? j.id ?? "")
    if (!userId) return { error: "resposta sem user_id" }
    return { userId, username: j.username ?? "" }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

/** Perfil de um usuário (por IGSID) — nome real, @handle e foto. Best-effort. */
export async function fetchIgProfile(igsid: string, token: string): Promise<{ name?: string; username?: string; profilePic?: string } | null> {
  try {
    const r = await fetch(`${IG_BASE}/${igsid}?fields=name,username,profile_pic&access_token=${encodeURIComponent(token)}`)
    const j = await r.json() as { name?: string; username?: string; profile_pic?: string; error?: { message?: string } }
    if (!r.ok || j.error) { console.error("[ig-profile]", j.error?.message ?? `HTTP ${r.status}`); return null }
    return { name: j.name, username: j.username, profilePic: j.profile_pic }
  } catch (e) {
    console.error("[ig-profile]", (e as Error).message)
    return null
  }
}
