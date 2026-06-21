import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { Briefcase } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { hasModule } from "@/lib/modules"
import { getDealsPage } from "@/lib/actions/deals"
import { NegociosClient } from "./negocios-client"

export default async function NegociosPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  // Centro de gestão = owner/admin. Gated pelo módulo crm.
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")
  if (!(await hasModule(session.user.tenantId, "crm"))) redirect("/inbox")

  const data = await getDealsPage()
  if ("error" in data) redirect("/inbox")

  return (
    <PageShell title="Negócios" description="Gerencie negócios, clientes e o funil de vendas." icon={Briefcase}>
      <NegociosClient data={data} />
    </PageShell>
  )
}
