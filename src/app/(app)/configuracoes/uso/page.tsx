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

  const day30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const [limits, { data: tenant }, { data: aiRows }] = await Promise.all([
    listAllLimits(session.user.tenantId),
    supabaseAdmin
      .from("tenants")
      .select("name, plan, created_at")
      .eq("id", session.user.tenantId)
      .single(),
    // Uso de IA (30d) — UNIDADES pro tenant (respostas/áudios); custo USD é
    // interno da plataforma e mora no God Mode (aba IA do tenant).
    supabaseAdmin
      .from("studio_runs")
      .select("kind")
      .eq("tenant_id", session.user.tenantId)
      .gte("created_at", day30),
  ])

  let aiReplies = 0, aiTranscriptions = 0, aiSupport = 0
  for (const r of aiRows ?? []) {
    if (r.kind === "node_exec" || r.kind === "agent_turn") aiReplies++
    else if (r.kind === "transcription") aiTranscriptions++
    else aiSupport++   // router / dossier / ai_parse — operações de apoio
  }

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
        aiUsage={{ replies: aiReplies, transcriptions: aiTranscriptions, support: aiSupport }}
      />
    </PageShell>
  )
}
