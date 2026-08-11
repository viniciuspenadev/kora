// ═══════════════════════════════════════════════════════════════
// POST /api/agenda/cron/reminders — varredura de lembretes da Agenda
// ═══════════════════════════════════════════════════════════════
// Chamado pelo pg_cron (via pg_net) a cada poucos minutos. Dispara os
// steps de lembrete (offset < 0) que venceram, dos tenants que ligaram
// os avisos automáticos. FAIL-CLOSED: sem CRON_SECRET correto → 401.

import { NextResponse } from "next/server"
import { runAgendaReminderSweep } from "@/lib/agenda/reminders"
import { requireCronSecret } from "@/lib/cron-auth"
import { executarJob } from "@/lib/cron/run"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request): Promise<Response> {
  const negado = requireCronSecret(req)
  if (negado) return negado
  try {
    const saida = await executarJob({ job: "agenda-reminders-sweep" }, async () => {
      const r = await runAgendaReminderSweep()
      return { processed: r.processed, meta: { ...r } }
    })
    return NextResponse.json(saida.pulado ? { pulado: true } : saida.resultado?.meta)
  } catch (e) {
    console.error("[agenda/cron] sweep falhou:", e instanceof Error ? e.message : e)
    return NextResponse.json({ error: "sweep_failed" }, { status: 500 })
  }
}
