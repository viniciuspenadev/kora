import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { getViewerScope, canViewCatalog, canManageCatalog } from "@/lib/visibility"
import { hasModule } from "@/lib/modules"
import { getCatalogItem } from "@/lib/actions/catalog"
import { getItemPrices } from "@/lib/actions/commercial"
import { listCustomFields } from "@/lib/actions/custom-fields"
import { FichaClient } from "./ficha-client"

export default async function CatalogItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  if (!session) redirect("/auth/signin")
  const scope = await getViewerScope()
  if (!canViewCatalog(scope)) redirect("/inbox")
  const [crm, inv] = await Promise.all([hasModule(scope.tenantId, "crm"), hasModule(scope.tenantId, "inventory")])
  if (!crm && !inv) redirect("/inbox")

  const item = await getCatalogItem(id)
  if (!item) notFound()

  const [prices, customFields] = await Promise.all([
    getItemPrices(id),
    listCustomFields("product"),
  ])

  return (
    <FichaClient
      item={item}
      prices={prices.tables}
      customFields={customFields}
      canManage={canManageCatalog(scope)}
      hasInventory={inv}
    />
  )
}
