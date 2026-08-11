import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { ClipboardList } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { hasModule } from "@/lib/modules"
import { getOutcomeReasons } from "@/lib/actions/outcome-reasons"
import { MotivosClient } from "./motivos-client"

export default async function MotivosPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")
  if (!(await hasModule(session.user.tenantId, "crm"))) redirect("/inbox")

  const reasons = await getOutcomeReasons("lost")

  return (
    <PageShell
      title="Motivos de perda dos negócios"
      description="Descubra, organize e gerencie seus motivos de perda."
      icon={ClipboardList}
    >
      <MotivosClient reasons={reasons} />
    </PageShell>
  )
}
