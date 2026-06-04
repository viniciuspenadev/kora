import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { MetaCloudProvider, type MetaTemplate } from "@/lib/providers/meta-cloud-provider"
import { decryptSecret } from "@/lib/crypto/secrets"
import { PageShell } from "@/components/ui/page-shell"
import { TemplatesClient } from "@/components/templates/templates-client"
import { FileText } from "lucide-react"

export const dynamic = "force-dynamic"

export default async function TemplatesPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

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

  let templates: MetaTemplate[] = []
  let error: string | null = null
  try {
    templates = await provider.listTemplates()
  } catch (e) {
    error = (e as Error).message
  }

  return (
    <PageShell
      title="Templates"
      description="Modelos de mensagem da sua linha oficial — crie, monitore e gerencie."
      icon={FileText}
    >
      <TemplatesClient templates={templates} error={error} />
    </PageShell>
  )
}
