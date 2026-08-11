import { NextResponse, type NextRequest } from "next/server"
import { sendDailyReports } from "@/lib/reports/daily"
import { requireCronSecret } from "@/lib/cron-auth"
import { executarJob } from "@/lib/cron/run"

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

// ⚠️ `maxDuration` saiu: é diretiva da Vercel e inerte no nosso runtime standalone.
//    O tempo real passa a viver em `cron_runs.meta.ms`.
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  const saida = await executarJob({ job: "daily-reports" }, async () => {
    const results = await sendDailyReports()
    return {
      processed: results.filter((r) => r.status === "sent").length,
      failed:    results.filter((r) => r.status === "failed").length,
      // 🔒 Só CONTAGEM no livro. `results` traz linha por tenant e é o tipo de coisa que
      //    engorda `meta` sem responder nada — a resposta HTTP continua completa.
      meta:      { total: results.length, skipped: results.filter((r) => r.status === "skipped").length },
    }
  })

  if (saida.pulado) return NextResponse.json({ ok: true, pulado: "já em execução" })

  console.log("[cron/daily-reports]", JSON.stringify(saida.resultado))
  return NextResponse.json({ ok: true, ...saida.resultado })
}
