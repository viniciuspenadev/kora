import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { hasModule } from "@/lib/modules"
import { getViewerScope, canOpenDeals } from "@/lib/visibility"
import { getDealsPage, getDealPipelines } from "@/lib/actions/deals"
import { NegociosClient } from "./negocios-client"

export default async function NegociosPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  // Board: owner/admin, supervisor (view_all) ou atendente com deals_access. Gated pelo módulo crm.
  if (!(await hasModule(session.user.tenantId, "crm"))) redirect("/inbox")
  const scope = await getViewerScope()
  if (!canOpenDeals(scope)) redirect("/inbox")

  const [data, pipelines] = await Promise.all([getDealsPage(), getDealPipelines()])
  if ("error" in data) redirect("/inbox")

  // Board ocupa a viewport inteira (o client controla a altura); os KPIs foram pra /negocios/painel.
  return <NegociosClient data={data} pipelines={pipelines} />
}
