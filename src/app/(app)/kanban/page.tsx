import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope, applyVisibilityFilter } from "@/lib/visibility"
import { ensurePipelineBootstrap } from "@/lib/actions/pipeline"
import { hasModule } from "@/lib/modules"
import { KanbanView } from "@/components/kanban/kanban-view"
import type { DealPipeline } from "@/lib/actions/deals"

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

  // Colunas do board = etapas visíveis + a TRIAGEM (trilho fixo de entrada, sempre
  // presente, independente do toggle show_in_kanban — simétrica à Concluídos).
  // Triagem tem position=-1 → cai sempre na esquerda.
  const activeStageIds = (stages ?? [])
    .filter((s) => s.show_in_kanban || s.is_triage)
    .map((s) => s.id)

  let convQuery = supabaseAdmin
    .from("chat_conversations")
    .select(`
      id, status, priority, subject, channel,
      last_message_at, last_message_preview, last_message_dir, unread_count,
      pipeline_id, stage_id, card_position, stage_entered_at,
      estimated_value, expected_close_date, lost_reason,
      won_at, lost_at,
      assigned_to, ai_handling, instance_id, active_deal_id,
      chat_contacts (
        id, push_name, custom_name, phone_number, profile_pic_url, source, lifecycle_stage
      ),
      profiles ( full_name, email ),
      whatsapp_instances!instance_id ( provider, display_name ),
      deal:tenant_deals!active_deal_id ( id, name, status, stage_id, pipeline_id, estimated_value, stage_entered_at, won_at, lost_at )
    `)
    .eq("tenant_id", tenantId)
    // Etapas visíveis do funil atual OU conversas SEM funil (atendimento-puro →
    // caem na Triagem). Pra tenant com funil é no-op (não há conversa sem funil).
    // Compõe com o .or() de visibilidade abaixo (PostgREST: múltiplos .or() = AND).
    .or(`and(pipeline_id.eq.${currentPipeline.id},stage_id.in.(${activeStageIds.length > 0 ? activeStageIds.join(",") : "00000000-0000-0000-0000-000000000000"})),pipeline_id.is.null`)
    .is("archived_at", null)
    .order("card_position", { ascending: true })

  // Filtro de visibilidade — regra única de @/lib/visibility (mesma do inbox,
  // agora ciente do see_pool por atendente).
  convQuery = applyVisibilityFilter(convQuery, scope)

  const { data: conversations } = await convQuery

  // CRM ligado? → cards viram deal-aware + afford. "Abrir negócio". Trilhas (com etapas)
  // pro dialog de novo negócio. Só carrega quando o módulo está habilitado.
  const crmEnabled = await hasModule(tenantId, "crm")
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
    <KanbanView
      pipelines={pipelines.map((p) => ({ id: p.id, name: p.name, color: p.color }))}
      currentPipeline={{ id: currentPipeline.id, name: currentPipeline.name, color: currentPipeline.color }}
      convCount={(conversations ?? []).length}
      isAdminOrOwner={isAdminOrOwner}
      isManager={isManager}
      stages={(stages ?? []).filter((s) => s.show_in_kanban || s.is_triage)}
      conversations={(conversations ?? []) as unknown as Parameters<typeof KanbanView>[0]["conversations"]}
      agents={agents}
      departments={(departmentsRaw ?? []) as { id: string; name: string; color: string }[]}
      tintColumns={tintColumns}
      showChannel={showChannel}
      tenantId={tenantId}
      supabaseToken={session.user.supabaseToken}
      crmEnabled={crmEnabled}
      dealPipelines={dealPipelines}
    />
  )
}
