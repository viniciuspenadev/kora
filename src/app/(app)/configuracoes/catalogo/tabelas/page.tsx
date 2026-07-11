import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { Table2 } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { hasModule } from "@/lib/modules"
import { getPriceTables } from "@/lib/actions/price-lists"
import { TabelasClient } from "./tabelas-client"

export default async function TabelasPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")
  if (!(await hasModule(session.user.tenantId, "crm"))) redirect("/inbox")

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
