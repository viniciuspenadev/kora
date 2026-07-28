import { NextResponse, type NextRequest } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { runTrialHousekeeping } from "@/lib/trial-housekeeping"

/**
 * GET /api/cron/trial-housekeeping
 *
 * Roda 1x/dia. Suspende trials vencidos (active=false + lifecycle=suspended) e
 * purga PII de cadastros consumidos/expirados (LGPD). Autentica via CRON_SECRET.
 *
 * Schedule sugerido: "5 8 * * *" (5h08 UTC ≈ 5h BRT — fora do horário de pico).
 */

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  const startedAt = Date.now()
  const result = await runTrialHousekeeping()
  const elapsedMs = Date.now() - startedAt

  console.log("[cron/trial-housekeeping]", JSON.stringify({ elapsedMs, ...result }))
  return NextResponse.json({ ok: true, elapsedMs, ...result })
}
