import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { ensurePipelineBootstrap } from "@/lib/actions/pipeline"
import { ConversationKanban } from "@/components/kanban/conversation-kanban"
import { Workflow, ChevronRight, Settings, Plus } from "lucide-react"

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

  const [{ data: pipelines }, { data: tu }, { data: cfg }] = await Promise.all([
    supabaseAdmin
      .from("pipelines")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("position"),
    supabaseAdmin
      .from("tenant_users")
      .select("view_all")
      .eq("tenant_id", tenantId)
      .eq("user_id", session.user.id)
      .maybeSingle(),
    supabaseAdmin
      .from("tenant_config")
      .select("kanban_tinted_columns")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ])
  const tintColumns = cfg?.kanban_tinted_columns ?? false

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

  const isAdminOrOwner = ["owner", "admin"].includes(session.user.role)
  const canSeeAll      = isAdminOrOwner || (tu?.view_all ?? false)

  // Stages visíveis no Kanban = não-triagem, não-ganho, não-perdido.
  // (Triagem entra com position=-1; ganho/perdido vão pra histórico no futuro.)
  const activeStageIds = (stages ?? [])
    .filter((s) => s.show_in_kanban)
    .map((s) => s.id)

  let convQuery = supabaseAdmin
    .from("chat_conversations")
    .select(`
      id, status, priority, subject, channel,
      last_message_at, last_message_preview, unread_count,
      pipeline_id, stage_id, card_position,
      estimated_value, expected_close_date, lost_reason,
      won_at, lost_at,
      assigned_to,
      chat_contacts (
        id, push_name, custom_name, phone_number, profile_pic_url, source, lifecycle_stage
      ),
      profiles ( full_name, email )
    `)
    .eq("tenant_id", tenantId)
    .eq("pipeline_id", currentPipeline.id)
    .in("stage_id", activeStageIds.length > 0 ? activeStageIds : ["__none__"])
    .is("archived_at", null)
    .order("card_position", { ascending: true })

  // Filtro de visibilidade (mesma regra do inbox):
  //   - admin/owner ou view_all → tudo
  //   - assigned_to NULL (pool) → todos veem
  //   - assigned_to = eu → visível
  //   - participants contém eu → visível
  if (!canSeeAll) {
    convQuery = convQuery.or(
      `assigned_to.is.null,assigned_to.eq.${session.user.id},participants.cs.{${session.user.id}}`,
    )
  }

  const { data: conversations } = await convQuery

  return (
    <div className="min-h-full bg-slate-50">

      <div className="bg-white border-b border-slate-200 px-6 py-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-10 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
            <Workflow className="size-5 text-primary-600" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-0.5">
              <span>Kanban</span>
              <ChevronRight className="size-3" />
              <span className="text-slate-600 font-medium">{currentPipeline.name}</span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight truncate">{currentPipeline.name}</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {(conversations ?? []).length} {(conversations ?? []).length === 1 ? "conversa" : "conversas"} ·
              {" "}{!canSeeAll ? "vendo apenas minhas" : "visão completa"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {pipelines.length > 1 && (
            <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg p-1 shrink-0">
              {pipelines.map((p) => {
                const active = p.id === currentPipeline.id
                return (
                  <a
                    key={p.id}
                    href={`/kanban?pipeline=${p.id}`}
                    className={`flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-md transition-all ${
                      active
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-900"
                    }`}
                    style={active ? { boxShadow: `inset 0 -2px 0 ${p.color}` } : undefined}
                  >
                    <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                    {p.name}
                  </a>
                )
              })}
            </div>
          )}

          {pipelines.length === 1 && isAdminOrOwner && (
            <Link
              href="/kanban/configuracao"
              className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-primary-600 px-2 py-1 rounded-md hover:bg-slate-50 transition-colors"
            >
              <Plus className="size-3" /> Novo funil
            </Link>
          )}

          {isAdminOrOwner && (
            <Link
              href="/kanban/configuracao"
              title="Configurar funis"
              className="size-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors shrink-0"
            >
              <Settings className="size-4" />
            </Link>
          )}
        </div>
      </div>

      <div className="p-4">
        <ConversationKanban
          stages={(stages ?? []).filter((s) => s.show_in_kanban)}
          conversations={(conversations ?? []) as unknown as Parameters<typeof ConversationKanban>[0]["conversations"]}
          tintColumns={tintColumns}
        />
      </div>
    </div>
  )
}
