import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import type { FlowGraph, MoveStageNodeConfig } from "@/lib/ai-v2/flow/types"

/** Nó Mover etapa só publica apontando para uma etapa que existe, está visível no kanban
 *  e é deste tenant. Nó antigo (só nome) publica se o nome não for ambíguo entre kanbans —
 *  senão o motor falharia na hora do cliente, em silêncio para quem montou o fluxo. */
export async function validateMoveStagePublish(tenantId: string, graph: FlowGraph): Promise<string | null> {
  const nodes = graph.nodes.filter(n => n.type === "move_stage")
  if (!nodes.length) return null
  const { data, error } = await supabaseAdmin.from("pipeline_stages")
    .select("id, pipeline_id, name, show_in_kanban, is_triage").eq("tenant_id", tenantId)
  if (error) return "Não foi possível conferir as etapas do nó Mover etapa."
  const stages = (data ?? []) as { id: string; pipeline_id: string; name: string; show_in_kanban: boolean | null; is_triage: boolean | null }[]
  const norm = (s: string) => s.trim().toLowerCase()
  for (const node of nodes) {
    const cfg = (node.config ?? {}) as MoveStageNodeConfig
    if (cfg.stageId) {
      const st = stages.find(s => s.id === cfg.stageId)
      if (!st || (cfg.pipelineId && st.pipeline_id !== cfg.pipelineId)) return "No nó Mover etapa, a etapa escolhida não existe mais. Escolha o kanban e a etapa de novo."
      if (!st.show_in_kanban && !st.is_triage) return `No nó Mover etapa, a etapa “${st.name}” está oculta no kanban. Escolha uma etapa visível.`
      continue
    }
    if (!cfg.stage?.trim()) return "Escolha o kanban e a etapa no nó Mover etapa."
    const byName = stages.filter(s => norm(s.name) === norm(cfg.stage!) && (!cfg.pipelineId || s.pipeline_id === cfg.pipelineId))
    if (!byName.length) return `No nó Mover etapa, a etapa “${cfg.stage}” não existe mais. Escolha de novo.`
    if (byName.length > 1) return `No nó Mover etapa, “${cfg.stage}” existe em mais de um kanban. Escolha o kanban e a etapa.`
  }
  return null
}
