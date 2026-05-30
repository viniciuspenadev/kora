import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { Sparkles } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { OverviewClient } from "./overview-client"
import type { AIConfig, AITrigger } from "@/types/ai"

export default async function IAOverviewPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const tenantId = session.user.tenantId
  if (!(await hasModule(tenantId, "ai_atendente"))) redirect("/automacao/mensagens")

  const [
    { data: config },
    { data: triggers },
    { count: knowledgeCount },
    { data: routes },
    { data: departments },
    { data: tags },
    { data: stages },
  ] = await Promise.all([
    supabaseAdmin.from("ai_config").select("*").eq("tenant_id", tenantId).maybeSingle(),
    supabaseAdmin.from("ai_triggers").select("*").eq("tenant_id", tenantId)
      .order("priority", { ascending: true }).order("created_at", { ascending: true }),
    supabaseAdmin.from("ai_knowledge_items").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabaseAdmin.from("ai_routes").select("id, department_id, tenant_departments ( name )").eq("tenant_id", tenantId),
    supabaseAdmin.from("tenant_departments").select("id, name").eq("tenant_id", tenantId),
    supabaseAdmin.from("tags").select("id, name").eq("tenant_id", tenantId),
    supabaseAdmin.from("pipeline_stages").select("id, name").eq("tenant_id", tenantId),
  ])

  const deptNameById: Record<string, string> = {}
  ;(departments ?? []).forEach((d) => { deptNameById[d.id] = d.name })

  const tagNameById: Record<string, string> = {}
  ;(tags ?? []).forEach((t) => { tagNameById[t.id] = t.name })

  const stageNameById: Record<string, string> = {}
  ;(stages ?? []).forEach((s) => { stageNameById[s.id] = s.name })

  const routeDeptNames = (routes ?? [])
    .map((r) => {
      const dept = r.tenant_departments as unknown as { name: string } | null
      return dept?.name ?? null
    })
    .filter((n): n is string => !!n)

  return (
    <PageShell
      title="Kora IA"
      description="Sua atendente inteligente. Configure quem ela é, o que sabe e quando entra em ação."
      icon={Sparkles}
      iconWrapClass="size-10 rounded-xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shrink-0"
      iconClass="size-5 text-white"
    >
      <OverviewClient
        config={(config as AIConfig | null) ?? null}
        triggers={(triggers ?? []) as AITrigger[]}
        knowledgeCount={knowledgeCount ?? 0}
        routeCount={(routes ?? []).length}
        routeDeptNames={routeDeptNames}
        departmentCount={(departments ?? []).length}
        deptNameById={deptNameById}
        tagNameById={tagNameById}
        stageNameById={stageNameById}
      />
    </PageShell>
  )
}
