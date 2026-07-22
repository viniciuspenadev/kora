// ═══════════════════════════════════════════════════════════════
// Proxy global — security headers + cookie de dispositivo
// ═══════════════════════════════════════════════════════════════
// ⚠️ Arquivo era `middleware.ts`; no Next 16 a convenção virou `proxy.ts`
// (o nome antigo está deprecado). A função exportada chama-se `proxy`.
//
// Aplica em TODAS as rotas. Tightening por path:
//
//  ROTAS DO APP (/, /admin/*, /(app)/*):
//    full CSP + X-Frame-Options DENY + Permissions-Policy
//
//  ROTAS DO WIDGET (/w/*, /api/site/*):
//    headers básicos, sem CSP/XFO (widget é JS cross-origin pra terceiros)
//
//  WEBHOOKS (/api/webhooks/*):
//    sem UI, headers mínimos
//
// CSP atual usa 'unsafe-inline'/'unsafe-eval' por necessidades de Next 16 + React 19
// (hydration scripts, styled-jsx). Tightening pra nonces fica em S2.1.

import { NextResponse, type NextRequest } from "next/server"
import { randomBytes } from "crypto"

// ── Cookie de dispositivo (device trust — F1) ─────────────────────
// Doc: docs/auth-device-trust-design.md §2. Identidade PERSISTENTE do navegador,
// separada do cookie de sessão e sobrevivendo ao logout. Aqui só EMITIMOS o
// segredo; a linha em auth_devices nasce no login (lib/auth/device.ts), e o gate
// só entra na F3. Nome/flags duplicados de propósito: o proxy não deve importar
// módulo `server-only` (o Next otimiza este arquivo separado do resto).
const IS_PROD = process.env.NODE_ENV === "production"
const DEVICE_COOKIE  = IS_PROD ? "__Host-kora-did" : "kora-did"
const DEVICE_MAX_AGE = 400 * 24 * 60 * 60   // teto do Chrome

const SUPABASE_HOST  = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/^https?:\/\//, "")
const SUPABASE_WS    = SUPABASE_HOST ? `wss://${SUPABASE_HOST}` : ""
const SUPABASE_HTTPS = SUPABASE_HOST ? `https://${SUPABASE_HOST}` : ""

// Cloudflare Turnstile (captcha do /signup) carrega script + iframe de
// challenges.cloudflare.com. Liberado SÓ na rota /signup (blast radius mínimo).
const TURNSTILE = "https://challenges.cloudflare.com"

// Embedded Signup do WhatsApp (Meta): carrega o FB SDK (connect.facebook.net) e
// usa um iframe de comunicação + XHR de www.facebook.com. Liberado SÓ na página da
// integração oficial (mesmo padrão do Turnstile — não afrouxa a CSP do resto do app).
const META_SCRIPT = "https://connect.facebook.net"
const META_FRAME  = "https://www.facebook.com"

function buildCsp(opts: { turnstile?: boolean; meta?: boolean } = {}): string {
  const cf = opts.turnstile ? ` ${TURNSTILE}` : ""
  const mS = opts.meta ? ` ${META_SCRIPT}` : ""                       // script-src
  const mF = opts.meta ? ` ${META_FRAME}` : ""                        // frame-src
  const mC = opts.meta ? ` ${META_SCRIPT} ${META_FRAME}` : ""         // connect-src (XHR do SDK)
  return [
    "default-src 'self'",
    // 'unsafe-eval' temporariamente por Next 16 + React 19 dev/hydration; remover em S2.1
    `script-src 'self' 'unsafe-inline' 'unsafe-eval'${cf}${mS}`,
    // 'unsafe-inline' style por styled-jsx + Tailwind runtime; remover em S2.1
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    // Áudio/vídeo do Supabase Storage (signed URLs) — sem media-src cai em default-src e bloqueia
    `media-src 'self' blob: ${SUPABASE_HTTPS}`.trim(),
    // Supabase REST + Realtime + Storage; OpenAI direto não chamamos do client
    `connect-src 'self' ${SUPABASE_HTTPS} ${SUPABASE_WS}${mC}`.trim(),
    // iframe do widget Turnstile (/signup) ou do FB SDK (integração oficial); 'self' p/
    // preview de email no admin; blob: p/ a prévia do PDF da cotação (compositor).
    `frame-src 'self' blob:${cf}${mF}`,
    // 'self' permite iframes da própria app (ex: preview de email em /admin/emails).
    // Mantém proteção anti-clickjacking de origens externas.
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ")
}

const CSP_APP    = buildCsp()
const CSP_SIGNUP = buildCsp({ turnstile: true })
const CSP_META   = buildCsp({ meta: true })

const PERMISSIONS_POLICY = [
  "camera=()",
  // self = inbox grava voice notes via getUserMedia. Sem iframes/cross-origin.
  "microphone=(self)",
  "geolocation=()",
  "interest-cohort=()",
  "browsing-topics=()",
].join(", ")

export function proxy(req: NextRequest) {
  const res  = NextResponse.next()
  const path = req.nextUrl.pathname

  // ── Sempre aplicar ──────────────────────────────────────
  res.headers.set("X-Content-Type-Options",   "nosniff")
  res.headers.set("Referrer-Policy",          "strict-origin-when-cross-origin")
  res.headers.set("Strict-Transport-Security","max-age=63072000; includeSubDomains; preload")

  // ── Widget cross-origin (/w/*) e endpoints do widget (/api/site/*) ───
  // Esses servem JS/JSON pra ser embedded em sites terceiros. Pular CSP/XFO.
  const isWidgetRoute =
    path.startsWith("/w/") ||
    path.startsWith("/api/site/")

  // ── Webhooks: sem UI, sem CSP/XFO ───────────────────────
  const isWebhookRoute = path.startsWith("/api/webhooks/")

  if (isWidgetRoute || isWebhookRoute) {
    return res
  }

  // ── App routes ──────────────────────────────────────────
  // SAMEORIGIN (não DENY): permite iframes da própria app (preview de email).
  // CSP frame-ancestors 'self' já cobre browsers modernos; X-Frame-Options
  // é fallback pra browsers antigos.
  res.headers.set("X-Frame-Options",      "SAMEORIGIN")
  res.headers.set("Permissions-Policy",   PERMISSIONS_POLICY)
  // /auth/* também: o captcha escalonado do login (F3b) renderiza o Turnstile
  // depois de N falhas de senha — mesma CSP do signup.
  const isSignup   = path === "/signup" || path.startsWith("/signup/") || path.startsWith("/auth/")
  // Página da integração oficial carrega o FB SDK do Embedded Signup → CSP com Meta.
  const isOfficial = path.startsWith("/integracoes/whatsapp-oficial")
  res.headers.set("Content-Security-Policy", isSignup ? CSP_SIGNUP : isOfficial ? CSP_META : CSP_APP)

  // ── Cookie de dispositivo ───────────────────────────────
  // Emitido SÓ nas telas de autenticação (/auth/*), e só em navegação de
  // documento (Accept: text/html).
  //
  // Por que tão restrito: um Set-Cookie numa resposta CACHEÁVEL entregaria o
  // MESMO id de dispositivo a todos os visitantes. Tentar impedir isso com
  // `Cache-Control` daqui não funciona — a rota sobrescreve o header do proxy
  // (verificado em dev). Então a defesa é o escopo: /auth/* é sempre dinâmica e
  // nunca cacheada, e é o único lugar onde o cookie precisa existir ANTES do
  // login. Uma vez emitido, ele acompanha o navegador por 400 dias em todo o app.
  const wantsHtml = req.headers.get("accept")?.includes("text/html") ?? false
  if (wantsHtml && path.startsWith("/auth/") && !req.cookies.has(DEVICE_COOKIE)) {
    res.cookies.set(DEVICE_COOKIE, randomBytes(32).toString("base64url"), {
      httpOnly: true,
      secure:   IS_PROD,
      sameSite: "lax",
      path:     "/",
      maxAge:   DEVICE_MAX_AGE,
    })
  }

  return res
}

export const config = {
  // Aplica em tudo exceto assets estáticos do Next + favicon
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
}
