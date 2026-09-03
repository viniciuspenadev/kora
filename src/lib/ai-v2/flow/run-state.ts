import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { StudioControlChangedError } from "../control-error"
import type { FlowRunRow } from "./types"

/** The row id survives a restart. Compare the execution snapshot atomically so
 * an old reply/timer cannot overwrite a new run or revive a closed one. JSONB
 * equality also supports legacy runs without a generation token. */
export async function updateFlowRun(
  tenantId: string, run: FlowRunRow, patch: Partial<FlowRunRow>,
): Promise<void> {
  const next = { ...patch, variables: structuredClone({ ...(patch.variables ?? run.variables),
    __state_revision: crypto.randomUUID() }) }
  const { data, error } = await supabaseAdmin.from("studio_flow_runs")
    .update({ ...next, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("id", run.id)
    .eq("status", run.status).eq("variables", JSON.stringify(run.variables))
    .select("id")
  if (error) throw new Error("Não foi possível gravar o estado do fluxo.")
  if (!data?.length) throw new StudioControlChangedError("A execução do fluxo mudou.")
  Object.assign(run, next)
}
