import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { Mail } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { getDailyReportConfig } from "@/lib/actions/daily-reports"
import { RelatoriosClient } from "./client"

export default async function RelatoriosConfigPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const config = await getDailyReportConfig()
  if (!config) redirect("/inbox")

  return (
    <PageShell
      title="Relatórios automáticos"
      description="Configure o resumo diário enviado por email com KPIs do tenant."
      icon={Mail}
    >
      <RelatoriosClient config={config} />
    </PageShell>
  )
}
