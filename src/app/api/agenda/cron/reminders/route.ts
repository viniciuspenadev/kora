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
      // 🔴 CAMPOS ALISTADOS, NÃO `{ ...r }` (revisão 11/08). Espalhar o objeto interno
      //    numa coluna PERSISTIDA é espalhamento cego: hoje todos os seis jobs devolvem
      //    só contadores, mas no dia em que alguém acrescentar `errosPorTenant: [...]` ou
      //    `destinatarios: [...]` naquele retorno, isso entra no livro sem ninguém
      //    decidir. O redator é o único anteparo e ele pega padrão, não semântica.
      //    Alistar custa uma linha por job e fecha a classe inteira.
      return { processed: r.processed, meta: { tenants: r.tenants, processed: r.processed } }
    })
    return NextResponse.json(saida.pulado ? { pulado: true } : saida.resultado?.meta)
  } catch (e) {
    console.error("[agenda/cron] sweep falhou:", e instanceof Error ? e.message : e)
    return NextResponse.json({ error: "sweep_failed" }, { status: 500 })
  }
}
