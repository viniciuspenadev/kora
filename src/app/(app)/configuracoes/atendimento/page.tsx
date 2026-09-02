import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { Headset } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { hasModule } from "@/lib/modules"
import { AtendimentoClient } from "./atendimento-client"

export default async function AtendimentoConfigPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const tenantId = session.user.tenantId
  const [{ data: cfg, error: configError }, studioAi] = await Promise.all([
    supabaseAdmin
      .from("tenant_config")
      .select("handoff_binding, inactivity_enabled, inactivity_hours, inactivity_action, sla_first_response_minutes")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    hasModule(tenantId, "ai_studio"),
  ])

  if (configError) throw new Error("Não foi possível carregar a configuração de atendimento. Tente novamente.")

  // Vínculo = posse pura (carteira|pool). "IA no retorno" virou DERIVADO (painel
  // read-only). Legado: o antigo 3-way 'ai' mapeia pra pool.
  const rawBinding = (cfg?.handoff_binding as string | undefined) ?? "carteira"
  const binding: "carteira" | "pool" = rawBinding === "carteira" ? "carteira" : "pool"
  // Inatividade: hoje a única ação é AVISAR. Qualquer valor legado no banco
  // (reassign/pool/ai/redistribute) é exibido como "avisar" — que é o que o motor
  // de fato faz desde a remoção da distribuição, então tela e comportamento batem.
  const inactivityAction = "notify" as const

  return (
    <PageShell
      title="Atendimento"
      description="Vínculo com o cliente, avisos de inatividade e metas de resposta."
      icon={Headset}
    >
      <AtendimentoClient
        hasStudio={studioAi}
        binding={binding}
        inactivityEnabled={!!cfg?.inactivity_enabled}
        inactivityHours={cfg?.inactivity_hours ?? 4}
        inactivityAction={inactivityAction}
        slaMinutes={(cfg?.sla_first_response_minutes as number | null | undefined) ?? null}
      />
    </PageShell>
  )
}
