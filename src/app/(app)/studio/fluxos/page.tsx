import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { checkLimit, monthlyQuotaResetsAt } from "@/lib/limits"
import Link from "next/link"
import { Network, Plug } from "lucide-react"
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

  // 🔴 FLUXO SEM CANAL NÃO DISPARA — e a tela não dizia isso. A pessoa montava a
  //    automação inteira, publicava, e ficava esperando um acionamento que nunca vinha:
  //    todo gatilho do Studio nasce de uma mensagem, e sem canal conectado não existe
  //    mensagem pra nascer. O sintoma ("publiquei e não aconteceu nada") aponta pro
  //    fluxo, que não tem defeito nenhum — mesma armadilha que o aviso de cota do
  //    Instagram logo acima existe pra evitar.
  // ⚠️ Conta QUALQUER canal, não só WhatsApp: Instagram e o widget do site também
  //    disparam fluxo. Exigir WhatsApp aqui esconderia a tela de quem opera só no Direct.
  const [{ data: waLive }, { data: igLive }, { data: siteLive }] = await Promise.all([
    supabaseAdmin.from("whatsapp_instances").select("id")
      .eq("tenant_id", tenantId).in("status", ["connected", "open"]).limit(1).maybeSingle(),
    // ⚠️ `channel_connections` + `channel='instagram'` — a MESMA leitura de /integracoes.
    //    A 1ª versão disto consultou `instagram_accounts`, tabela que **não existe**: o
    //    `tsc` não valida nome de tabela, o PostgREST devolveria erro e o `data` viria
    //    nulo — ou seja, quem opera SÓ no Direct veria "conecte um canal" pra sempre, sem
    //    nenhum erro na tela. Conferido ao vivo antes de fechar.
    supabaseAdmin.from("channel_connections").select("id")
      .eq("tenant_id", tenantId).eq("channel", "instagram").eq("status", "active")
      .limit(1).maybeSingle(),
    supabaseAdmin.from("site_widget_config").select("enabled")
      .eq("tenant_id", tenantId).eq("enabled", true).limit(1).maybeSingle(),
  ])
  const temCanal = !!waLive || !!igLive || !!siteLive

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
      {!temCanal && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <Plug className="size-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-900">Conecte um canal para as automações rodarem</p>
            <p className="mt-1 text-xs text-amber-800 leading-relaxed">
              Todo fluxo começa com uma mensagem recebida. Sem WhatsApp, Instagram ou o widget
              do site conectado, você consegue montar e publicar — mas nada vai acionar.
            </p>
          </div>
          <Link href="/integracoes" className="shrink-0 inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors">
            Conectar canal
          </Link>
        </div>
      )}

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
