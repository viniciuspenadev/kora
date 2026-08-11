// ═══════════════════════════════════════════════════════════════
// POST /api/campaigns/cron/tick — motor de disparo de campanhas (F2b)
// ═══════════════════════════════════════════════════════════════
// Chamado pelo pg_cron (via pg_net) a cada minuto. Processa as campanhas
// `running` cujo próximo lote venceu, enviando o lote (tamanho×intervalo×
// jitter) com teto de tier fail-closed. Sem CRON_SECRET correto → 401.

import { NextResponse } from "next/server"
import { runCampaignTick } from "@/lib/campaigns/engine"
import { requireCronSecret } from "@/lib/cron-auth"
import { executarJob } from "@/lib/cron/run"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// ⚠️ `maxDuration` saiu: diretiva da Vercel, inerte no runtime standalone. Um lote leva
//    mesmo alguns segundos (jitter entre mensagens) — o tempo real agora é medido em
//    `cron_runs.meta.ms`, em vez de prometido por uma constante que ninguém aplica.

export async function POST(req: Request): Promise<Response> {
  const negado = requireCronSecret(req)
  if (negado) return negado

  try {
    // 🔴 `travar: false` — E ISSO NÃO É DESCUIDO. Este job roda a cada minuto e um lote
    //    leva legitimamente ~104 s (200 mensagens × jitter), então sobreposição é
    //    operação NORMAL aqui. E ele já tem trava própria, e MELHOR: empurra
    //    `next_batch_at` 180 s à frente **antes** de enviar — trava **por campanha**.
    //    Uma trava global por nome de job é mais grossa: um lote lento do cliente A
    //    bloquearia B..T de enviarem qualquer coisa. Trava pior por cima de trava melhor
    //    é regressão, não segurança.
    const saida = await executarJob({ job: "campaigns-engine-tick", travar: false }, async () => {
      const r = await runCampaignTick()
      // `processed` = mensagens ENVIADAS (o que custou dinheiro), não campanhas visitadas.
      return { processed: r.sent, meta: { campanhas: r.processed, enviadas: r.sent } }
    })
    return NextResponse.json(saida.pulado ? { pulado: true } : saida.resultado?.meta)
  } catch (e) {
    console.error("[campaigns/cron/tick]", (e as Error).message)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
