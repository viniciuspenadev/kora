import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { PageShell } from "@/components/ui/page-shell"
import { hasModule } from "@/lib/modules"
import { getViewerScope, canManageCatalog } from "@/lib/visibility"
import { getTableGrid } from "@/lib/actions/commercial"
import { TabelaGridClient, type TableRow } from "./grid-client"

export default async function TabelaDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  const scope = await getViewerScope()
  if (!canManageCatalog(scope)) redirect("/catalogo")   // grade de preços = GESTÃO
  const [crm, inv] = await Promise.all([hasModule(scope.tenantId, "crm"), hasModule(scope.tenantId, "inventory")])
  if (!crm && !inv) redirect("/inbox")

  const { id } = await params
  const grid = await getTableGrid(id)
  if ("error" in grid) notFound()

  const rows: TableRow[] = grid.rows.map((r) => ({
    itemId: r.itemId, name: r.name, sku: r.sku, category: r.category, type: r.type,
    unit: r.unit, imagePath: r.imagePath, itemActive: r.itemActive, inTable: r.inTable,
    priceCents: r.priceCents, promoCents: r.promoCents, inUse: r.inUse,
  }))
  const inCount = rows.filter((r) => r.inTable).length

  return (
    <PageShell
      variant="list"
      title={grid.table.name}
      description={`${inCount} ${inCount === 1 ? "item na tabela" : "itens na tabela"}${grid.table.is_default ? " · alimenta o catálogo" : ""}`}
    >
      <TabelaGridClient
        table={{ id: grid.table.id, name: grid.table.name, isDefault: grid.table.is_default, active: grid.table.active }}
        rows={rows}
      />
    </PageShell>
  )
}
