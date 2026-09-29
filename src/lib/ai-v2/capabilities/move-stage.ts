// ═══════════════════════════════════════════════════════════════
// Capacidade: mover a conversa de etapa no pipeline
// ═══════════════════════════════════════════════════════════════
// Kanban de ATENDIMENTO (pipelines/pipeline_stages), não o funil de vendas.
// Destino pelo ID quando o nó traz (`stage_id`); por nome só no legado e na
// ferramenta da IA. Nome repete entre kanbans ("Proposta", "Triagem" — medido
// 28/09), então o nome se resolve DENTRO do kanban informado ou, na falta, do
// kanban em que a conversa já está. NÃO afeta visibilidade. Tenant em toda query.
import { defineCapability } from "./registry"
import { supabaseAdmin } from "@/lib/supabase"
import { moveAttendanceConversation } from "@/lib/atendimento/move-conversation"
import { hasModule } from "@/lib/modules"

export const MOVE_STAGE = "move_stage"

interface MoveStageArgs { stage: string; stageId: string | null; pipelineId: string | null }
type StageRow = { id: string; pipeline_id: string; name: string }

export const moveStageCapability = defineCapability<MoveStageArgs>({
  id:           MOVE_STAGE,
  name:         "Mover etapa",
  category:     "crm",
  minPlanLevel: 0,
  isNode:       true,
  toolSchema: {
    type: "function",
    function: {
      name: MOVE_STAGE,
      description:
        "Move a conversa para uma etapa do pipeline (qualificação visual no kanban). " +
        "Use SOMENTE uma das etapas da lista ETAPAS DO PIPELINE no prompt.",
      parameters: {
        type: "object",
        properties: { stage: { type: "string", description: "Nome exato da etapa." } },
        required: ["stage"],
        additionalProperties: false,
      },
    },
  },
  playbook: (ctx) => {
    const stages = (ctx.stages ?? []).map((s) => s.name)
    const base = "QUALIFICAR (pipeline): mova a conversa para a etapa certa do funil com move_stage conforme o avanço do lead."
    return stages.length > 0
      ? `${base} Use SOMENTE estas etapas (nome exato): ${stages.join(", ")}.`
      : `${base}`
  },
  parseArgs: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>
    const id = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
    return { stage: typeof p.stage === "string" ? p.stage.trim() : "", stageId: id(p.stage_id), pipelineId: id(p.pipeline_id) }
  },
  execute: async (ctx, args) => {
    const { tenantId, conversationId } = ctx
    if (!args.stageId && !args.stage) return { ok: false, error: "etapa vazia" }

    if (!(await hasModule(tenantId, "kanban"))) return { ok: false, error: "Kanban não habilitado." }

    let st: StageRow | null = null
    if (args.stageId) {
      // Destino exato escolhido no nó. Sumiu (apagada) → erro claro, nunca "adivinhar" por nome.
      const { data } = await supabaseAdmin.from("pipeline_stages").select("id, pipeline_id, name")
        .eq("tenant_id", tenantId).eq("id", args.stageId).maybeSingle()
      st = (data as StageRow | null) ?? null
      if (!st) return { ok: false, error: "A etapa escolhida no nó Mover etapa não existe mais. Escolha de novo no Kora Studio." }
    } else {
      const { data: stages } = await supabaseAdmin
        .from("pipeline_stages").select("id, pipeline_id, name").eq("tenant_id", tenantId)
      const norm = (s: string) => s.trim().toLowerCase()
      let matches = ((stages ?? []) as StageRow[]).filter((s) => norm(s.name) === norm(args.stage))
      if (args.pipelineId) matches = matches.filter((s) => s.pipeline_id === args.pipelineId)
      if (matches.length > 1) {
        // Mesmo nome em vários kanbans: vale o kanban em que a conversa já está.
        const { data: conv } = await supabaseAdmin.from("chat_conversations").select("pipeline_id")
          .eq("tenant_id", tenantId).eq("id", conversationId).maybeSingle()
        const here = (conv as { pipeline_id: string | null } | null)?.pipeline_id ?? null
        const inHere = matches.filter((s) => s.pipeline_id === here)
        if (inHere.length === 1) matches = inHere
      }
      if (matches.length > 1) return { ok: false, error: "Há mais de um kanban com uma etapa com esse nome. No nó Mover etapa, escolha o kanban." }
      st = matches[0] ?? null
      if (!st) {
        const opts = ((stages ?? []) as StageRow[]).map((s) => s.name).join(", ") || "(nenhuma)"
        return { ok: false, toolMessage: `Etapa "${args.stage}" não existe. Etapas válidas: ${opts}.` }
      }
    }

    try {
      const result = await moveAttendanceConversation({ tenantId, conversationId, stageId: st.id, position: 0, actorName: "Kora Studio" })
      return { ok: true, toolMessage: result.warning ?? `Conversa movida para a etapa "${st.name}".` }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Não foi possível mover a conversa." }
    }
  },
})
