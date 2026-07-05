import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Megaphone } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { hasModule } from "@/lib/modules"
import { getCampaignAudiences, getOutboundNumbers, getMarketingFlows } from "@/lib/actions/campaigns"
import { getInboxTemplates } from "@/lib/actions/whatsapp-official"
import { WizardClient } from "./wizard-client"

export default async function NovaCampanhaPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")
  if (!(await hasModule(session.user.tenantId, "broadcasts"))) redirect("/inbox")

  const [audiences, templates, numbers, flows] = await Promise.all([
    getCampaignAudiences(),
    getInboxTemplates(),
    getOutboundNumbers(),
    getMarketingFlows(),
  ])

  if (numbers.length === 0) redirect("/integracoes/whatsapp-oficial")

  return (
    <PageShell
      title="Nova campanha"
      description="Quatro passos: audiência, mensagem, envio e revisão — com o custo estimado antes de disparar."
      icon={Megaphone}
      actions={
        <Link href="/campanhas" className="h-9 px-3 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1.5 transition-colors">
          <ArrowLeft className="size-3.5" /> Voltar
        </Link>
      }
    >
      <WizardClient audiences={audiences} templates={templates} numbers={numbers} flows={flows} />
    </PageShell>
  )
}
