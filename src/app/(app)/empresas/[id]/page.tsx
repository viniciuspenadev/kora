import { notFound, redirect } from "next/navigation"
import { auth } from "@/auth"
import { hasModule } from "@/lib/modules"
import { getViewerScope, canManageContacts } from "@/lib/visibility"
import { getCompanyCockpit } from "@/lib/actions/companies"
import { CompanyPageClient } from "./company-page-client"

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!(await hasModule(session.user.tenantId, "crm"))) redirect("/inbox")

  const { id } = await params
  const [cockpit, scope] = await Promise.all([getCompanyCockpit(id), getViewerScope()])
  if ("error" in cockpit) notFound()

  return <CompanyPageClient cockpit={cockpit} canManage={canManageContacts(scope)} />
}
