import { NextResponse, type NextRequest } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { runInstagramTokenRefresh } from "@/lib/instagram/refresh"

/**
 * GET /api/cron/instagram-refresh
 *
 * Roda 1x/dia. Renova os tokens do Instagram que vencem nos próximos 15 dias — sem isso,
 * toda conexão de cliente morre sozinha ~60 dias após conectar, calada. Autentica via
 * CRON_SECRET.
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
  const elapsedMs = Date.now() - startedAt

  console.log("[cron/instagram-refresh]", JSON.stringify({ elapsedMs, ...result }))
  return NextResponse.json({ ok: true, elapsedMs, ...result })
}
