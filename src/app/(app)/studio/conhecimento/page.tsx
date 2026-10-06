import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { BookOpen, ArrowLeft } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { KnowledgeClient } from "./conhecimento-client"
import type { StudioKnowledgeItem } from "@/types/studio"

export default async function ConhecimentoPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const tenantId = session.user.tenantId
  if (!(await hasModule(tenantId, "ai_studio"))) redirect("/inbox")

  const { data } = await supabaseAdmin
    .from("studio_knowledge")
    .select("id, title, source, content, updated_at")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false })

  return (
    <PageShell
      title="Base de conhecimento"
      description="O que a IA sabe sobre o seu negócio. Ela consulta isto antes de responder."
      icon={BookOpen}
      actions={
        <Link
          href="/studio"
          className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="size-3.5" /> Studio
        </Link>
      }
    >
      <KnowledgeClient items={(data ?? []) as StudioKnowledgeItem[]} />
    </PageShell>
  )
}
