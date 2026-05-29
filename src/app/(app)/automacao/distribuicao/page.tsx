import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { Filter } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { getAutoAssignConfig, listAgentsForAutoAssign } from "@/lib/actions/auto-assign"
import { DistribuicaoClient } from "./client"

export default async function DistribuicaoPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const [config, agents] = await Promise.all([
    getAutoAssignConfig(),
    listAgentsForAutoAssign(),
  ])

  return (
    <PageShell
      title="Distribuição automática"
      description="Atribua novas conversas automaticamente entre os atendentes, com regras flexíveis e pause individual."
      icon={Filter}
    >
      <DistribuicaoClient initialConfig={config} initialAgents={agents} />
    </PageShell>
  )
}
