import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule, hasModulePro } from "@/lib/modules"
import { loadTenantChannels, loadTenantInstances, loadTenantAds } from "@/lib/studio/trigger-meta"
import { memberAttendsNumber } from "@/lib/visibility"
import { FlowEditorCanvas } from "./editor-canvas"
import type { StudioAgentOption, StudioKanbanOption } from "./config-panel"
import type { StudioFlowFull } from "@/types/studio"
import type { FormTriggerOption } from "@/lib/forms/flow-variables"

// Número que nenhum atendente tem na lista: `memberAttendsNumber` só devolve true para ele
// quando a pessoa atende TODOS os números (owner/admin/supervisor/sem restrição).
const NO_SUCH_NUMBER = "00000000-0000-0000-0000-000000000000"

export default async function FlowEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const tenantId = session.user.tenantId
  if (!(await hasModule(tenantId, "ai_studio"))) redirect("/inbox")

  const [{ data: flow }, { data: depts }, { data: flowList }, { data: stageList }, { data: tagList }, { data: svcList }, { data: resList }, { data: agentRows }, { data: dealFieldRows }] = await Promise.all([
    supabaseAdmin.from("studio_flows")
      .select("id, name, status, active, version, trigger, graph")
      .eq("tenant_id", tenantId).eq("id", id).maybeSingle(),
    supabaseAdmin.from("tenant_departments").select("id, name").eq("tenant_id", tenantId),
    // Fluxos alvo do nó "Executar fluxo" (exclui o próprio + arquivados).
    supabaseAdmin.from("studio_flows")
      .select("id, name")
      .eq("tenant_id", tenantId).neq("status", "archived").neq("id", id)
      .order("name"),
    // Etapas dos kanbans de ATENDIMENTO: nó "Mover etapa" (agrupadas por kanban) e Agente IA (lista simples).
    supabaseAdmin.from("pipeline_stages").select("id, name, position, pipeline_id, color, is_won, is_lost, is_triage, show_in_kanban").eq("tenant_id", tenantId).order("position"),
    // Etiquetas existentes pro nó "Etiquetar" (seletor, não texto livre).
    supabaseAdmin.from("tags").select("id, name, color").eq("tenant_id", tenantId).order("name"),
    // Serviços + agendas pro destino da agenda ("em qual agenda cai") — resource_ids e
    // working_hours alimentam a LEGENDA dinâmica do painel (quem entra no sorteio /
    // quem abre fim de semana). agenda-node-redesign.md §3.5.
    supabaseAdmin.from("tenant_services").select("id, name, resource_ids").eq("tenant_id", tenantId).eq("active", true).order("name"),
    supabaseAdmin.from("tenant_resources").select("id, name, working_hours").eq("tenant_id", tenantId).eq("active", true).order("name"),
    // Atendentes ativos pro nó Transferir. Setor e números alimentam o painel: contagem por
    // departamento, subtítulo e "não atende o número deste fluxo" — derivado, não explicado.
    supabaseAdmin.from("tenant_users")
      .select("user_id, department_id, role, view_all, instance_ids, profiles!tenant_users_user_id_fkey ( full_name )")
      .eq("tenant_id", tenantId).eq("active", true),
    // Campos personalizados de NEGÓCIO — a Fonte de Consulta escolhe quais expor à IA.
    supabaseAdmin.from("tenant_custom_fields").select("id, label")
      .eq("tenant_id", tenantId).eq("entity", "deal").eq("active", true).order("position"),
  ])
  if (!flow) redirect("/studio/fluxos")

  // Normaliza o embed (PostgREST pode tipar como array) → { id, name } ordenado.
  const agents: StudioAgentOption[] = ((agentRows ?? []) as {
    user_id: string; department_id: string | null; role: string; view_all: boolean | null; instance_ids: string[] | null
    profiles: { full_name: string | null } | { full_name: string | null }[] | null
  }[])
    .map((r) => {
      const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
      return {
        id: r.user_id, name: p?.full_name ?? "Atendente", departmentId: r.department_id ?? null,
        // A regra de número é a de `visibility.ts` (fonte única), aplicada aqui no servidor.
        attendsAll:  memberAttendsNumber(r, NO_SUCH_NUMBER),
        instanceIds: Array.isArray(r.instance_ids) ? r.instance_ids : [],
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))

  // Gate (god mode): binding "Dono da conversa" nos nós de agendamento (beta).
  // + opções de canal/instância pro filtro do gatilho (derivadas do tenant).
  // + estado do Instagram pro gatilho de comentário: conexão ATIVA (senão não há o que
  //   configurar) e licença do módulo `instagram_automation` (filho do Kora Studio —
  //   `hasModule` já exige o pai recursivamente, fail-closed no banco).
  const [ownerRouting, channels, instances, ads, igLicensed, igPro, { data: igConn }, { data: hoursCfg }, { data: pipelineRows }, formsLicensed] = await Promise.all([
    hasModule(tenantId, "agenda_owner_routing"),
    loadTenantChannels(tenantId),
    loadTenantInstances(tenantId),
    loadTenantAds(tenantId),
    hasModule(tenantId, "instagram_automation"),
    hasModulePro(tenantId, "instagram_automation"),
    // ⚠️ `.limit(1)` e NUNCA `.maybeSingle()`: com DUAS contas de Instagram ativas o
    //    PostgREST devolve PGRST116, `igConn` vira null e o editor diz "não conectado"
    //    com as duas contas na tela de Integrações. Mesma armadilha de `getInstagramSender`.
    supabaseAdmin.from("channel_connections").select("username, meta")
      .eq("tenant_id", tenantId).eq("channel", "instagram").eq("status", "active")
      .order("created_at", { ascending: true }).limit(1),
    // O "fora do horário" do nó Transferir só existe com o horário comercial ligado.
    supabaseAdmin.from("tenant_config").select("business_hours_enabled").eq("tenant_id", tenantId).maybeSingle(),
    // Kanbans de atendimento pro nó "Mover etapa" (nomes de etapa repetem entre eles).
    supabaseAdmin.from("pipelines").select("id, name, color, is_default, active, position").eq("tenant_id", tenantId).order("position"),
    // Gatilho "Formulário enviado" (módulo Formulários).
    hasModule(tenantId, "forms"),
  ])

  // Formulários da empresa pro gatilho — com as perguntas (viram {{resposta.<chave>}}).
  const { data: formRows } = formsLicensed
    ? await supabaseAdmin.from("forms").select("id, name, status, questions:draft->questions")
        .eq("tenant_id", tenantId).is("archived_at", null).order("name")
    : { data: [] }
  const formOptions: FormTriggerOption[] = ((formRows ?? []) as { id: string; name: string; status: string; questions: unknown }[])
    .map((f) => ({
      id: f.id, name: f.name,
      status: f.status === "published" || f.status === "paused" ? f.status : "draft",
      questions: (Array.isArray(f.questions) ? f.questions : [])
        .filter((q): q is { id: string; title?: string } => !!q && typeof (q as { id?: unknown }).id === "string")
        .map((q) => ({ id: q.id, title: typeof q.title === "string" ? q.title : "" })),
    }))

  type StageRow = { id: string; name: string; pipeline_id: string; color: string | null; is_won: boolean | null; is_lost: boolean | null; is_triage: boolean | null; show_in_kanban: boolean | null }
  const stageRows = (stageList ?? []) as StageRow[]
  const kanbans: StudioKanbanOption[] = ((pipelineRows ?? []) as { id: string; name: string; color: string | null; is_default: boolean | null; active: boolean | null }[])
    .map((p) => ({
      id: p.id, name: p.name, color: p.color ?? null, isDefault: p.is_default === true, active: p.active !== false,
      stages: stageRows.filter((s) => s.pipeline_id === p.id).map((s) => ({
        id: s.id, name: s.name, color: s.color ?? null,
        isWon: s.is_won === true, isLost: s.is_lost === true, isTriage: s.is_triage === true,
        // Mesma regra do motor (move-conversation.ts): oculta e não-triagem é recusada.
        available: s.show_in_kanban !== false || s.is_triage === true,
      })),
    }))

  return (
    <FlowEditorCanvas
      flow={flow as StudioFlowFull}
      departments={(depts ?? []) as { id: string; name: string }[]}
      agents={agents}
      businessHoursEnabled={hoursCfg?.business_hours_enabled === true}
      kanbans={kanbans}
      flows={(flowList ?? []) as { id: string; name: string }[]}
      stages={(stageList ?? []) as { id: string; name: string }[]}
      tags={(tagList ?? []) as { id: string; name: string; color?: string | null }[]}
      services={(svcList ?? []) as { id: string; name: string }[]}
      resources={(resList ?? []) as { id: string; name: string }[]}
      dealFields={(dealFieldRows ?? []) as { id: string; label: string }[]}
      ownerRouting={ownerRouting}
      channels={channels}
      instances={instances}
      ads={ads}
      ig={{
        connected: !!igConn?.[0],
        username:  (igConn?.[0]?.username as string | null) ?? null,
        licensed:  igLicensed,
        // Nível PRO do módulo — decide o ❤️ automático. O gate REAL é no envio.
        pro:       igPro,
        // 🔴 Disponibilidade do gatilho de NOVO SEGUIDOR, carimbada na conexão pela sonda
        //    (`probeIgFollowField`). A Meta concede `follow` seletivamente e pode recolher
        //    sem aviso — sem este flag o gatilho apareceria normal e nunca dispararia.
        followAvailable: !!(igConn?.[0]?.meta as { webhook_follow?: boolean } | null)?.webhook_follow,
      }}
      forms={{ licensed: formsLicensed, options: formOptions }}
    />
  )
}
