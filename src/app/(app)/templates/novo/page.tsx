import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, FileText } from "lucide-react"
import { supabaseAdmin } from "@/lib/supabase"
import { PageShell } from "@/components/ui/page-shell"
import { NewTemplateClient } from "@/components/templates/new-template-client"

export const dynamic = "force-dynamic"

export default async function NewTemplatePage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

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
      title="Novo template"
      description="Monte um modelo de mensagem para enviar à aprovação da Meta."
      icon={FileText}
      actions={
        <Link
          href="/templates"
          className="h-9 px-3 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1.5 transition-colors"
        >
          <ArrowLeft className="size-3.5" /> Voltar
        </Link>
      }
    >
      <NewTemplateClient />
    </PageShell>
  )
}
