import { auth } from "@/auth"
import { redirect } from "next/navigation"
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
  const active = tables.filter((t) => t.active).length

  return (
    <PageShell
      variant="list"
      title="Tabelas de preço"
      description={`${active} ${active === 1 ? "tabela ativa" : "tabelas ativas"} · a padrão alimenta o catálogo — edite a grade, reajuste em massa, tudo auditado`}
    >
      <TabelasClient tables={tables} />
    </PageShell>
  )
}
