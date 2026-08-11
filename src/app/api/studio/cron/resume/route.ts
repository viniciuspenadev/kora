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
import { requireCronSecret } from "@/lib/cron-auth"
import { executarJob } from "@/lib/cron/run"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BATCH = 50

export async function POST(req: Request): Promise<Response> {
  const negado = requireCronSecret(req)
  if (negado) return negado

  // 🔴 `travar: false` pelo mesmo motivo do motor de campanhas: cadência de 1 minuto com
  //    lote de 50 runs que fazem chamada de LLM — sobreposição é normal, e travar por nome
  //    de job faria um lote lento pular os ticks seguintes inteiros.
  const saida = await executarJob({ job: "studio-wait-resume", travar: false }, () => retomar())
  return NextResponse.json(saida.pulado ? { pulado: true } : saida.resultado?.meta)
}

async function retomar() {
  const nowIso = new Date().toISOString()
  const { data: due, error } = await supabaseAdmin
    .from("studio_flow_runs")
    .select("id, tenant_id, conversation_id")
    .eq("status", "waiting")
    .not("resume_at", "is", null)
    .lte("resume_at", nowIso)
    .order("resume_at", { ascending: true })
    .limit(MAX_BATCH)

  // 🔑 LANÇA em vez de responder: quem monta a resposta HTTP agora é o handler, e o
  //    invólucro precisa VER a falha pra registrar a corrida como `failed`. Devolver um
  //    500 daqui faria o livro registrar "ok" sobre um tick que não leu nada.
  if (error) throw new Error(`leitura dos runs falhou: ${error.message}`)

  const runs = due ?? []

  // 🔒 STATUS DO CLIENTE (docs/entitlements-design.md §3 · security.md §0.1). Retomar um
  // run parado continua o fluxo de onde ele estava: LLM + envio, tudo no nosso custo.
  const { serviceable, degraded } = await filterServiceableTenants(runs.map((r) => r.tenant_id))
  // 🔴 `degraded` = consulta falhou. Aborta em vez de filtrar: `resumeStudioRun` avança o
  //    estado do run (persistente). Deixar `waiting` é reversível — o próximo tick retoma.
  if (degraded) {
    console.error("[studio/cron] status dos tenants indisponível — retomada abortada")
    // 🔴 `partial`, NÃO `ok` (revisão 11/08). Sem `status`, o invólucro assume `ok` — e
    //    aí uma falha persistente de `filterServiceableTenants` gravaria 1.440 corridas
    //    "em dia" por dia enquanto NENHUM fluxo de Studio retoma, para nenhum cliente.
    //    "ok" sobre trabalho que não aconteceu é a definição exata do problema que o
    //    livro veio resolver.
    return { status: "partial" as const, processed: 0, meta: { checked: 0, resumed: 0, degraded: true } }
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

  return { processed: resumed, meta: { checked: runs.length, resumed } }
}
