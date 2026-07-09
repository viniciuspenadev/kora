import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { Table2 } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { hasModule } from "@/lib/modules"
import { getPriceTableGrid } from "@/lib/actions/price-lists"
import { listCustomFields } from "@/lib/actions/custom-fields"
import { TabelaGridClient } from "./grid-client"

export default async function TabelaDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")
  if (!(await hasModule(session.user.tenantId, "crm"))) redirect("/inbox")

  const { id } = await params
  const [grid, productFields] = await Promise.all([
    getPriceTableGrid(id),
    listCustomFields("product"),
  ])
  if ("error" in grid) notFound()

  return (
    <PageShell
      title={grid.table.name}
      description={grid.table.is_default
        ? "Grade viva da tabela padrão — editou, salvou, valeu. O catálogo espelha estes valores; tudo auditado."
        : `Grade viva do ${grid.table.name} — negócios nesta tabela preçam por aqui; tudo auditado. O catálogo segue espelhando a padrão.`}
      icon={Table2}
    >
      <TabelaGridClient grid={grid} productFields={productFields} />
    </PageShell>
  )
}
