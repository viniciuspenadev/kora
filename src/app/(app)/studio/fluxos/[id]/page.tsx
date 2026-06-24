import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { loadTenantChannels, loadTenantInstances, loadTenantAds } from "@/lib/studio/trigger-meta"
import { FlowEditorCanvas } from "./editor-canvas"
import type { StudioFlowFull } from "@/types/studio"

export default async function FlowEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const tenantId = session.user.tenantId
  if (!(await hasModule(tenantId, "ai_studio"))) redirect("/inbox")

  const [{ data: flow }, { data: depts }, { data: flowList }, { data: stageList }, { data: tagList }, { data: svcList }, { data: resList }] = await Promise.all([
    supabaseAdmin.from("studio_flows")
      .select("id, name, status, active, version, trigger, graph")
      .eq("tenant_id", tenantId).eq("id", id).maybeSingle(),
    supabaseAdmin.from("tenant_departments").select("id, name").eq("tenant_id", tenantId),
    // Fluxos alvo do nó "Executar fluxo" (exclui o próprio + arquivados).
    supabaseAdmin.from("studio_flows")
      .select("id, name")
      .eq("tenant_id", tenantId).neq("status", "archived").neq("id", id)
      .order("name"),
    // Etapas do pipeline pro nó "Mover etapa".
    supabaseAdmin.from("pipeline_stages").select("id, name, position").eq("tenant_id", tenantId).order("position"),
    // Etiquetas existentes pro nó "Etiquetar" (seletor, não texto livre).
    supabaseAdmin.from("tags").select("id, name").eq("tenant_id", tenantId).order("name"),
    // Serviços + agendas pro destino da agenda no nó de IA ("em qual agenda cai").
    supabaseAdmin.from("tenant_services").select("id, name").eq("tenant_id", tenantId).eq("active", true).order("name"),
    supabaseAdmin.from("tenant_resources").select("id, name").eq("tenant_id", tenantId).eq("active", true).order("name"),
  ])
  if (!flow) redirect("/studio/fluxos")

  // Gate (god mode): binding "Dono da conversa" nos nós de agendamento (beta).
  // + opções de canal/instância pro filtro do gatilho (derivadas do tenant).
  const [ownerRouting, channels, instances, ads] = await Promise.all([
    hasModule(tenantId, "agenda_owner_routing"),
    loadTenantChannels(tenantId),
    loadTenantInstances(tenantId),
    loadTenantAds(tenantId),
  ])

  return (
    <FlowEditorCanvas
      flow={flow as StudioFlowFull}
      departments={(depts ?? []) as { id: string; name: string }[]}
      flows={(flowList ?? []) as { id: string; name: string }[]}
      stages={(stageList ?? []) as { id: string; name: string }[]}
      tags={(tagList ?? []) as { id: string; name: string }[]}
      services={(svcList ?? []) as { id: string; name: string }[]}
      resources={(resList ?? []) as { id: string; name: string }[]}
      ownerRouting={ownerRouting}
      channels={channels}
      instances={instances}
      ads={ads}
    />
  )
}
