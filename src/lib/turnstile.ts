/**
 * Verificação do Cloudflare Turnstile (captcha do /signup público). Server-side.
 *
 * Fail-CLOSED em produção: sem `TURNSTILE_SECRET_KEY` → recusa (não deixa passar
 * cadastro sem captcha). Em dev sem a chave, passa — pra testar o fluxo local
 * sem precisar configurar o captcha.
 */
export async function verifyTurnstile(token: string | null | undefined, ip?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return process.env.NODE_ENV !== "production"
  if (!token) return false
  try {
    const body = new URLSearchParams({ secret, response: token })
    if (ip) body.set("remoteip", ip)
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body })
    const json = (await res.json()) as { success?: boolean }
    return json.success === true
  } catch {
    return false
  }
}
