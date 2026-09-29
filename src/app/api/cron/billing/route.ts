import { NextResponse, type NextRequest } from "next/server"
import { runMonthlyBilling } from "@/lib/billing"
import { requireCronSecret } from "@/lib/cron-auth"
import { executarJob } from "@/lib/cron/run"

/**
 * GET /api/cron/billing
 *
 * Geração mensal automática de faturas. Roda 1x/dia; gera a fatura dos tenants
 * cujo billing_day == dia de hoje (UTC), ativos, com plano e assinatura não-cancelada.
 *
 * Autentica via Bearer CRON_SECRET, enviado pelo pg_cron (lido do Vault do Supabase).
 * Idempotente: generateInvoiceForTenant recusa fatura duplicada por período.
 *
 * Agendamento REAL: job `billing-monthly` no pg_cron do Supabase, "0 9 * * *" (9h UTC =
 * 6h BRT). Ver `supabase/migrations/20260806_cron_secret_to_vault.sql`.
 * ⚠️ Não há `vercel.json` neste projeto e nunca houve — rodamos Node standalone em
 *    container. Instrução apontando pra Vercel manda o próximo leitor pro lugar errado.
 */

// ⚠️ `maxDuration` SAIU (10/08). Ele é diretiva da Vercel e é **inerte** no nosso runtime
//    (`output: "standalone"` + `node server.js` no EasyPanel) — declarar um teto que não
//    existe é pior que não ter: alguém lê e acredita. O tempo real de execução passa a
//    viver em `cron_runs.meta.ms`.
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  // 🔑 `job` é o nome em `cron.job` — `billing-monthly`, NÃO o caminho da rota. Os dois
  //    divergem, e registro chaveado por rota rotula errado justo na hora de investigar.
  const saida = await executarJob({ job: "billing-monthly" }, async () => {
    const r = await runMonthlyBilling()
    return { processed: r.generated, failed: r.failed, meta: { skipped: r.skipped } }
  })

  if (saida.pulado) return NextResponse.json({ ok: true, pulado: "já em execução" })

  console.log("[cron/billing]", JSON.stringify(saida.resultado))
  return NextResponse.json({ ok: true, ...saida.resultado })
}
