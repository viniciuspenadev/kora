import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { after } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { MetaCloudProvider, type MetaTemplate } from "@/lib/providers/meta-cloud-provider"
import { decryptSecret } from "@/lib/crypto/secrets"
import { syncTemplatesCacheFor } from "@/lib/actions/whatsapp-official"
import { PageShell } from "@/components/ui/page-shell"
import { TemplatesClient } from "@/components/templates/templates-client"
import { FileText } from "lucide-react"

export const dynamic = "force-dynamic"

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ created?: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const { created } = await searchParams

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

  // Visitar a lista atualiza o cache local (status/qualidade) — fire-and-forget.
  // tenantId resolvido AQUI (fora do after) — headers()/auth() não rodam dentro de after().
  after(() => syncTemplatesCacheFor(session.user.tenantId))

  return (
    <PageShell
      title="Templates"
      description="Modelos de mensagem da sua linha oficial — crie, monitore e gerencie."
      icon={FileText}
    >
      <TemplatesClient templates={templates} error={error} created={created === "1"} />
    </PageShell>
  )
}
