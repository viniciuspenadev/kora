"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"

// ─────────────────────────────────────────────────────────────────
// Jornada do fluxo (F2/§CC) — agrega studio_flow_steps em:
//  • por NÓ: quantos chegaram (reached)
//  • por ARESTA (de→para): quantos seguiram por ali → CTR do ramo
//  • runs distintos (denominador do funil)
// Consumido pelas MÉTRICAS NO CANVAS (F4). Gated owner/admin + ai_studio.
// v1: agrega em memória (cap 20k passos); vira RPC/materialized se o volume pedir.
// ─────────────────────────────────────────────────────────────────

export interface FlowJourney {
  /** node_id → nº de entradas (reached). */
  nodes: Record<string, number>
  /** "from->to" → nº de transições (base do CTR do ramo). */
  edges: Record<string, number>
  /** runs distintos no recorte (denominador). */
  totalRuns: number
  /** true quando o recorte estourou o cap (números são amostra). */
  capped: boolean
}

export async function getFlowJourney(
  flowId: string,
  opts?: { from?: string; to?: string; campaignId?: string | null },
): Promise<FlowJourney | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  if (!["owner", "admin"].includes(session.user.role)) return { error: "Sem permissão" }
  if (!(await hasModule(session.user.tenantId, "ai_studio"))) return { error: "Studio não habilitado" }
  const t = session.user.tenantId

  const CAP = 20000
  let q = supabaseAdmin.from("studio_flow_steps")
    .select("run_id, node_id, entered_from")
    .eq("tenant_id", t).eq("flow_id", flowId)
    .order("at", { ascending: false }).limit(CAP)
  if (opts?.from) q = q.gte("at", opts.from)
  if (opts?.to)   q = q.lte("at", opts.to)
  if (opts?.campaignId) q = q.eq("campaign_id", opts.campaignId)

  const { data, error } = await q
  if (error) return { error: error.message }
  const rows = (data ?? []) as { run_id: string; node_id: string; entered_from: string | null }[]

  const nodes: Record<string, number> = {}
  const edges: Record<string, number> = {}
  const runs = new Set<string>()
  for (const r of rows) {
    nodes[r.node_id] = (nodes[r.node_id] ?? 0) + 1
    if (r.entered_from) {
      const key = `${r.entered_from}->${r.node_id}`
      edges[key] = (edges[key] ?? 0) + 1
    }
    runs.add(r.run_id)
  }
  return { nodes, edges, totalRuns: runs.size, capped: rows.length >= CAP }
}
