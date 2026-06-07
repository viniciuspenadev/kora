import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { FlowEditorCanvas } from "./editor-canvas"
import type { StudioFlowFull } from "@/types/studio"

export default async function FlowEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const tenantId = session.user.tenantId
  if (!(await hasModule(tenantId, "ai_studio"))) redirect("/inbox")

  const [{ data: flow }, { data: depts }] = await Promise.all([
    supabaseAdmin.from("studio_flows")
      .select("id, name, status, active, version, trigger, graph")
      .eq("tenant_id", tenantId).eq("id", id).maybeSingle(),
    supabaseAdmin.from("tenant_departments").select("id, name").eq("tenant_id", tenantId),
  ])
  if (!flow) redirect("/studio/fluxos")

  return (
    <FlowEditorCanvas
      flow={flow as StudioFlowFull}
      departments={(depts ?? []) as { id: string; name: string }[]}
    />
  )
}
