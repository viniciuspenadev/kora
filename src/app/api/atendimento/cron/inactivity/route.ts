// ═══════════════════════════════════════════════════════════════
// POST /api/atendimento/cron/inactivity — varredura de inatividade
// ═══════════════════════════════════════════════════════════════
// Chamado pelo pg_cron (via pg_net) a cada poucos minutos. Aplica a
// política de inatividade dos tenants que a ativaram.
// FAIL-CLOSED: sem CRON_SECRET correto no header → 401.

import { NextResponse } from "next/server"
import { runInactivitySweep } from "@/lib/atendimento/inactivity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  try {
    const r = await runInactivitySweep()
    return NextResponse.json(r)
  } catch (e) {
    console.error("[atendimento/cron] sweep falhou:", e instanceof Error ? e.message : e)
    return NextResponse.json({ error: "sweep_failed" }, { status: 500 })
  }
}
