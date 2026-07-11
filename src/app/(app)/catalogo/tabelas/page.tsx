import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { Table2 } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { hasModule } from "@/lib/modules"
import { getViewerScope, canManageCatalog } from "@/lib/visibility"
import { getPriceTables } from "@/lib/actions/price-lists"
import { TabelasClient } from "./tabelas-client"

export default async function TabelasPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  const scope = await getViewerScope()
  if (!canManageCatalog(scope)) redirect("/catalogo")   // tabelas = superfície de GESTÃO
  const [crm, inv] = await Promise.all([hasModule(scope.tenantId, "crm"), hasModule(scope.tenantId, "inventory")])
  if (!crm && !inv) redirect("/inbox")

  const tables = await getPriceTables()

  return (
    <PageShell
      title="Tabelas de preço"
      description="A bancada de gestão dos seus produtos e serviços — Varejo, Atacado… grade viva, reajuste em massa, tudo auditado."
      icon={Table2}
    >
      <TabelasClient tables={tables} />
    </PageShell>
  )
}
