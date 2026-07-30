import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { checkLimit, monthlyQuotaResetsAt } from "@/lib/limits"
import { Network, ArrowLeft } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { FlowsClient } from "./flows-client"
import type { StudioFlowSummary } from "@/types/studio"

export default async function FluxosPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const tenantId = session.user.tenantId
  if (!(await hasModule(tenantId, "ai_studio"))) redirect("/inbox")

  const [{ data }, { data: steps }] = await Promise.all([
    supabaseAdmin
      .from("studio_flows")
      .select("id, name, status, active, version, purpose, trigger, updated_at")
      .eq("tenant_id", tenantId)
      .neq("status", "archived")
      .order("updated_at", { ascending: false }),
    // Acionamentos por fluxo: cada run loga 1 passo de entrada (entered_from null).
    // Dedup por run_id (belt-and-suspenders). Cap defensivo no volume.
    supabaseAdmin
      .from("studio_flow_steps")
      .select("flow_id, run_id")
      .eq("tenant_id", tenantId)
      .is("entered_from", null)
      .limit(50000),
  ])

  // Cota de automação do Instagram — 4ª camada de aviso (docs/instagram-modulo-e-limites.md
  // §4.1): "no momento da confusão". As outras três (sininho, push, /configuracoes/uso)
  // avisam ANTES; esta é a que responde à pergunta que o dono faz DEPOIS, olhando pro
  // fluxo: "está Publicado · Ativo, por que parou de capturar?". Sem ela, ele mexe no
  // fluxo — que não tem defeito nenhum — em vez de subir de plano.
  // Só consulta quem tem a licença: pra todo o resto isso não é um estado que exista.
  const igQuota = (await hasModule(tenantId, "instagram_automation"))
    ? await checkLimit(tenantId, "instagram_automations_per_month").catch(() => null)
    : null

  const activations: Record<string, number> = {}
  const seen = new Map<string, Set<string>>()
  for (const s of (steps ?? []) as { flow_id: string; run_id: string }[]) {
    let set = seen.get(s.flow_id)
    if (!set) { set = new Set(); seen.set(s.flow_id, set) }
    set.add(s.run_id)
  }
  for (const [f, set] of seen) activations[f] = set.size

  return (
    <PageShell
      title="Fluxos"
      description="Automações que conduzem a conversa. A IA é um passo opcional dentro delas."
      icon={Network}
      actions={
        <Link
          href="/studio"
          className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="size-3.5" /> Studio
        </Link>
      }
    >
      <FlowsClient
        flows={(data ?? []) as StudioFlowSummary[]}
        activations={activations}
        igQuota={igQuota && !igQuota.ok
          ? { used: igQuota.used, max: igQuota.max ?? 0, resetsAt: monthlyQuotaResetsAt() }
          : null}
      />
    </PageShell>
  )
}
