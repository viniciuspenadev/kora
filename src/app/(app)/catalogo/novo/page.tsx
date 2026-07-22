import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { getViewerScope, canManageCatalog } from "@/lib/visibility"
import { hasModule } from "@/lib/modules"
import { getCatalogItems } from "@/lib/actions/catalog"
import { NovoItemClient } from "./novo-client"

export default async function NovoItemPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  const scope = await getViewerScope()
  if (!canManageCatalog(scope)) redirect("/catalogo")
  const [crm, inv] = await Promise.all([hasModule(scope.tenantId, "crm"), hasModule(scope.tenantId, "inventory")])
  if (!crm && !inv) redirect("/inbox")

  const items = await getCatalogItems()
  const categories = Array.from(new Set(items.map((i) => i.category).filter(Boolean))) as string[]

  return <NovoItemClient categories={categories.sort((a, b) => a.localeCompare(b))} hasInventory={inv} />
}
