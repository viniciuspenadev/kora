import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { Activity, ArrowLeft } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { AtividadeClient } from "./atividade-client"
import type { StudioRunRow } from "./atividade-client"

export default async function AtividadePage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const tenantId = session.user.tenantId
  if (!(await hasModule(tenantId, "ai_studio"))) redirect("/inbox")

  const { data } = await supabaseAdmin
    .from("studio_runs")
    .select("id, kind, node_id, error, tools_called, llm_response, model, input_tokens, output_tokens, cost_usd, duration_ms, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(60)

  return (
    <PageShell
      title="Atividade da IA"
      description="Cada turno da IA e cada passo de fluxo — o que ela fez, com qual custo."
      icon={Activity}
      actions={
        <Link
          href="/studio"
          className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="size-3.5" /> Studio
        </Link>
      }
    >
      <AtividadeClient runs={(data ?? []) as StudioRunRow[]} />
    </PageShell>
  )
}
