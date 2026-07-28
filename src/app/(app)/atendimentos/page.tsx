import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { AtendimentoBoardShell } from "@/components/atendimento/board-shell"
import type { DealPipeline } from "@/lib/actions/deals"

// Quadro de Atendimento — REUSA a lente "Departamento" do kanban (groupBy=department).
// Colunas Triagem (sem setor) + Departamentos; card mostra posse (dono/avatar).
// Os dados vêm do getManagementCards (visibility-aware) que o ConversationKanban
// carrega sozinho em modo não-stage.
export default async function AtendimentosPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  const tenantId = session.user.tenantId

  const [{ data: cfg }, { data: instRows }, { data: agentsRaw }, { data: departmentsRaw }, crmEnabled] = await Promise.all([
    supabaseAdmin.from("tenant_config").select("kanban_tinted_columns").eq("tenant_id", tenantId).maybeSingle(),
    supabaseAdmin.from("whatsapp_instances").select("id").eq("tenant_id", tenantId),
    supabaseAdmin
      .from("tenant_users")
      .select("user_id, department_id, profiles!tenant_users_user_id_fkey ( full_name )")
      .eq("tenant_id", tenantId)
      .eq("active", true),
    supabaseAdmin.from("tenant_departments").select("id, name, color").eq("tenant_id", tenantId).order("name"),
    hasModule(tenantId, "crm"),
  ])

  const agents = (agentsRaw ?? []).map((a) => {
    const prof = (a as { profiles?: { full_name: string | null } | { full_name: string | null }[] | null }).profiles
    const fullName = Array.isArray(prof) ? prof[0]?.full_name ?? null : prof?.full_name ?? null
    return { id: (a as { user_id: string }).user_id, full_name: fullName, department_id: (a as { department_id: string | null }).department_id ?? null }
  })
  const tintColumns = cfg?.kanban_tinted_columns ?? false
  const showChannel = (instRows ?? []).length > 1

  let dealPipelines: DealPipeline[] = []
  if (crmEnabled) {
    const { data: dp } = await supabaseAdmin
      .from("pipelines")
      .select("id, name, is_default, pipeline_stages ( id, name, color, position, is_won, is_lost, show_in_kanban )")
      .eq("tenant_id", tenantId).eq("active", true).order("position")
    dealPipelines = ((dp ?? []) as Record<string, unknown>[]).map((p) => ({
      id: p.id as string, name: p.name as string, is_default: !!p.is_default,
      stages: ((p.pipeline_stages as DealPipeline["stages"] | null) ?? []).slice().sort((a, b) => a.position - b.position),
    }))
  }

  return (
    <AtendimentoBoardShell
      stages={[]}
      conversations={[]}
      tintColumns={tintColumns}
      showChannel={showChannel}
      agents={agents}
      departments={(departmentsRaw ?? []) as { id: string; name: string; color: string }[]}
      tenantId={tenantId}
      supabaseToken={session.user.supabaseToken}
      crmEnabled={crmEnabled}
      dealPipelines={dealPipelines}
    />
  )
}
