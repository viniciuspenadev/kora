import { NextResponse, type NextRequest } from "next/server"
import { sendDailyReports } from "@/lib/reports/daily"

/**
 * GET /api/cron/daily-reports
 *
 * Cron diário às 18h BRT. Autentica via Bearer CRON_SECRET (Vercel envia auto;
 * em EasyPanel/outros hosts, configurar o cron externamente passando header).
 *
 * Idempotente: usa tenant_config.daily_report_last_sent_at pra não duplicar.
 *
 * Schedule no vercel.json:
 *   { "path": "/api/cron/daily-reports", "schedule": "0 21 * * *" }
 *   (21h UTC = 18h BRT)
 */

export const dynamic = "force-dynamic"
export const maxDuration = 60  // até 1min de execução (orquestra todos tenants)

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get("authorization")
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const startedAt = Date.now()
  const results = await sendDailyReports()
  const elapsedMs = Date.now() - startedAt

  // Sumário pra logs do scheduler
  const summary = {
    elapsedMs,
    total:   results.length,
    sent:    results.filter((r) => r.status === "sent").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed:  results.filter((r) => r.status === "failed").length,
  }

  console.log("[cron/daily-reports]", JSON.stringify(summary))

  return NextResponse.json({ ok: true, summary, results })
}
