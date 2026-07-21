import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, BookMarked } from "lucide-react"
import { supabaseAdmin } from "@/lib/supabase"
import { PageShell } from "@/components/ui/page-shell"
import { BibliotecaClient } from "@/components/templates/biblioteca-client"

export const dynamic = "force-dynamic"

export default async function BibliotecaPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  // Mesma porta da /templates: só faz sentido com canal oficial.
  const { data: inst } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("meta_business_account_id, meta_access_token")
    .eq("tenant_id", session.user.tenantId)
    .eq("provider", "meta_cloud")
    .limit(1)
    .maybeSingle()

  if (!inst?.meta_business_account_id || !inst.meta_access_token) redirect("/integracoes")

  return (
    <PageShell
      title="Biblioteca de modelos"
      description="Modelos prontos do Kora — use, personalize e envie pra aprovação da Meta."
      icon={BookMarked}
      actions={
        <Link
          href="/templates"
          className="h-9 px-3 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1.5 transition-colors"
        >
          <ArrowLeft className="size-3.5" /> Meus templates
        </Link>
      }
    >
      <BibliotecaClient />
    </PageShell>
  )
}
