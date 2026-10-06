import "server-only"
import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import type { FormDefinition } from "./definition"
import { canonicalJson } from "./canonical"
import { SUBMIT_LIMITS } from "./limits"

// Kora Formulários — peças do servidor que usam segredo ou cripto. Nada aqui recebe empresa
// por parâmetro do navegador: quem chama já resolveu tudo pelo `public_id` no servidor.

/** sha256 da definição canônica — o "carimbo" da versão publicada. */
export function definitionHash(def: FormDefinition): string {
  return createHash("sha256").update(canonicalJson(def)).digest("hex")
}

/**
 * Chave derivada por finalidade. Sem AUTH_SECRET em produção = null (quem usa recusa:
 * fail-closed). Em dev, uma chave fixa para testar sem configurar nada.
 */
function derivedKey(purpose: string): Buffer | null {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) return process.env.NODE_ENV === "production" ? null : createHash("sha256").update(`kora-dev|${purpose}`).digest()
  return createHmac("sha256", secret).update(`kora-forms|${purpose}`).digest()
}

/**
 * Bilhete da página: quando ela foi aberta, assinado. O envio só vale de página aberta pelo
 * Kora há pelo menos `minFillMs` (robô preenche em milissegundos) e no máximo 24 h.
 */
export function signRenderToken(publicId: string, now = Date.now()): string {
  const key = derivedKey("render-v1")
  if (!key) return ""
  const body = `${publicId}.${now}`
  return `${now}.${createHmac("sha256", key).update(body).digest("base64url").slice(0, 32)}`
}

export function verifyRenderToken(token: unknown, publicId: string, now = Date.now()): { ok: true } | { ok: false; reason: "invalid" | "too_fast" | "expired" } {
  const key = derivedKey("render-v1")
  if (!key || typeof token !== "string" || token.length > 100) return { ok: false, reason: "invalid" }
  const [ts, mac] = token.split(".")
  const issued = Number(ts)
  if (!Number.isSafeInteger(issued) || !mac) return { ok: false, reason: "invalid" }
  const expected = createHmac("sha256", key).update(`${publicId}.${issued}`).digest("base64url").slice(0, 32)
  const a = Buffer.from(mac), b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "invalid" }
  const elapsed = now - issued
  if (elapsed < SUBMIT_LIMITS.minFillMs) return { ok: false, reason: "too_fast" }
  if (elapsed > SUBMIT_LIMITS.renderTokenMaxAgeMs) return { ok: false, reason: "expired" }
  return { ok: true }
}

/** HMAC do IP (128 bits em hex). Limita por aparelho sem guardar o endereço. */
export function hashIp(ip: string): string | null {
  const key = derivedKey("ip-v1")
  if (!key || !ip || ip === "unknown") return null
  return createHmac("sha256", key).update(ip).digest("hex").slice(0, 32)
}
