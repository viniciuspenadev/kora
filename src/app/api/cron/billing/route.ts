import { NextResponse, type NextRequest } from "next/server"
import { runMonthlyBilling } from "@/lib/billing"

/**
 * GET /api/cron/billing
 *
 * Geração mensal automática de faturas. Roda 1x/dia; gera a fatura dos tenants
 * cujo billing_day == dia de hoje (UTC), ativos, com plano e assinatura não-cancelada.
 *
 * Autentica via Bearer CRON_SECRET (Vercel envia auto; outros hosts configuram externo).
 * Idempotente: generateInvoiceForTenant recusa fatura duplicada por período.
 *
 * Schedule sugerido (vercel.json): { "path": "/api/cron/billing", "schedule": "0 9 * * *" }
 * (9h UTC = 6h BRT — gera cedo, antes do expediente.)
 */

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get("authorization")
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const startedAt = Date.now()
  const result = await runMonthlyBilling()
  const elapsedMs = Date.now() - startedAt

  console.log("[cron/billing]", JSON.stringify({ elapsedMs, generated: result.generated, skipped: result.skipped, failed: result.failed }))

  return NextResponse.json({ ok: true, elapsedMs, ...result })
}
