import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

type ControlContext = {
  tenantId: string; conversationId: string; dryRun?: boolean
  conversationMetadata?: Record<string, unknown>
}

export class StudioControlChangedError extends Error {}

/** Revalidate after slow I/O. A human handoff or a new attendance cycle
 * invalidates the old turn. Sending a message never grants control back. */
export async function assertStudioControl(ctx: ControlContext) {
  if (ctx.dryRun) return null
  const { data: current, error } = await supabaseAdmin.from("chat_conversations")
    .select("status, assigned_to, department_id, contact_id, instance_id, metadata, updated_at")
    .eq("tenant_id", ctx.tenantId).eq("id", ctx.conversationId).maybeSingle()
  if (error || !current) throw new Error("Não foi possível confirmar o controle da conversa.")
  const expected = ctx.conversationMetadata ?? {}
  const actual = current.metadata ?? {}
  if (current.status !== "open"
      || JSON.stringify(actual.ai_routed ?? null) !== JSON.stringify(expected.ai_routed ?? null)
      || (actual.studio_entry ?? null) !== (expected.studio_entry ?? null)
      || (actual.attendance_cycle ?? null) !== (expected.attendance_cycle ?? null)) {
    throw new StudioControlChangedError("O controle da conversa mudou; a execução anterior foi interrompida.")
  }
  return current
}

/** Explicit, authorized Studio start. The senders never acquire control. */
export async function beginStudioControl(ctx: ControlContext): Promise<void> {
  if (ctx.dryRun) return
  const current = await assertStudioControl(ctx)
  if (!current) return
  const metadata: Record<string, unknown> = { ...current.metadata, studio_entry: crypto.randomUUID() }
  for (const key of ["ai_routed", "reopen_owner", "ai_pinned_flow", "campaign_engage", "ig_comment_engage"]) delete metadata[key]
  const { data, error } = await supabaseAdmin.from("chat_conversations")
    .update({ ai_handling: true, metadata, updated_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId).eq("id", ctx.conversationId)
    .eq("status", "open").eq("updated_at", current.updated_at).select("id")
  if (error) throw new Error("Não foi possível iniciar o Studio.")
  if (!data?.length) throw new StudioControlChangedError("A conversa mudou antes de iniciar o Studio.")
  ctx.conversationMetadata = metadata
}
