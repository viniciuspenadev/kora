import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { checkLimit, monthlyQuotaResetsAt } from "@/lib/limits"
import { Network } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { FlowsClient } from "./flows-client"
import { FlowsActions } from "./flows-actions"
import type { StudioFlowSummary } from "@/types/studio"

/** Início da janela de 30 dias (ISO). Fora do componente: `Date.now()` chamado direto no
 *  corpo do render cai na regra `react-hooks/purity`. */
const windowStart30d = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

export default async function FluxosPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const tenantId = session.user.tenantId
  if (!(await hasModule(tenantId, "ai_studio"))) redirect("/inbox")

  // Janela de 30 dias: o card do topo diz "acionamentos (30 dias)", então a coluna da
  // tabela conta a MESMA janela. Número de topo e número de linha que discordam é o tipo
  // de coisa que faz o dono desconfiar da tela inteira.
  const since = windowStart30d()

  const [{ data }, { data: steps }, { data: errRuns }] = await Promise.all([
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
      .gte("at", since)
      .limit(50000),
    // ⚠️ COBERTURA PARCIAL, de propósito e documentada: `studio_runs` é o ledger de
    // **IA** — só ganha linha quando um nó de IA roda. Fluxo de automação pura (menu,
    // mensagem, comentário do Instagram) NUNCA escreve aqui, então uma falha nele não
    // aparece neste número. Enquanto o runtime não persistir erro por passo, este card
    // responde "erro na IA", não "erro no fluxo" — e o rótulo na tela diz isso.
    supabaseAdmin
      .from("studio_runs")
      .select("flow_id")
      .eq("tenant_id", tenantId)
      .not("error", "is", null)
      .gte("created_at", since)
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

  // Add-on `ai`: sem ele Persona/Conhecimento não existem pro tenant, e o menu da IA some
  // (a página de destino já recusa — aqui é o espelho na UI, não a trava).
  const hasAi = await hasModule(tenantId, "ai")

  const activations: Record<string, number> = {}
  const seen = new Map<string, Set<string>>()
  for (const s of (steps ?? []) as { flow_id: string; run_id: string }[]) {
    let set = seen.get(s.flow_id)
    if (!set) { set = new Set(); seen.set(s.flow_id, set) }
    set.add(s.run_id)
  }
  for (const [f, set] of seen) activations[f] = set.size

  // Fluxos DISTINTOS com pelo menos um erro na janela (não o total de erros): o card
  // conta fluxo, e é fluxo que o dono vai abrir pra consertar.
  const errored = new Set((errRuns ?? []).map((r) => (r as { flow_id: string | null }).flow_id).filter(Boolean) as string[])

  // Título assume "Kora Studio": esta página É o Studio agora (o hub virou redirect), e o
  // item do menu tem esse nome — cabeçalho com outro nome faz o dono achar que clicou
  // errado. O "← Studio" saiu junto: apontava pra uma página que só redireciona pra cá.
  return (
    <PageShell
      title="Kora Studio"
      description="Automações que conduzem a conversa. A IA é um passo opcional dentro delas."
      icon={Network}
      actions={<FlowsActions hasAi={hasAi} />}
    >
      <FlowsClient
        flows={(data ?? []) as StudioFlowSummary[]}
        activations={activations}
        erroredFlowIds={[...errored]}
        igQuota={igQuota && !igQuota.ok
          ? { used: igQuota.used, max: igQuota.max ?? 0, resetsAt: monthlyQuotaResetsAt() }
          : null}
      />
    </PageShell>
  )
}
