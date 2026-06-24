import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { Gauge } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { listAllLimits } from "@/lib/limits"
import { supabaseAdmin } from "@/lib/supabase"
import { UsageClient } from "./client"

export default async function UsagePage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const [limits, { data: tenant }] = await Promise.all([
    listAllLimits(session.user.tenantId),
    supabaseAdmin
      .from("tenants")
      .select("name, plan, created_at")
      .eq("id", session.user.tenantId)
      .single(),
  ])

  return (
    <PageShell
      title="Uso e limites"
      description="Acompanhe o que você está consumindo. Limites são definidos pelo seu plano e podem ser ajustados sob demanda."
      icon={Gauge}
    >
      <UsageClient
        limits={limits}
        tenantName={tenant?.name ?? ""}
        tenantPlan={tenant?.plan ?? "trial"}
      />
    </PageShell>
  )
}
