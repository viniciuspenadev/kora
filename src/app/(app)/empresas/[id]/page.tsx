import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { hasModule } from "@/lib/modules"
import { getViewerScope, canManageContacts } from "@/lib/visibility"
import { getCompanyOverview } from "@/lib/actions/companies"
import { CompanyPageClient } from "./company-page-client"

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!(await hasModule(session.user.tenantId, "crm"))) redirect("/inbox")

  const { id } = await params
  const [overview, scope] = await Promise.all([getCompanyOverview(id), getViewerScope()])
  if ("error" in overview) notFound()

  return <CompanyPageClient overview={overview} canManage={canManageContacts(scope)} />
}
