import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Plus } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { hasModule } from "@/lib/modules"
import { getViewerScope, canViewCatalog, canManageCatalog } from "@/lib/visibility"
import { getPriceTablesForSelect } from "@/lib/actions/price-lists"
import { getTableGrid } from "@/lib/actions/commercial"
import { CatalogClient, type VitrineData, type VitrineItem } from "./catalogo-client"

export default async function CatalogoPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  const scope = await getViewerScope()
  if (!canViewCatalog(scope)) redirect("/inbox")
  const [crm, inv] = await Promise.all([hasModule(scope.tenantId, "crm"), hasModule(scope.tenantId, "inventory")])
  if (!crm && !inv) redirect("/inbox")
  const canManage = canManageCatalog(scope)

  // A vitrine é a MATRIZ item×tabela. Compomos com a grade viva (price_entries,
  // em CENTAVOS) de cada tabela ativa — sem action nova: getTableGrid por tabela.
  const tableRefs = await getPriceTablesForSelect()
  const grids = await Promise.all(tableRefs.map((t) => getTableGrid(t.id)))

  const tables = tableRefs.map((t) => ({ id: t.id, name: t.name, isDefault: t.is_default }))

  // Metadados do item vêm de qualquer grade (idênticos entre tabelas). Células
  // (preço/promo/participação) por tabela.
  const itemsMap = new Map<string, VitrineItem>()
  const cells: VitrineData["cells"] = {}
  grids.forEach((grid, idx) => {
    if ("error" in grid) return
    const tableId = tableRefs[idx].id
    for (const r of grid.rows) {
      if (!itemsMap.has(r.itemId)) {
        itemsMap.set(r.itemId, {
          itemId: r.itemId, name: r.name, sku: r.sku, category: r.category,
          type: r.type, unit: r.unit, imagePath: r.imagePath, itemActive: r.itemActive,
        })
      }
      ;(cells[r.itemId] ??= {})[tableId] = {
        priceCents: r.priceCents, promoCents: r.promoCents, inTable: r.inTable, entryId: r.entryId,
      }
    }
  })

  const items = Array.from(itemsMap.values())
    .sort((a, b) => Number(b.itemActive) - Number(a.itemActive) || a.name.localeCompare(b.name))

  const data: VitrineData = { items, tables, cells }
  const subtitle = `${items.length} ${items.length === 1 ? "item" : "itens"} · ${tables.length} ${tables.length === 1 ? "tabela de preço" : "tabelas de preço"}`

  return (
    <PageShell
      variant="list"
      title="Catálogo"
      description={subtitle}
      actions={canManage ? (
        <>
          <Link href="/catalogo/tabelas"
            className="inline-flex items-center h-9 px-4 text-xs font-semibold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors">
            Tabelas de preço
          </Link>
          <Link href="/catalogo/novo"
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-lg bg-primary hover:bg-primary-700 text-white transition-colors">
            <Plus className="size-3.5" /> Novo item
          </Link>
        </>
      ) : undefined}
    >
      <CatalogClient data={data} canManage={canManage} />
    </PageShell>
  )
}
