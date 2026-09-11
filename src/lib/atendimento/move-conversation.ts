import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { canViewConversation, type ViewerScope } from "@/lib/visibility"

/** Internal entry point: callers supply their already authenticated tenant/scope.
 * Updating a board never qualifies a contact, closes attendance, or changes a deal. */
export async function moveAttendanceConversation(input: {
  tenantId: string; conversationId: string; stageId: string; position: number
  scope?: ViewerScope; expectedUpdatedAt?: string; actorName?: string
}) {
  if (!Number.isFinite(input.position) || input.position < 0) throw new Error("Posição inválida.")
  const { data: conv, error: readError } = await supabaseAdmin.from("chat_conversations")
    .select("stage_id, pipeline_id, updated_at, assigned_to, participants, department_id, instance_id, archived_at, is_group")
    .eq("tenant_id", input.tenantId).eq("id", input.conversationId).maybeSingle()
  if (readError) throw new Error("Não foi possível consultar a conversa.")
  if (!conv || (input.scope && !canViewConversation(input.scope, conv))) throw new Error("Conversa não encontrada.")
  if (conv.archived_at || conv.is_group) throw new Error("Esta conversa não pode ser movida no Kanban.")
  if (input.expectedUpdatedAt && conv.updated_at !== input.expectedUpdatedAt) throw new Error("A conversa foi atualizada. Feche e abra novamente para revisar o destino.")
  const { data: stage, error: stageError } = await supabaseAdmin.from("pipeline_stages")
    .select("id, pipeline_id, name, is_won, is_lost, is_triage, show_in_kanban")
    .eq("tenant_id", input.tenantId).eq("id", input.stageId).maybeSingle()
  if (stageError || !stage) throw new Error("Etapa não encontrada.")
  const { data: pipeline, error: pipelineError } = await supabaseAdmin.from("pipelines")
    .select("id, name, active").eq("tenant_id", input.tenantId).eq("id", stage.pipeline_id).maybeSingle()
  if (pipelineError || !pipeline?.active) throw new Error("O Kanban de destino não está ativo.")
  if (!stage.show_in_kanban && !stage.is_triage) throw new Error("A etapa de destino está oculta no Kanban.")
  const changed = conv.stage_id !== stage.id || conv.pipeline_id !== stage.pipeline_id
  const now = new Date().toISOString()
  const patch = {
    pipeline_id: stage.pipeline_id, stage_id: stage.id, card_position: input.position, updated_at: now,
    ...(changed ? { stage_entered_at: now, won_at: stage.is_won ? now : null,
      lost_at: stage.is_lost ? now : null, lost_reason: null } : {}),
  }
  // CAS also protects authorization fields changed while this request was in flight.
  const { data: saved, error } = await supabaseAdmin.from("chat_conversations").update(patch)
    .eq("tenant_id", input.tenantId).eq("id", input.conversationId).eq("updated_at", conv.updated_at)
    .select("id").maybeSingle()
  if (error) throw new Error("Não foi possível mover a conversa. Tente novamente.")
  if (!saved) throw new Error("A conversa mudou durante a operação. Atualize e tente novamente.")
  let warning: string | undefined
  if (changed) {
    const { error: historyError } = await supabaseAdmin.from("chat_messages").insert({
      tenant_id: input.tenantId, conversation_id: input.conversationId, sender_type: "system",
      content_type: "text", status: "delivered", is_private_note: true,
      content: `Conversa movida para "${pipeline.name} › ${stage.name}"${input.actorName ? ` por ${input.actorName}` : ""}.`,
      metadata: { kind: "kanban_move", from_pipeline_id: conv.pipeline_id, from_stage_id: conv.stage_id,
        to_pipeline_id: stage.pipeline_id, to_stage_id: stage.id },
    })
    // Persistence succeeded: never tell the UI to undo it just because history failed.
    if (historyError) warning = "Conversa movida, mas não foi possível registrar a movimentação no histórico."
  }
  return { patch, warning }
}
