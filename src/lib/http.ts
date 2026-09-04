import "server-only"
import type { NextRequest } from "next/server"

/**
 * Origin público REAL atrás de proxy (EasyPanel/Traefik) — `req.url`/`nextUrl.origin`
 * resolvem pro host interno (0.0.0.0:80). Usa `X-Forwarded-Host`/`-Proto` (setados pelo
 * proxy) pra reconstruir o domínio público. Essencial pra redirects de OAuth baterem.
 */
export function publicOrigin(req: NextRequest): string {
  const host  = req.headers.get("x-forwarded-host") ?? req.headers.get("host")
  const proto = req.headers.get("x-forwarded-proto") ?? "https"
  if (host) return `${proto}://${host}`
  return req.nextUrl.origin
}
