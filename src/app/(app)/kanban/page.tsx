import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope, applyVisibilityFilter } from "@/lib/visibility"
import { ensurePipelineBootstrap } from "@/lib/actions/pipeline"
import { KanbanView } from "@/components/kanban/kanban-view"

export default async function KanbanPage({
  searchParams,
}: {
  searchParams: Promise<{ pipeline?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/auth/signin")

  const { pipeline: pipelineQuery } = await searchParams
  const tenantId = session.user.tenantId

  await ensurePipelineBootstrap(tenantId, session.user.id)

  const [{ data: pipelines }, scope, { data: cfg }, { data: instRows }, { data: agentsRaw }, { data: departmentsRaw }] = await Promise.all([
    supabaseAdmin
      .from("pipelines")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("position"),
    getViewerScope(),
    supabaseAdmin
      .from("tenant_config")
      .select("kanban_tinted_columns")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabaseAdmin
      .from("whatsapp_instances")
      .select("id")
      .eq("tenant_id", tenantId),
    supabaseAdmin
      .from("tenant_users")
      .select("user_id, department_id, profiles!tenant_users_user_id_fkey ( full_name )")
      .eq("tenant_id", tenantId)
      .eq("active", true),
    supabaseAdmin
      .from("tenant_departments")
      .select("id, name, color")
      .eq("tenant_id", tenantId)
      .order("name"),
  ])
  // Alto escalão: vê o switcher de gestão (Atendente/Departamento). Agente não.
  const isManager = scope.isAdmin || scope.viewAll
  const agents = (agentsRaw ?? []).map((a) => {
    const prof = (a as { profiles?: { full_name: string | null } | { full_name: string | null }[] | null }).profiles
    const fullName = Array.isArray(prof) ? prof[0]?.full_name ?? null : prof?.full_name ?? null
    return { id: (a as { user_id: string }).user_id, full_name: fullName, department_id: (a as { department_id: string | null }).department_id ?? null }
  })
  const tintColumns = cfg?.kanban_tinted_columns ?? false
  // Badge de canal só com 2+ instâncias (ex: Baileys + Oficial).
  const showChannel = (instRows ?? []).length > 1

  if (!pipelines || pipelines.length === 0) {
    return <div className="p-6">Erro inicializando pipeline.</div>
  }

  const currentPipeline = pipelineQuery
    ? pipelines.find((p) => p.id === pipelineQuery) ?? pipelines.find((p) => p.is_default) ?? pipelines[0]
    : pipelines.find((p) => p.is_default) ?? pipelines[0]

  const { data: stages } = await supabaseAdmin
    .from("pipeline_stages")
    .select("*")
    .eq("pipeline_id", currentPipeline.id)
    .order("position")

  const isAdminOrOwner = scope.isAdmin

  // Stages visíveis no Kanban = não-triagem, não-ganho, não-perdido.
  // (Triagem entra com position=-1; ganho/perdido vão pra histórico no futuro.)
  const activeStageIds = (stages ?? [])
    .filter((s) => s.show_in_kanban)
    .map((s) => s.id)

  let convQuery = supabaseAdmin
    .from("chat_conversations")
    .select(`
      id, status, priority, subject, channel,
      last_message_at, last_message_preview, last_message_dir, unread_count,
      pipeline_id, stage_id, card_position, stage_entered_at,
      estimated_value, expected_close_date, lost_reason,
      won_at, lost_at,
      assigned_to, instance_id,
      chat_contacts (
        id, push_name, custom_name, phone_number, profile_pic_url, source, lifecycle_stage
      ),
      profiles ( full_name, email ),
      whatsapp_instances!instance_id ( provider, display_name )
    `)
    .eq("tenant_id", tenantId)
    .eq("pipeline_id", currentPipeline.id)
    .in("stage_id", activeStageIds.length > 0 ? activeStageIds : ["__none__"])
    .is("archived_at", null)
    .order("card_position", { ascending: true })

  // Filtro de visibilidade — regra única de @/lib/visibility (mesma do inbox,
  // agora ciente do see_pool por atendente).
  convQuery = applyVisibilityFilter(convQuery, scope)

  const { data: conversations } = await convQuery

  return (
    <KanbanView
      pipelines={pipelines.map((p) => ({ id: p.id, name: p.name, color: p.color }))}
      currentPipeline={{ id: currentPipeline.id, name: currentPipeline.name, color: currentPipeline.color }}
      convCount={(conversations ?? []).length}
      isAdminOrOwner={isAdminOrOwner}
      isManager={isManager}
      stages={(stages ?? []).filter((s) => s.show_in_kanban)}
      conversations={(conversations ?? []) as unknown as Parameters<typeof KanbanView>[0]["conversations"]}
      agents={agents}
      departments={(departmentsRaw ?? []) as { id: string; name: string; color: string }[]}
      tintColumns={tintColumns}
      showChannel={showChannel}
      tenantId={tenantId}
      supabaseToken={session.user.supabaseToken}
    />
  )
}
