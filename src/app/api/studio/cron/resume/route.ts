// ═══════════════════════════════════════════════════════════════
// POST /api/studio/cron/resume — acorda fluxos "adormecidos" (nó wait)
// ═══════════════════════════════════════════════════════════════
// Chamado pelo pg_cron (via pg_net) a cada minuto. Seleciona os runs
// vencidos (status=waiting, resume_at <= agora) e continua cada um.
// FAIL-CLOSED: sem CRON_SECRET correto no header → 401 (nunca público).

import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { filterServiceableTenants } from "@/lib/auth/tenant-serviceable"
import { resumeStudioRun } from "@/lib/ai-v2/run"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BATCH = 50

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const nowIso = new Date().toISOString()
  const { data: due, error } = await supabaseAdmin
    .from("studio_flow_runs")
    .select("id, tenant_id, conversation_id")
    .eq("status", "waiting")
    .not("resume_at", "is", null)
    .lte("resume_at", nowIso)
    .order("resume_at", { ascending: true })
    .limit(MAX_BATCH)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const runs = due ?? []

  // 🔒 STATUS DO CLIENTE (docs/entitlements-design.md §3 · security.md §0.1). Retomar um
  // run parado continua o fluxo de onde ele estava: LLM + envio, tudo no nosso custo.
  const { serviceable, degraded } = await filterServiceableTenants(runs.map((r) => r.tenant_id))
  // 🔴 `degraded` = consulta falhou. Aborta em vez de filtrar: `resumeStudioRun` avança o
  //    estado do run (persistente). Deixar `waiting` é reversível — o próximo tick retoma.
  if (degraded) {
    console.error("[studio/cron] status dos tenants indisponível — retomada abortada")
    return NextResponse.json({ checked: 0, resumed: 0, degraded: true })
  }

  let resumed = 0
  for (const r of runs) {
    if (!serviceable.has(r.tenant_id)) continue
    try {
      const res = await resumeStudioRun(r.tenant_id, r.conversation_id)
      if (res.status !== "skipped") resumed++
    } catch (e) {
      console.error("[studio/cron] resume falhou:", r.id, e instanceof Error ? e.message : e)
    }
  }

  return NextResponse.json({ checked: runs.length, resumed })
}
