// ═══════════════════════════════════════════════════════════════
// Rate-limit em memória — token bucket por chave
// ═══════════════════════════════════════════════════════════════
// MVP single-instance. Funciona com Easypanel rodando uma réplica.
//
// Upgrade pra multi-réplica (futuro): trocar o Map por Upstash Redis
// ou Supabase via RPC (`SELECT pg_advisory_xact_lock` + tabela).
// Interface da função mantém igual — só muda o backing store.

import type { NextRequest } from "next/server"

interface Bucket {
  tokens:   number
  resetAt:  number   // epoch ms quando o bucket é resetado
}

const buckets = new Map<string, Bucket>()

// Cleanup de buckets stale a cada 10min (sem await, fire-and-forget)
let cleanupStarted = false
function startCleanup() {
  if (cleanupStarted) return
  cleanupStarted = true
  setInterval(() => {
    const now = Date.now()
    for (const [key, b] of buckets) {
      if (b.resetAt < now - 3_600_000) buckets.delete(key) // 1h sem uso
    }
  }, 600_000)
}

/**
 * Rate-limit por janela fixa.
 *
 * @param key      Chave única (ex: "site:lead:1.2.3.4")
 * @param max      Quantos requests permitidos
 * @param windowMs Janela em ms
 * @returns        { ok, remaining, retryAfterSec }
 */
export function rateLimit(
  key:      string,
  max:      number,
  windowMs: number,
): { ok: boolean; remaining: number; retryAfterSec: number } {
  startCleanup()
  const now = Date.now()
  const existing = buckets.get(key)

  if (!existing || existing.resetAt < now) {
    // Nova janela
    buckets.set(key, { tokens: max - 1, resetAt: now + windowMs })
    return { ok: true, remaining: max - 1, retryAfterSec: 0 }
  }

  if (existing.tokens <= 0) {
    return {
      ok:            false,
      remaining:     0,
      retryAfterSec: Math.ceil((existing.resetAt - now) / 1000),
    }
  }

  existing.tokens--
  return { ok: true, remaining: existing.tokens, retryAfterSec: 0 }
}

/**
 * Extrai IP do request — confia em X-Forwarded-For (Easypanel/Cloudflare populam).
 * Em ambientes sem proxy reverso, cai pra "unknown" (acaba todo mundo no mesmo bucket).
 */
export function getClientIp(req: NextRequest | Request): string {
  const fwd = req.headers.get("x-forwarded-for")
  if (fwd) {
    // X-Forwarded-For pode ter múltiplos IPs (cadeia de proxies). Primeiro é o cliente.
    const first = fwd.split(",")[0]?.trim()
    if (first) return first
  }
  const real = req.headers.get("x-real-ip")
  if (real) return real
  const cfIp = req.headers.get("cf-connecting-ip")
  if (cfIp) return cfIp
  return "unknown"
}

/**
 * Resposta 429 padronizada com headers Retry-After + CORS aberto pro widget.
 */
export function rateLimitResponse(retryAfterSec: number): Response {
  return new Response(
    JSON.stringify({ error: "Muitas requisições. Tente novamente em alguns instantes." }),
    {
      status: 429,
      headers: {
        "Content-Type":                    "application/json",
        "Retry-After":                     String(Math.max(1, retryAfterSec)),
        "Access-Control-Allow-Origin":     "*",
        "Access-Control-Allow-Methods":    "POST, GET, OPTIONS",
      },
    },
  )
}
