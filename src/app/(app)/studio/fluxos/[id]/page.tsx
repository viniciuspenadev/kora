import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { Network, ArrowLeft } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { FlowEditorClient } from "./editor-client"
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
    <PageShell
      title="Editar fluxo"
      description="Monte os passos da conversa. A IA entra só onde você escolher."
      icon={Network}
      actions={
        <Link
          href="/studio/fluxos"
          className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="size-3.5" /> Fluxos
        </Link>
      }
    >
      <FlowEditorClient
        flow={flow as StudioFlowFull}
        departments={(depts ?? []) as { id: string; name: string }[]}
      />
    </PageShell>
  )
}
