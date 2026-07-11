// ═══════════════════════════════════════════════════════════════
// POST /api/tasks/cron/reminders — varredura de lembretes de tarefa (CRM)
// ═══════════════════════════════════════════════════════════════
// Chamado pelo pg_cron (via pg_net) a cada poucos minutos. Notifica in-app o
// responsável das tarefas vencidas. FAIL-CLOSED: sem CRON_SECRET correto → 401.

import { NextResponse } from "next/server"
import { runTaskReminderSweep } from "@/lib/crm/task-reminders"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  try {
    const r = await runTaskReminderSweep()
    return NextResponse.json(r)
  } catch (e) {
    console.error("[tasks/cron] sweep falhou:", e instanceof Error ? e.message : e)
    return NextResponse.json({ error: "sweep_failed" }, { status: 500 })
  }
}
