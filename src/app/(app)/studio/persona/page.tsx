import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { User, ArrowLeft } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { StudioPersonaClient } from "./persona-client"
import type { StudioConfig } from "@/types/studio"

export default async function StudioPersonaPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const tenantId = session.user.tenantId
  if (!(await hasModule(tenantId, "ai_studio"))) redirect("/inbox")

  const { data: config } = await supabaseAdmin
    .from("studio_config")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle()

  return (
    <PageShell
      title="Persona"
      description="Quem é a sua IA e como ela conversa."
      icon={User}
      actions={
        <Link
          href="/studio"
          className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="size-3.5" /> Studio
        </Link>
      }
    >
      <StudioPersonaClient config={(config as StudioConfig | null) ?? null} />
    </PageShell>
  )
}
