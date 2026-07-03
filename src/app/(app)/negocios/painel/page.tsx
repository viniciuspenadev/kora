import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { hasModule } from "@/lib/modules"
import { getPipelineDashboard } from "@/lib/actions/pipeline-dashboard"
import { PainelClient } from "./painel-client"

// Painel do pipeline — compila o funil selecionado (referência: tela 5 do
// docs/crm-vision-capture.md). KPI-lente recolore tudo; troca de lente é
// client-side (uma busca lean por funil/período).
export default async function PainelNegociosPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")
  if (!(await hasModule(session.user.tenantId, "crm"))) redirect("/inbox")

  const DEFAULT_PERIOD = "365"   // "Último ano", como a referência
  const to   = new Date()
  const from = new Date(Date.now() - Number(DEFAULT_PERIOD) * 86_400_000)
  const data = await getPipelineDashboard({ from: from.toISOString(), to: to.toISOString() })
  if ("error" in data) redirect("/negocios")

  return <PainelClient initial={data} initialPeriod={DEFAULT_PERIOD} />
}
