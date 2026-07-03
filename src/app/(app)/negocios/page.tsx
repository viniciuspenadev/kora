import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { hasModule } from "@/lib/modules"
import { getDealsPage, getDealPipelines } from "@/lib/actions/deals"
import { NegociosClient } from "./negocios-client"

export default async function NegociosPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  // Centro de gestão = owner/admin. Gated pelo módulo crm.
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")
  if (!(await hasModule(session.user.tenantId, "crm"))) redirect("/inbox")

  const [data, pipelines] = await Promise.all([getDealsPage(), getDealPipelines()])
  if ("error" in data) redirect("/inbox")

  // Board ocupa a viewport inteira (o client controla a altura); os KPIs foram pra /negocios/painel.
  return <NegociosClient data={data} pipelines={pipelines} />
}
