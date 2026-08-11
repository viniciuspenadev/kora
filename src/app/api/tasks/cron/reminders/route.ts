// ═══════════════════════════════════════════════════════════════
// POST /api/tasks/cron/reminders — varredura de lembretes de tarefa (CRM)
// ═══════════════════════════════════════════════════════════════
// Chamado pelo pg_cron (via pg_net) a cada poucos minutos. Notifica in-app o
// responsável das tarefas vencidas. FAIL-CLOSED: sem CRON_SECRET correto → 401.

import { NextResponse } from "next/server"
import { runTaskReminderSweep } from "@/lib/crm/task-reminders"
import { requireCronSecret } from "@/lib/cron-auth"
import { executarJob } from "@/lib/cron/run"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request): Promise<Response> {
  const negado = requireCronSecret(req)
  if (negado) return negado
  try {
    const saida = await executarJob({ job: "crm-task-reminders-sweep" }, async () => {
      const r = await runTaskReminderSweep()
      return { processed: r.notified, meta: { notified: r.notified, skipped: r.skipped } }
    })
    return NextResponse.json(saida.pulado ? { pulado: true } : saida.resultado?.meta)
  } catch (e) {
    console.error("[tasks/cron] sweep falhou:", e instanceof Error ? e.message : e)
    return NextResponse.json({ error: "sweep_failed" }, { status: 500 })
  }
}
