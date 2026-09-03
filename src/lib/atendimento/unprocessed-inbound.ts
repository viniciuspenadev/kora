import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { activeFlowRun, loadStartableFlow, isIgTrigger } from "@/lib/ai-v2/flow/triggers"
import { updateFlowRun } from "@/lib/ai-v2/flow/run-state"
import { hasModule } from "@/lib/modules"
import { routeToHumanDefault } from "./human-routing"

/** Mídia/interceptor sem turno do Studio: entrega ao humano apenas se não há
 * execução conduzindo. O snapshot impede desligar uma nova entrada manual. */
export async function routeUnprocessedInbound(tenantId: string, conversationId: string): Promise<void> {
  const { data, error } = await supabaseAdmin.from("chat_conversations")
    .select("metadata").eq("tenant_id", tenantId).eq("id", conversationId).maybeSingle()
  if (error) throw new Error("Não foi possível conferir o atendimento da entrada.")
  if (!data) return
  const run = await activeFlowRun(conversationId)
  if (run) {
    const flow = await loadStartableFlow(tenantId, run.flow_id)
    if (flow && await hasModule(tenantId, "ai_studio")
        && (!isIgTrigger(flow.trigger) || await hasModule(tenantId, "instagram_automation"))) return
    await updateFlowRun(tenantId, run, { status: "done", resume_at: null })
  }
  await routeToHumanDefault(tenantId, conversationId, "unprocessed_inbound", data.metadata ?? {})
}
