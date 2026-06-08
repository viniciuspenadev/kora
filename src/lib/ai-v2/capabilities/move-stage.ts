// ═══════════════════════════════════════════════════════════════
// Capacidade: mover a conversa de etapa no pipeline
// ═══════════════════════════════════════════════════════════════
// Resolve a etapa por nome em pipeline_stages do tenant e grava
// chat_conversations.stage_id (+ pipeline_id da etapa). NÃO afeta
// visibilidade (etapa ≠ quem vê). Tenant-scoping em toda query.
import { defineCapability } from "./registry"
import { supabaseAdmin } from "@/lib/supabase"

export const MOVE_STAGE = "move_stage"

interface MoveStageArgs { stage: string }

export const moveStageCapability = defineCapability<MoveStageArgs>({
  id:           MOVE_STAGE,
  name:         "Mover etapa",
  category:     "crm",
  minPlanLevel: 0,
  isNode:       true,
  parseArgs: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>
    return { stage: typeof p.stage === "string" ? p.stage.trim() : "" }
  },
  execute: async (ctx, args) => {
    const { tenantId, conversationId } = ctx
    if (!args.stage) return { ok: false, error: "etapa vazia" }

    const { data: stages } = await supabaseAdmin
      .from("pipeline_stages").select("id, pipeline_id, name").eq("tenant_id", tenantId)
    const norm = (s: string) => s.trim().toLowerCase()
    const st = (stages ?? []).find((s) => norm(s.name) === norm(args.stage))
    if (!st) return { ok: false, error: `etapa "${args.stage}" não encontrada` }

    const { error } = await supabaseAdmin
      .from("chat_conversations")
      .update({ stage_id: st.id, pipeline_id: st.pipeline_id, updated_at: new Date().toISOString() })
      .eq("id", conversationId).eq("tenant_id", tenantId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  },
})
