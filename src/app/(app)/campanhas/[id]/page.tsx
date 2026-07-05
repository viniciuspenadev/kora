import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Megaphone } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { hasModule } from "@/lib/modules"
import { getCampaign } from "@/lib/actions/campaigns"
import { CampanhaDetailClient } from "./campanha-detail-client"

export default async function CampanhaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")
  if (!(await hasModule(session.user.tenantId, "broadcasts"))) redirect("/inbox")

  const { id } = await params
  const c = await getCampaign(id)
  if ("error" in c) notFound()

  return (
    <PageShell
      title={c.name}
      description="Transmissão — acompanhe o disparo ao vivo, pause e retome quando quiser."
      icon={Megaphone}
      actions={
        <Link href="/campanhas" className="h-9 px-3 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1.5 transition-colors">
          <ArrowLeft className="size-3.5" /> Voltar
        </Link>
      }
    >
      <CampanhaDetailClient campaign={c} />
    </PageShell>
  )
}
