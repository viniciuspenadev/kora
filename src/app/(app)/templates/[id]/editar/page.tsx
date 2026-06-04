import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, FileText, AlertCircle } from "lucide-react"
import { supabaseAdmin } from "@/lib/supabase"
import { getOfficialTemplate } from "@/lib/actions/whatsapp-official"
import { PageShell } from "@/components/ui/page-shell"
import { EditTemplateClient } from "@/components/templates/edit-template-client"

export const dynamic = "force-dynamic"

// Só estes status são editáveis na Meta — fora deles a edição é rejeitada.
const EDITABLE = ["APPROVED", "REJECTED", "PAUSED"]

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const { id } = await params

  // Instância oficial do tenant — sem ela não há WABA pra editar template.
  const { data: inst } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("meta_business_account_id, meta_access_token")
    .eq("tenant_id", session.user.tenantId)
    .eq("provider", "meta_cloud")
    .limit(1)
    .maybeSingle()

  if (!inst?.meta_business_account_id || !inst.meta_access_token) redirect("/integracoes")

  // Template é obrigatório — falha aqui significa ID inválido/sem acesso → volta pra ficha.
  const r = await getOfficialTemplate(id)
  if (!r.ok || !r.template) redirect(`/templates/${id}`)
  const template = r.template

  const locked = !EDITABLE.includes(template.status?.toUpperCase())

  return (
    <PageShell
      title="Editar template"
      description={`${template.name} · ${template.language}`}
      icon={FileText}
      actions={
        <Link
          href={`/templates/${id}`}
          className="h-9 px-3 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1.5 transition-colors"
        >
          <ArrowLeft className="size-3.5" /> Voltar
        </Link>
      }
    >
      {locked && (
        <div className="mb-4 flex items-start gap-2 p-3 rounded-lg text-xs bg-warning-bg border border-amber-200 text-amber-800">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          <span>
            Este template está com status <strong>{template.status}</strong>. Só dá pra editar templates
            <strong> aprovados, rejeitados ou pausados</strong> — salvar agora pode ser recusado pela Meta.
          </span>
        </div>
      )}
      <EditTemplateClient id={id} template={template} />
    </PageShell>
  )
}
