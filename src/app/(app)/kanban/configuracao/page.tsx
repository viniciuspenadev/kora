import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { FunnelsManagerClient, type FunnelSummary } from "@/components/kanban/funnels-manager-client"

export const dynamic = "force-dynamic"

export default async function KanbanConfigPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/kanban")

  const tenantId = session.user.tenantId

  const [{ data: pipelines }, { data: stages }, { data: convs }, { data: deals }, { data: cfg }] = await Promise.all([
    supabaseAdmin.from("pipelines").select("id, name, color, is_default, position").eq("tenant_id", tenantId).eq("active", true).order("position"),
    supabaseAdmin.from("pipeline_stages").select("id, pipeline_id, color, position").eq("tenant_id", tenantId).order("position"),
    supabaseAdmin.from("chat_conversations").select("pipeline_id").eq("tenant_id", tenantId).not("pipeline_id", "is", null),
    supabaseAdmin.from("tenant_deals").select("pipeline_id").eq("tenant_id", tenantId).eq("status", "open").not("pipeline_id", "is", null),
    supabaseAdmin.from("tenant_config").select("kanban_tinted_columns").eq("tenant_id", tenantId).maybeSingle(),
  ])

  const tally = (rows: { pipeline_id: string | null }[] | null) => {
    const m: Record<string, number> = {}
    for (const r of rows ?? []) if (r.pipeline_id) m[r.pipeline_id] = (m[r.pipeline_id] ?? 0) + 1
    return m
  }
  const convBy = tally(convs as { pipeline_id: string | null }[] | null)
  const dealBy = tally(deals as { pipeline_id: string | null }[] | null)

  const stagesBy: Record<string, { color: string; position: number }[]> = {}
  for (const s of (stages ?? []) as { pipeline_id: string; color: string; position: number }[]) {
    (stagesBy[s.pipeline_id] ??= []).push({ color: s.color, position: s.position })
  }

  const funnels: FunnelSummary[] = ((pipelines ?? []) as { id: string; name: string; color: string; is_default: boolean }[]).map((p) => {
    const st = (stagesBy[p.id] ?? []).sort((a, b) => a.position - b.position)
    return {
      id: p.id, name: p.name, color: p.color, is_default: p.is_default,
      stageCount: st.length,
      stageColors: st.map((s) => s.color).slice(0, 8),
      convCount: convBy[p.id] ?? 0,
      dealCount: dealBy[p.id] ?? 0,
    }
  })

  return <FunnelsManagerClient funnels={funnels} tinted={cfg?.kanban_tinted_columns ?? false} />
}
