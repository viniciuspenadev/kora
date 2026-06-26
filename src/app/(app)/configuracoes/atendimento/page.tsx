import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { Headset } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { getAutoAssignConfig, listAgentsForAutoAssign } from "@/lib/actions/auto-assign"
import { listFlows } from "@/lib/actions/studio/flows"
import { hasModule } from "@/lib/modules"
import { AtendimentoClient } from "./atendimento-client"

export default async function AtendimentoConfigPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const tenantId = session.user.tenantId
  const [config, agents, { data: cfg }, studioAi, v1Ai] = await Promise.all([
    getAutoAssignConfig(),
    listAgentsForAutoAssign(),
    supabaseAdmin
      .from("tenant_config")
      .select("handoff_binding, reopen_to_ai, reopen_flow_id, inactivity_enabled, inactivity_hours, inactivity_action")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    hasModule(tenantId, "ai_studio"),
    hasModule(tenantId, "ai_atendente"),
  ])
  const hasAi = studioAi || v1Ai

  // Fluxos pro picker de retorno (IA atende o retorno) — só faz sentido com o
  // Studio, e só os publicados+ativos podem realmente rodar.
  const flows = studioAi
    ? (await listFlows())
        .filter((f) => f.status === "published" && f.active)
        .map((f) => ({ id: f.id, name: f.name }))
    : []

  // Vínculo (carteira|pool) + "IA atende o retorno" são ortogonais. Legado: o antigo
  // 3-way 'ai' = ownerless + IA-on → mapeia pra pool + reopen_to_ai (mesma intenção).
  const rawBinding = (cfg?.handoff_binding as string | undefined) ?? "carteira"
  const binding: "carteira" | "pool" = rawBinding === "carteira" ? "carteira" : "pool"
  const reopenToAi = !!cfg?.reopen_to_ai || rawBinding === "ai"
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
        flows={flows}
        binding={binding}
        reopenToAi={reopenToAi}
        reopenFlowId={(cfg?.reopen_flow_id as string | null | undefined) ?? null}
        inactivityEnabled={!!cfg?.inactivity_enabled}
        inactivityHours={cfg?.inactivity_hours ?? 4}
        inactivityAction={inactivityAction}
      />
    </PageShell>
  )
}
