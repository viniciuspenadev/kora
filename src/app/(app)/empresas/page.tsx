import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { hasModule } from "@/lib/modules"
import { getViewerScope, canManageContacts } from "@/lib/visibility"
import { getCompaniesRoster } from "@/lib/actions/companies"
import { EmpresasClient } from "./empresas-client"

export default async function EmpresasPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")

  const tenantId = session.user.tenantId
  // Gate: módulo CRM + tenant (empresas são tenant-wide por design — F2). Menu↔página
  // em paridade: o item da sidebar é gateado pelo mesmo módulo "crm".
  if (!(await hasModule(tenantId, "crm"))) redirect("/inbox")

  const [companies, scope] = await Promise.all([
    getCompaniesRoster(),
    getViewerScope(),
  ])

  return <EmpresasClient companies={companies} canManage={canManageContacts(scope)} />
}
