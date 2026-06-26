import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { hasModule } from "@/lib/modules"
import { getDeal } from "@/lib/actions/deals"
import { listDealTasks } from "@/lib/actions/tasks"
import { DealPageClient } from "@/components/crm/deal-page-client"

export const dynamic = "force-dynamic"

export default async function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  const { id } = await params
  if (!(await hasModule(session.user.tenantId, "crm"))) redirect("/inbox")

  const [deal, tasks] = await Promise.all([getDeal(id), listDealTasks(id)])
  if ("error" in deal) redirect("/negocios")

  return <DealPageClient deal={deal} tasks={tasks} />
}
