import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { supabaseAdmin } from "@/lib/supabase"
import {
  MetaCloudProvider,
  type MetaPhoneInfo, type MetaTemplate, type MetaBusinessProfile,
} from "@/lib/providers/meta-cloud-provider"
import { PageShell } from "@/components/ui/page-shell"
import { OfficialDashboard } from "@/components/integrations/official/official-dashboard"
import { BadgeCheck, ArrowLeft } from "lucide-react"

export const dynamic = "force-dynamic"

export default async function WhatsappOficialPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const { data: inst } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("meta_phone_number_id, meta_business_account_id, meta_access_token, meta_app_secret, status")
    .eq("tenant_id", session.user.tenantId)
    .eq("provider", "meta_cloud")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!inst?.meta_phone_number_id || !inst.meta_access_token) redirect("/integracoes")

  const provider = new MetaCloudProvider({
    meta_phone_number_id:     inst.meta_phone_number_id,
    meta_business_account_id: inst.meta_business_account_id ?? "",
    meta_access_token:        inst.meta_access_token,
    meta_app_secret:          inst.meta_app_secret ?? "",
  })

  let phone: MetaPhoneInfo = {}
  let templates: MetaTemplate[] = []
  let profile: MetaBusinessProfile = {}
  let webhookOk = false
  let error: string | null = null
  try {
    const [p, t, pr, w] = await Promise.all([
      provider.getPhoneInfo(),
      provider.listTemplates(),
      provider.getBusinessProfile(),
      provider.isWebhookSubscribed(),
    ])
    phone = p; templates = t; profile = pr; webhookOk = w
  } catch (e) {
    error = (e as Error).message
  }

  return (
    <PageShell
      title="WhatsApp API Oficial"
      description="Central de gestão da sua linha oficial — status, templates, perfil e testes."
      icon={BadgeCheck}
    >
      <div className="space-y-5">
        <Link href="/integracoes" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft className="size-3.5" /> Voltar para Integrações
        </Link>

        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Não foi possível carregar todos os dados ao vivo da Meta: {error}
          </div>
        )}

        <OfficialDashboard
          phone={phone}
          templates={templates}
          profile={profile}
          status={inst.status ?? null}
          wabaId={inst.meta_business_account_id ?? null}
          webhookOk={webhookOk}
        />
      </div>
    </PageShell>
  )
}
