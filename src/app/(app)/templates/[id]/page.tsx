import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { supabaseAdmin } from "@/lib/supabase"
import { MetaCloudProvider, type MetaTemplate, type TemplateAnalytics } from "@/lib/providers/meta-cloud-provider"
import { decryptSecret } from "@/lib/crypto/secrets"
import { getTemplateEvents } from "@/lib/channels/template-cache"
import { PageShell } from "@/components/ui/page-shell"
import { TemplateDetailClient } from "@/components/templates/template-detail-client"
import { ArrowLeft, FileText, Pencil } from "lucide-react"

export const dynamic = "force-dynamic"

const CATEGORY: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
}

export default async function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const { id } = await params

  // Instância oficial do tenant — sem ela não há WABA pra consultar.
  const { data: inst } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("meta_phone_number_id, meta_business_account_id, meta_access_token, meta_app_secret")
    .eq("tenant_id", session.user.tenantId)
    .eq("provider", "meta_cloud")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!inst?.meta_business_account_id || !inst.meta_access_token) redirect("/integracoes")

  const provider = new MetaCloudProvider({
    meta_phone_number_id:     inst.meta_phone_number_id ?? "",
    meta_business_account_id: inst.meta_business_account_id,
    meta_access_token:        decryptSecret(inst.meta_access_token),
    meta_app_secret:          decryptSecret(inst.meta_app_secret) ?? "",
  })

  // Template é obrigatório — falha aqui significa ID inválido/sem acesso → volta pra lista.
  let template: MetaTemplate
  try {
    template = await provider.getTemplate(id)
  } catch {
    redirect("/templates")
  }

  // Analytics inicial (30 dias) é best-effort — pode falhar/estar indisponível.
  const now = Math.floor(Date.now() / 1000)
  let analytics: TemplateAnalytics | null = null
  try {
    analytics = await provider.getTemplateAnalytics([id], now - 30 * 86400, now)
  } catch {
    analytics = null
  }

  const history = await getTemplateEvents(session.user.tenantId, template.name, template.language)

  return (
    <PageShell
      title={template.name}
      description={`${CATEGORY[template.category] ?? template.category} · ${template.language}`}
      icon={FileText}
      actions={
        <>
          <Link
            href="/templates"
            className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg inline-flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="size-3.5" /> Voltar
          </Link>
          <Link
            href={`/templates/${id}/editar`}
            className="h-9 px-3 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white inline-flex items-center gap-1.5 transition-colors"
          >
            <Pencil className="size-3.5" /> Editar
          </Link>
        </>
      }
    >
      <TemplateDetailClient
        template={template}
        analytics={analytics}
        history={history}
        templateId={id}
      />
    </PageShell>
  )
}
