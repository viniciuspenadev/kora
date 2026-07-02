import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { Headset } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { getAutoAssignConfig, listAgentsForAutoAssign } from "@/lib/actions/auto-assign"
import { getReturnRouting } from "@/lib/actions/atendimento"
import { hasModule } from "@/lib/modules"
import { AtendimentoClient } from "./atendimento-client"

export default async function AtendimentoConfigPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const tenantId = session.user.tenantId
  const [config, agents, { data: cfg }, studioAi, v1Ai, returnRouting] = await Promise.all([
    getAutoAssignConfig(),
    listAgentsForAutoAssign(),
    supabaseAdmin
      .from("tenant_config")
      .select("handoff_binding, inactivity_enabled, inactivity_hours, inactivity_action")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    hasModule(tenantId, "ai_studio"),
    hasModule(tenantId, "ai_atendente"),
    getReturnRouting(),
  ])
  const hasAi = studioAi || v1Ai

  // Vínculo = posse pura (carteira|pool). "IA no retorno" virou DERIVADO (painel
  // read-only). Legado: o antigo 3-way 'ai' mapeia pra pool.
  const rawBinding = (cfg?.handoff_binding as string | undefined) ?? "carteira"
  const binding: "carteira" | "pool" = rawBinding === "carteira" ? "carteira" : "pool"
  // Inatividade: mapeia valores legados (reassign/pool) → 'redistribute'.
  const rawAct = (cfg?.inactivity_action as string | undefined) ?? "notify"
  const inactivityAction: "notify" | "redistribute" | "ai" =
    rawAct === "ai" ? "ai"
    : (rawAct === "reassign" || rawAct === "pool" || rawAct === "redistribute") ? "redistribute"
    : "notify"

  return (
    <PageShell
      title="Atendimento"
      description="Como as conversas são distribuídas, pra quem o cliente volta, e o que fazer quando ninguém responde."
      icon={Headset}
    >
      <AtendimentoClient
        initialConfig={config}
        initialAgents={agents}
        hasAi={hasAi}
        hasStudio={studioAi}
        binding={binding}
        returnRouting={returnRouting}
        inactivityEnabled={!!cfg?.inactivity_enabled}
        inactivityHours={cfg?.inactivity_hours ?? 4}
        inactivityAction={inactivityAction}
      />
    </PageShell>
  )
}
