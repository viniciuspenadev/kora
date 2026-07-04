import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { Package } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { hasModule } from "@/lib/modules"
import { getCatalogItems, getCatalogPriceTrends } from "@/lib/actions/catalog"
import { CatalogClient } from "./catalogo-client"

export default async function CatalogoPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")
  if (!(await hasModule(session.user.tenantId, "crm"))) redirect("/inbox")

  const [items, trends] = await Promise.all([getCatalogItems(), getCatalogPriceTrends()])

  return (
    <PageShell
      title="Catálogo"
      description="A vitrine dos seus produtos e serviços — preço atual, tendência e histórico. A gestão mora nas tabelas de preço."
      icon={Package}
    >
      <CatalogClient items={items} trends={trends} />
    </PageShell>
  )
}
