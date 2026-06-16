// ═══════════════════════════════════════════════════════════════
// Capacidade: mover a conversa de etapa no pipeline
// ═══════════════════════════════════════════════════════════════
// Resolve a etapa por nome em pipeline_stages do tenant e grava
// chat_conversations.stage_id (+ pipeline_id da etapa). NÃO afeta
// visibilidade (etapa ≠ quem vê). Tenant-scoping em toda query.
import { defineCapability } from "./registry"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveLifecycle } from "@/lib/lifecycle-stage"

export const MOVE_STAGE = "move_stage"

interface MoveStageArgs { stage: string }

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
    return { stage: typeof p.stage === "string" ? p.stage.trim() : "" }
  },
  execute: async (ctx, args) => {
    const { tenantId, conversationId, contact } = ctx
    if (!args.stage) return { ok: false, error: "etapa vazia" }

    const { data: stages } = await supabaseAdmin
      .from("pipeline_stages").select("id, pipeline_id, name, is_won, is_lost, is_triage").eq("tenant_id", tenantId)
    const norm = (s: string) => s.trim().toLowerCase()
    const st = (stages ?? []).find((s) => norm(s.name) === norm(args.stage))
    if (!st) {
      const opts = (stages ?? []).map((s) => s.name).join(", ") || "(nenhuma)"
      return { ok: false, toolMessage: `Etapa "${args.stage}" não existe. Etapas válidas: ${opts}.` }
    }

    const { error } = await supabaseAdmin
      .from("chat_conversations")
      .update({ stage_id: st.id, pipeline_id: st.pipeline_id, updated_at: new Date().toISOString() })
      .eq("id", conversationId).eq("tenant_id", tenantId)
    if (error) return { ok: false, error: error.message }

    // Acoplamento pipeline → lifecycle (nunca rebaixa) — mesma regra do kanban.
    const next = resolveLifecycle(contact.lifecycle_stage, st)
    if (next) {
      await supabaseAdmin.from("chat_contacts")
        .update({ lifecycle_stage: next, lifecycle_changed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", contact.id).eq("tenant_id", tenantId)
    }
    return { ok: true, toolMessage: `Conversa movida para a etapa "${st.name}"${next ? ` (lifecycle: ${next})` : ""}.` }
  },
})
