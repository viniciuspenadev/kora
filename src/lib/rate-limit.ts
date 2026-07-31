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

// H-09 (DoS): teto DURO do nº de buckets. O sweep periódico (10min) só tira ociosos >1h —
// durante um flood ATIVO de chaves únicas (janelas frescas < 1h), o Map cresceria sem limite
// até OOM antes do próximo sweep. Este teto reclama memória na hora, sob ataque.
const MAX_BUCKETS = Math.max(1000, Number(process.env.RATE_LIMIT_MAX_BUCKETS ?? 50_000) || 50_000)

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
 * Mantém o Map abaixo do teto (só age quando ESTOURA — custo zero no caminho normal).
 * (1) varre expirados (janela já fechada) — remoção barata, não afeta quem está ativo.
 * (2) ainda cheio (flood de >MAX_BUCKETS chaves DENTRO da janela)? remove os mais próximos de
 *     expirar até 90% do teto (headroom p/ ~10% inserts antes do próximo evict → amortiza o
 *     sort a ~O(log n)/insert). Evict de chave de flood não ajuda o atacante: sob flood de
 *     chaves ÚNICAS ele não re-bate a mesma chave, então perder o bucket dele é inócuo.
 */
function evictIfNeeded(now: number) {
  if (buckets.size < MAX_BUCKETS) return
  for (const [key, b] of buckets) {
    if (b.resetAt < now) buckets.delete(key)
  }
  if (buckets.size < MAX_BUCKETS) return
  const sorted = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)
  const target = Math.floor(MAX_BUCKETS * 0.9)
  for (let i = 0; i < sorted.length && buckets.size > target; i++) {
    buckets.delete(sorted[i][0])
  }
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
    // Nova janela — só aqui o Map PODE crescer, então é o ponto certo pra checar o teto.
    if (!existing) evictIfNeeded(now)
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
  return getClientIpFromHeaders(req.headers)
}

/** Variante pra server actions (headers() devolve Headers, não um Request). */
export function getClientIpFromHeaders(headers: { get(name: string): string | null }): string {
  const fwd = headers.get("x-forwarded-for")
  if (fwd) {
    // NÃO confiar no 1º IP do XFF (fornecido pelo cliente, spoofável). O proxy confiável
    // (Traefik/EasyPanel/Cloudflare) ANEXA o IP real à DIREITA → pega o N-ésimo do fim,
    // N = nº de proxies confiáveis (XFF_TRUSTED_HOPS, default 1). Espelha o signup.
    const parts = fwd.split(",").map((s) => s.trim()).filter(Boolean)
    if (parts.length) {
      const hops = Math.max(1, parseInt(process.env.XFF_TRUSTED_HOPS ?? "1", 10) || 1)
      return parts[Math.max(0, parts.length - hops)]
    }
  }
  const real = headers.get("x-real-ip")
  if (real) return real
  const cfIp = headers.get("cf-connecting-ip")
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
