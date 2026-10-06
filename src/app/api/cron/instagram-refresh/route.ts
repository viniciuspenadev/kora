import { NextResponse, type NextRequest } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { executarJob } from "@/lib/cron/run"
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
 * ⚠️ Agendamento é **pg_cron no Supabase** (`net.http_get` + header Authorization).
 * Job `instagram-token-refresh`, "20 8 * * *" (8h20 UTC ≈ 5h20 BRT — depois do
 * trial-housekeeping). Migration: 20260728_cron_instagram_refresh.sql.
 */

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  // 🔑 O nome do job é `instagram-token-refresh`, e a rota é `/instagram-refresh`. Os dois
  //    DIVERGEM — é por isso que o livro é chaveado pelo nome do job, nunca pelo caminho.
  const saida = await executarJob({ job: "instagram-token-refresh" }, async () => {
    const result = await runInstagramTokenRefresh()
    // Independente do refresh: token que não renovou não pode impedir a devolução de cota.
    const { reconciled } = await reconcileStaleIgClaims()
    return {
      processed: result.refreshed,
      failed:    result.failed,
      meta:      { checked: result.checked, skipped: result.skipped, reconciled },
    }
  })

  if (saida.pulado) return NextResponse.json({ ok: true, pulado: "já em execução" })

  console.log("[cron/instagram-refresh]", JSON.stringify(saida.resultado))
  return NextResponse.json({ ok: true, ...saida.resultado })
}
