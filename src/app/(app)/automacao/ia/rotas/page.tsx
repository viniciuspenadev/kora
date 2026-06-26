import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { Share2 } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { BackToIA } from "../back-to-ia"
import { listRoutes } from "@/lib/actions/ai/routes"
import { RotasClient, type DepartmentOption } from "./rotas-client"

export default async function RotasPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const tenantId = session.user.tenantId
  if (!(await hasModule(tenantId, "ai_atendente"))) redirect("/automacao/mensagens")

  const [{ data: departments }, routes] = await Promise.all([
    supabaseAdmin
      .from("tenant_departments")
      .select("id, name, color")
      .eq("tenant_id", tenantId)
      .order("name"),
    listRoutes(),
  ])

  const deptOptions: DepartmentOption[] = (departments ?? []).map((d) => ({
    id:    d.id,
    name:  d.name,
    color: d.color,
  }))

  return (
    <PageShell
      title="Rotas"
      description="Pra quais departamentos a IA pode encaminhar — e o que ela coleta antes."
      icon={Share2}
      actions={<BackToIA />}
    >
      <RotasClient departments={deptOptions} routes={routes} />
    </PageShell>
  )
}
