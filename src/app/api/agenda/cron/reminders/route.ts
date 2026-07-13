// ═══════════════════════════════════════════════════════════════
// POST /api/agenda/cron/reminders — varredura de lembretes da Agenda
// ═══════════════════════════════════════════════════════════════
// Chamado pelo pg_cron (via pg_net) a cada poucos minutos. Dispara os
// steps de lembrete (offset < 0) que venceram, dos tenants que ligaram
// os avisos automáticos. FAIL-CLOSED: sem CRON_SECRET correto → 401.

import { NextResponse } from "next/server"
import { runAgendaReminderSweep } from "@/lib/agenda/reminders"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  try {
    const r = await runAgendaReminderSweep()
    return NextResponse.json(r)
  } catch (e) {
    console.error("[agenda/cron] sweep falhou:", e instanceof Error ? e.message : e)
    return NextResponse.json({ error: "sweep_failed" }, { status: 500 })
  }
}
