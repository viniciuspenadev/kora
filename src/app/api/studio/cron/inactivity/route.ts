// ═══════════════════════════════════════════════════════════════
// POST /api/studio/cron/inactivity — dispara fluxos de INATIVIDADE (gatilho Automático)
// ═══════════════════════════════════════════════════════════════
// Chamado pelo pg_cron (via pg_net) a cada 5 min. Acha conversas paradas
// (nossa última msg, antiga, sem dono humano) e dispara o fluxo com gatilho
// de inatividade. Toda a lógica em @/lib/ai-v2/flow/inactivity.
// FAIL-CLOSED: sem CRON_SECRET correto no header → 401 (nunca público).

import { NextResponse } from "next/server"
import { runInactivityTick } from "@/lib/ai-v2/flow/inactivity"
import { requireCronSecret } from "@/lib/cron-auth"
import { executarJob } from "@/lib/cron/run"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request): Promise<Response> {
  const negado = requireCronSecret(req)
  if (negado) return negado

  try {
    const saida = await executarJob({ job: "studio-inactivity-tick" }, async () => {
      const r = await runInactivityTick()
      return { processed: r.fired, meta: { flows: r.flows, fired: r.fired } }
    })
    return NextResponse.json(saida.pulado ? { pulado: true } : saida.resultado?.meta)
  } catch (e) {
    console.error("[studio/cron/inactivity]", e instanceof Error ? e.message : e)
    return NextResponse.json({ error: e instanceof Error ? e.message : "erro" }, { status: 500 })
  }
}
