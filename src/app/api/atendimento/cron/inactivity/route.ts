// ═══════════════════════════════════════════════════════════════
// POST /api/atendimento/cron/inactivity — varredura de inatividade
// ═══════════════════════════════════════════════════════════════
// Chamado pelo pg_cron (via pg_net) a cada poucos minutos. Aplica a
// política de inatividade dos tenants que a ativaram.
// FAIL-CLOSED: sem CRON_SECRET correto no header → 401.

import { NextResponse } from "next/server"
import { runInactivitySweep } from "@/lib/atendimento/inactivity"
import { runWindowExpirySweep } from "@/lib/atendimento/window-sweep"
import { requireCronSecret } from "@/lib/cron-auth"
import { executarJob } from "@/lib/cron/run"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request): Promise<Response> {
  const negado = requireCronSecret(req)
  if (negado) return negado
  try {
    const saida = await executarJob({ job: "atendimento-inactivity-sweep" }, async () => {
      const r = await runInactivitySweep()
      // Janela oficial expirada (métrica pura, fail-open) — pega carona no mesmo cron;
      // uma falha aqui não derruba a varredura de inatividade (que já rodou).
      let windows = 0
      try { windows = (await runWindowExpirySweep()).swept } catch (e) {
        console.error("[atendimento/cron] window sweep falhou:", e instanceof Error ? e.message : e)
      }
      return { processed: r.swept + windows, meta: { ...r, windows_expired: windows } }
    })
    return NextResponse.json(saida.pulado ? { pulado: true } : saida.resultado?.meta)
  } catch (e) {
    console.error("[atendimento/cron] sweep falhou:", e instanceof Error ? e.message : e)
    return NextResponse.json({ error: "sweep_failed" }, { status: 500 })
  }
}
