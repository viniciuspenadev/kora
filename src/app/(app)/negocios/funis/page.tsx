import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { hasModule } from "@/lib/modules"
import { getDealFunnels } from "@/lib/actions/deal-pipelines"
import { DealFunnelsManager } from "./deal-funnels-manager"

export const dynamic = "force-dynamic"

export default async function DealFunnelsPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/negocios")
  if (!(await hasModule(session.user.tenantId, "crm"))) redirect("/inbox")

  const funnels = await getDealFunnels()
  return <div className="p-6"><DealFunnelsManager funnels={funnels} /></div>
}
