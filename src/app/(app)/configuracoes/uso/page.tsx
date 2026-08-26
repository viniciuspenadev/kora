import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { Gauge } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { listAllLimits, getStorageBreakdown } from "@/lib/limits"
import { hasModule } from "@/lib/modules"
import { supabaseAdmin } from "@/lib/supabase"
import { UsageClient } from "./client"

/** Início da janela de 30 dias (ISO). Fora do componente: `Date.now()` no corpo do render
 *  cai na regra `react-hooks/purity`. */
const since30d = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

export default async function UsagePage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const day30 = since30d()
  const [allLimits, { data: tenant }, { data: aiRows }, igAutomation, storage] = await Promise.all([
    listAllLimits(session.user.tenantId),
    supabaseAdmin
      .from("tenants")
      .select("name, plan, plan_id, created_at, plans(name)")
      .eq("id", session.user.tenantId)
      .single(),
    // Uso de IA (30d) — UNIDADES pro tenant (respostas/áudios); custo USD é
    // interno da plataforma e mora no God Mode (aba IA do tenant).
    supabaseAdmin
      .from("studio_runs")
      .select("kind")
      .eq("tenant_id", session.user.tenantId)
      .gte("created_at", day30),
    hasModule(session.user.tenantId, "instagram_automation"),
    // Quebra do armazenamento por origem. Mesma fonte do `storage_mb` (RPC sobre o
    // bucket), então o total e as partes nunca divergem — um é a soma do outro.
    getStorageBreakdown(session.user.tenantId),
  ])

  // Cota de recurso que o tenant NÃO licencia é ruído ("0 / 50" de algo que ele não tem).
  // O god mode segue vendo todos os recursos — lá o ponto é justamente ajustar o teto.
  const limits = igAutomation
    ? allLimits
    : allLimits.filter((l) => l.resource !== "instagram_automations_per_month")

  let aiReplies = 0, aiTranscriptions = 0, aiSupport = 0
  for (const r of aiRows ?? []) {
    if (r.kind === "node_exec" || r.kind === "agent_turn") aiReplies++
    else if (r.kind === "transcription") aiTranscriptions++
    else aiSupport++   // router / dossier / ai_parse — operações de apoio
  }

  const planRelation = (tenant as unknown as {
    plan_id?: string | null
    plans?: { name: string } | { name: string }[] | null
  } | null)?.plans
  const canonicalPlanName = Array.isArray(planRelation) ? planRelation[0]?.name : planRelation?.name
  const tenantPlan = tenant?.plan_id
    ? (canonicalPlanName ?? "Plano indisponível")
    : (tenant?.plan ?? "Sem plano")

  return (
    <PageShell
      title="Uso e limites"
      description="Acompanhe o que você está consumindo. Limites são definidos pelo seu plano e podem ser ajustados sob demanda."
      icon={Gauge}
    >
      <UsageClient
        limits={limits}
        tenantName={tenant?.name ?? ""}
        tenantPlan={tenantPlan}
        aiUsage={{ replies: aiReplies, transcriptions: aiTranscriptions, support: aiSupport }}
        storage={storage}
      />
    </PageShell>
  )
}
