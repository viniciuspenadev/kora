import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { Package } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { hasModule } from "@/lib/modules"
import { getCatalogItems } from "@/lib/actions/catalog"
import { CatalogClient } from "./catalogo-client"

export default async function CatalogoPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")
  if (!(await hasModule(session.user.tenantId, "crm"))) redirect("/inbox")

  const items = await getCatalogItems()

  return (
    <PageShell
      title="Catálogo"
      description="Produtos e serviços que compõem o valor dos seus negócios — avulsos ou recorrentes."
      icon={Package}
    >
      <CatalogClient items={items} />
    </PageShell>
  )
}
