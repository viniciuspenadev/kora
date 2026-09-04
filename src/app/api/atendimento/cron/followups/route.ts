// ═══════════════════════════════════════════════════════════════
// POST /api/atendimento/cron/followups — despertador do follow-up
// ═══════════════════════════════════════════════════════════════
// Chamado pelo pg_cron (via pg_net) a cada 5 min. Cutuca quem prometeu voltar
// numa conversa e já passou da hora. Não fala com o cliente.
// FAIL-CLOSED: sem CRON_SECRET correto no header → 401.

import { NextResponse } from "next/server"
import { runFollowUpSweep } from "@/lib/atendimento/followup-sweep"
import { requireCronSecret } from "@/lib/cron-auth"
import { executarJob } from "@/lib/cron/run"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request): Promise<Response> {
  const negado = requireCronSecret(req)
  if (negado) return negado
  try {
    const saida = await executarJob({ job: "atendimento-followup-sweep" }, async () => {
      const r = await runFollowUpSweep()
      return { processed: r.fired + r.answered, meta: r }
    })
    return NextResponse.json(saida.pulado ? { pulado: true } : saida.resultado?.meta)
  } catch (e) {
    console.error("[followup/cron] sweep falhou:", e instanceof Error ? e.message : e)
    return NextResponse.json({ error: "sweep_failed" }, { status: 500 })
  }
}
