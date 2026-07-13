import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { Package } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { hasModule } from "@/lib/modules"
import { getViewerScope, canViewCatalog, canManageCatalog } from "@/lib/visibility"
import { getCatalogItems, getCatalogPriceTrends, getCatalogTablePrices } from "@/lib/actions/catalog"
import { CatalogClient } from "./catalogo-client"

export default async function CatalogoPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  const scope = await getViewerScope()
  if (!canViewCatalog(scope)) redirect("/inbox")
  const [crm, inv] = await Promise.all([hasModule(scope.tenantId, "crm"), hasModule(scope.tenantId, "inventory")])
  if (!crm && !inv) redirect("/inbox")

  const [items, trends, tablePrices] = await Promise.all([
    getCatalogItems(), getCatalogPriceTrends(), getCatalogTablePrices(),
  ])

  return (
    <PageShell
      variant="list"
      title="Catálogo"
      description="A vitrine dos seus produtos e serviços — preço por tabela, tendência e histórico. A gestão mora nas tabelas de preço."
      icon={Package}
    >
      <CatalogClient items={items} trends={trends} tablePrices={tablePrices} canManage={canManageCatalog(scope)} />
    </PageShell>
  )
}
