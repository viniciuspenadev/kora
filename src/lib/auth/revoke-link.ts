import "server-only"
import { createHmac, timingSafeEqual } from "crypto"

// ═══════════════════════════════════════════════════════════════
// Link de revogação em 1 clique (device trust — F5)
// ═══════════════════════════════════════════════════════════════
// Doc: docs/auth-device-trust-design.md §9. Vai no e-mail new_device_login:
// a vítima clica e derruba o dispositivo SEM precisar logar (ela pode estar
// longe da própria máquina; o token é a credencial).
//
// Token = HMAC assinado (payload.assinatura, base64url), TTL 7 dias, SEM
// estado no banco — revogação é idempotente, então "reuso" do link só repete
// um no-op. A página NUNCA revoga no GET (Outlook/SafeLinks fazem prefetch de
// links de e-mail — revogar no GET viraria auto-revogação acidental); o clique
// no botão da página é que executa.

// Sem AUTH_SECRET em produção o HMAC cairia numa constante pública → tokens de
// revogação forjáveis (DoS: derrubar dispositivos de quem se souber user+device).
// Fail-closed: explode no boot em prod, default só em dev.
if (process.env.NODE_ENV === "production" && !process.env.AUTH_SECRET) {
  throw new Error("AUTH_SECRET ausente — obrigatório pro token de revogação de dispositivo")
}
const SECRET = process.env.AUTH_SECRET || "kora-dev-secret"
const TTL_MS = 7 * 24 * 60 * 60 * 1000

interface RevokePayload {
  u: string     // userId
  d: string     // deviceId
  exp: number   // epoch ms
}

const b64u = (s: string) => Buffer.from(s).toString("base64url")
const sign = (data: string) => createHmac("sha256", SECRET).update(data).digest("base64url")

export function mintRevokeToken(userId: string, deviceId: string): string {
  const payload = b64u(JSON.stringify({ u: userId, d: deviceId, exp: Date.now() + TTL_MS } satisfies RevokePayload))
  return `${payload}.${sign(payload)}`
}

export function verifyRevokeToken(token: string): { userId: string; deviceId: string } | null {
  try {
    const [payload, sig] = String(token ?? "").split(".")
    if (!payload || !sig) return null
    const expected = sign(payload)
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as RevokePayload
    if (!data.u || !data.d || typeof data.exp !== "number") return null
    if (data.exp < Date.now()) return null
    return { userId: data.u, deviceId: data.d }
  } catch {
    return null
  }
}
