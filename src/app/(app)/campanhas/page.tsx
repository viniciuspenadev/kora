import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { Megaphone } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { hasModule } from "@/lib/modules"
import { getViewerScope, canOpenMarketing } from "@/lib/visibility"
import { supabaseAdmin } from "@/lib/supabase"
import { getCampaigns } from "@/lib/actions/campaigns"
import { CampanhasClient } from "./campanhas-client"

export default async function CampanhasPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!(await hasModule(session.user.tenantId, "broadcasts"))) redirect("/inbox")
  const scope = await getViewerScope()
  if (!canOpenMarketing(scope)) redirect("/inbox")

  // Marketing exige número OFICIAL (Meta Cloud) — sem ele, a página orienta a conectar.
  const { data: inst } = await supabaseAdmin.from("whatsapp_instances")
    .select("id").eq("tenant_id", session.user.tenantId).eq("provider", "meta_cloud").limit(1).maybeSingle()

  const campaigns = await getCampaigns()

  return (
    <PageShell
      title="Campanhas"
      description="Dispare mensagens em massa pelo WhatsApp Oficial — para listas consentidas, com custo estimado antes do envio."
      icon={Megaphone}
    >
      <CampanhasClient campaigns={campaigns} hasOfficial={!!inst} />
    </PageShell>
  )
}
