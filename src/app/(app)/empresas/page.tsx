import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { getViewerScope, canManageContacts } from "@/lib/visibility"
import { getCompanies } from "@/lib/actions/companies"
import { EmpresasClient } from "./empresas-client"

export default async function EmpresasPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")

  const tenantId = session.user.tenantId
  // Gate: módulo CRM + tenant (empresas são tenant-wide por design — F2). Menu↔página
  // em paridade: o item da sidebar é gateado pelo mesmo módulo "crm".
  if (!(await hasModule(tenantId, "crm"))) redirect("/inbox")

  const [initial, scope, { count }] = await Promise.all([
    getCompanies({ limit: 30 }),
    getViewerScope(),
    supabaseAdmin.from("tenant_companies").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
  ])

  return (
    <EmpresasClient
      initial={initial}
      total={count ?? initial.items.length}
      canManage={canManageContacts(scope)}
    />
  )
}
