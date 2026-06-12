import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { hasModule } from "@/lib/modules"
import { listResources, listServices } from "@/lib/actions/agenda"
import { AgendaClient } from "@/components/agenda/agenda-client"

export default async function AgendaPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  const tenantId = session.user.tenantId

  // Módulo opt-in: sem ele, não há agenda pra esse tenant.
  if (!(await hasModule(tenantId, "agenda"))) redirect("/inbox")

  const isAdmin = ["owner", "admin"].includes(session.user.role)

  const [resources, services] = await Promise.all([listResources(), listServices()])

  return <AgendaClient resources={resources} services={services} isAdmin={isAdmin} userId={session.user.id} />
}
