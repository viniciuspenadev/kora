// ═══════════════════════════════════════════════════════════════
// POST /api/studio/cron/inactivity — dispara fluxos de INATIVIDADE (gatilho Automático)
// ═══════════════════════════════════════════════════════════════
// Chamado pelo pg_cron (via pg_net) a cada 5 min. Acha conversas paradas
// (nossa última msg, antiga, sem dono humano) e dispara o fluxo com gatilho
// de inatividade. Toda a lógica em @/lib/ai-v2/flow/inactivity.
// FAIL-CLOSED: sem CRON_SECRET correto no header → 401 (nunca público).

import { NextResponse } from "next/server"
import { runInactivityTick } from "@/lib/ai-v2/flow/inactivity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  try {
    const r = await runInactivityTick()
    return NextResponse.json(r)
  } catch (e) {
    console.error("[studio/cron/inactivity]", e instanceof Error ? e.message : e)
    return NextResponse.json({ error: e instanceof Error ? e.message : "erro" }, { status: 500 })
  }
}
