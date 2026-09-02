import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { FunnelEditorClient, type EditorPipeline, type EditorStage } from "@/components/kanban/funnel-editor-client"

export const dynamic = "force-dynamic"

export default async function FunnelEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/kanban")
  const { id } = await params
  const tenantId = session.user.tenantId

  const [{ data: pipeline }, { data: stages }, { data: convs }, { data: deals }] = await Promise.all([
    supabaseAdmin.from("pipelines").select("id, name, description, color, is_default").eq("id", id).eq("tenant_id", tenantId).maybeSingle(),
    supabaseAdmin.from("pipeline_stages").select("id, pipeline_id, name, color, position, probability_pct, is_won, is_lost, is_triage, show_in_kanban").eq("pipeline_id", id).eq("tenant_id", tenantId).order("position"),
    supabaseAdmin.from("chat_conversations").select("stage_id").eq("tenant_id", tenantId).not("stage_id", "is", null),
    supabaseAdmin.from("tenant_deals").select("stage_id").eq("tenant_id", tenantId).eq("status", "open").not("stage_id", "is", null),
  ])

  if (!pipeline) redirect("/kanban/configuracao")

  const tally = (rows: { stage_id: string | null }[] | null) => {
    const m: Record<string, number> = {}
    for (const r of rows ?? []) if (r.stage_id) m[r.stage_id] = (m[r.stage_id] ?? 0) + 1
    return m
  }
  const convBy = tally(convs as { stage_id: string | null }[] | null)
  const dealBy = tally(deals as { stage_id: string | null }[] | null)

  const stageList: EditorStage[] = ((stages ?? []) as EditorStage[]).map((s) => ({
    ...s,
    convCount: convBy[s.id] ?? 0,
    dealCount: dealBy[s.id] ?? 0,
  }))

  return <FunnelEditorClient pipeline={pipeline as EditorPipeline} stages={stageList} />
}
