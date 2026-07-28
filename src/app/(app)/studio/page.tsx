import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { Workflow } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { StudioOverviewClient } from "./overview-client"
import type { StudioConfig } from "@/types/studio"

export default async function StudioPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const tenantId = session.user.tenantId
  if (!(await hasModule(tenantId, "ai_studio"))) redirect("/inbox")

  const [{ data: config }, { count: flowCount }, { count: knowledgeCount }, hasAi] = await Promise.all([
    supabaseAdmin.from("studio_config").select("*").eq("tenant_id", tenantId).maybeSingle(),
    supabaseAdmin.from("studio_flows").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).neq("status", "archived"),
    supabaseAdmin.from("studio_knowledge").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    hasModule(tenantId, "ai"),   // add-on IA: sem ele, Persona/Conhecimento aparecem cadeados (vitrine)
  ])

  return (
    <PageShell
      title="Kora Studio"
      description="Automações em fluxo com IA opcional. Você decide como cada conversa é conduzida."
      icon={Workflow}
      iconWrapClass="size-10 rounded-xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shrink-0"
      iconClass="size-5 text-white"
    >
      <StudioOverviewClient
        config={(config as StudioConfig | null) ?? null}
        flowCount={flowCount ?? 0}
        knowledgeCount={knowledgeCount ?? 0}
        hasAi={hasAi}
      />
    </PageShell>
  )
}
