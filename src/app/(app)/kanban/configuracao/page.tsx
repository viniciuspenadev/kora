import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { PipelineConfigClient } from "@/components/kanban/pipeline-config-client"
import { Settings, ChevronLeft, ChevronRight } from "lucide-react"

export default async function KanbanConfigPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/kanban")

  const tenantId = session.user.tenantId

  const [{ data: pipelines }, { data: stages }, { data: stageStats }] = await Promise.all([
    supabaseAdmin
      .from("pipelines")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("position"),
    supabaseAdmin
      .from("pipeline_stages")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("position"),
    supabaseAdmin
      .from("chat_conversations")
      .select("stage_id")
      .eq("tenant_id", tenantId)
      .not("stage_id", "is", null),
  ])

  const stageCount: Record<string, number> = {}
  for (const s of stageStats ?? []) {
    const key = (s as { stage_id: string | null }).stage_id
    if (key) stageCount[key] = (stageCount[key] ?? 0) + 1
  }

  return (
    <div className="min-h-full bg-slate-50">

      <div className="bg-white border-b border-slate-200 sticky top-0 z-10 px-6 py-3.5 flex items-center gap-3">
        <Link
          href="/kanban"
          className="size-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center shrink-0 transition-colors"
        >
          <ChevronLeft className="size-4 text-slate-600" />
        </Link>
        <div className="flex items-center gap-2 text-xs">
          <Link href="/kanban" className="text-slate-400 hover:text-slate-600">Kanban</Link>
          <ChevronRight className="size-3 text-slate-300" />
          <span className="font-semibold text-slate-900">Configuração</span>
        </div>
      </div>

      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary-50 flex items-center justify-center">
            <Settings className="size-5 text-primary-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Configurar funis</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Crie quantos funis quiser. Adicione, remova ou reordene etapas livremente.
            </p>
          </div>
        </div>
      </div>

      <div className="px-6 py-6">
        <PipelineConfigClient
          pipelines={pipelines ?? []}
          stages={stages ?? []}
          stageCount={stageCount}
        />
      </div>
    </div>
  )
}
