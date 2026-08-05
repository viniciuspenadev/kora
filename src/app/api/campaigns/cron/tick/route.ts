// ═══════════════════════════════════════════════════════════════
// POST /api/campaigns/cron/tick — motor de disparo de campanhas (F2b)
// ═══════════════════════════════════════════════════════════════
// Chamado pelo pg_cron (via pg_net) a cada minuto. Processa as campanhas
// `running` cujo próximo lote venceu, enviando o lote (tamanho×intervalo×
// jitter) com teto de tier fail-closed. Sem CRON_SECRET correto → 401.

import { NextResponse } from "next/server"
import { runCampaignTick } from "@/lib/campaigns/engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Um lote pode levar alguns segundos (jitter entre mensagens) — folga no tempo.
export const maxDuration = 60

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  try {
    const r = await runCampaignTick()
    return NextResponse.json(r)
  } catch (e) {
    console.error("[campaigns/cron/tick]", (e as Error).message)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
