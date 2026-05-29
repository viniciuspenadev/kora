// ═══════════════════════════════════════════════════════════════
// Middleware global — security headers
// ═══════════════════════════════════════════════════════════════
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

const SUPABASE_HOST  = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/^https?:\/\//, "")
const SUPABASE_WS    = SUPABASE_HOST ? `wss://${SUPABASE_HOST}` : ""
const SUPABASE_HTTPS = SUPABASE_HOST ? `https://${SUPABASE_HOST}` : ""

const CSP_APP = [
  "default-src 'self'",
  // 'unsafe-eval' temporariamente por Next 16 + React 19 dev/hydration; remover em S2.1
  `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
  // 'unsafe-inline' style por styled-jsx + Tailwind runtime; remover em S2.1
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  // Áudio/vídeo do Supabase Storage (signed URLs) — sem media-src cai em default-src e bloqueia
  `media-src 'self' blob: ${SUPABASE_HTTPS}`.trim(),
  // Supabase REST + Realtime + Storage; OpenAI direto não chamamos do client
  `connect-src 'self' ${SUPABASE_HTTPS} ${SUPABASE_WS}`.trim(),
  // 'self' permite iframes da própria app (ex: preview de email em /admin/emails).
  // Mantém proteção anti-clickjacking de origens externas.
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ")

const PERMISSIONS_POLICY = [
  "camera=()",
  // self = inbox grava voice notes via getUserMedia. Sem iframes/cross-origin.
  "microphone=(self)",
  "geolocation=()",
  "interest-cohort=()",
  "browsing-topics=()",
].join(", ")

export function middleware(req: NextRequest) {
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
  res.headers.set("Content-Security-Policy", CSP_APP)

  return res
}

export const config = {
  // Aplica em tudo exceto assets estáticos do Next + favicon
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
}
