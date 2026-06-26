import "server-only"

/**
 * Cliente mínimo da Graph API do Instagram (caminho "Instagram Login").
 * Base: graph.instagram.com. Usado pra (a) validar/descobrir a conta no connect e
 * (b) enriquecer o contato (nome/@/foto) a partir do IGSID. Token vem decifrado.
 * Doc: docs/instagram-direct-design.md.
 */

const IG_BASE = "https://graph.instagram.com"

const APP_ID     = () => process.env.INSTAGRAM_APP_ID ?? ""
const APP_SECRET = () => process.env.INSTAGRAM_APP_SECRET ?? ""

export const IG_SCOPES = "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments"

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
