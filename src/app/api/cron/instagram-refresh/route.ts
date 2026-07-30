import { NextResponse, type NextRequest } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { runInstagramTokenRefresh, reconcileStaleIgClaims } from "@/lib/instagram/refresh"

/**
 * GET /api/cron/instagram-refresh
 *
 * Roda 1x/dia. Duas manutenções do canal Instagram, ambas de silêncio caro:
 *
 *  1. **Tokens** — renova o que vence nos próximos 15 dias; sem isso toda conexão de
 *     cliente morre sozinha ~60 dias após conectar, calada.
 *  2. **Claim órfão** — o ledger de automações é claim-first (grava antes de chamar a
 *     Meta). Processo morto no meio deixa a linha `claimed` pra sempre, e `claimed` é
 *     status COBRÁVEL: sem reconciliar, o órfão queima cota paga do cliente até o fim do
 *     ciclo. Vira `failed` (não cobrável) e a cota volta.
 *
 * Autentica via CRON_SECRET.
 *
 * ⚠️ Agendamento é **pg_cron no Supabase** (`net.http_get` + header Authorization), não
 * Vercel. Job `instagram-token-refresh`, "20 8 * * *" (8h20 UTC ≈ 5h20 BRT — depois do
 * trial-housekeeping). Migration: 20260728_cron_instagram_refresh.sql.
 */

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  const startedAt = Date.now()
  const result = await runInstagramTokenRefresh()
  // Independente do refresh: token que não renovou não pode impedir a devolução de cota.
  const { reconciled } = await reconcileStaleIgClaims()
  const elapsedMs = Date.now() - startedAt

  console.log("[cron/instagram-refresh]", JSON.stringify({ elapsedMs, ...result, reconciled }))
  return NextResponse.json({ ok: true, elapsedMs, ...result, reconciled })
}
