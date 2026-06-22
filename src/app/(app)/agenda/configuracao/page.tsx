import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { listResources, listServices, getAgendaRemindersEnabled } from "@/lib/actions/agenda"
import { agendaConfirmStatus, listApprovedTemplates } from "@/lib/agenda/official-template"
import { AgendaConfigClient } from "@/components/agenda/agenda-config-client"

export default async function AgendaConfigPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/agenda")
  const tenantId = session.user.tenantId
  if (!(await hasModule(tenantId, "agenda"))) redirect("/inbox")

  const [resources, services, remindersEnabled, remindersModule, { data: agentsRaw }] = await Promise.all([
    listResources(true),
    listServices(true),
    getAgendaRemindersEnabled(),
    hasModule(tenantId, "agenda_reminders"),
    supabaseAdmin
      .from("tenant_users")
      .select("user_id, profiles!tenant_users_user_id_fkey ( full_name )")
      .eq("tenant_id", tenantId)
      .eq("active", true),
  ])

  const agents = (agentsRaw ?? []).map((a) => ({
    id:   a.user_id as string,
    name: (a.profiles as unknown as { full_name: string } | null)?.full_name ?? "Atendente",
  }))

  // Canal oficial? → o lembrete vira template (obrigatório fora da janela 24h).
  const { data: metaInst } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id").eq("tenant_id", tenantId).eq("provider", "meta_cloud").limit(1).maybeSingle()
  const isMeta = !!metaInst
  const [confirmStatus, approvedTemplates] = await Promise.all([
    isMeta ? agendaConfirmStatus(tenantId) : Promise.resolve("none" as const),
    isMeta ? listApprovedTemplates(tenantId) : Promise.resolve([]),
  ])

  return (
    <AgendaConfigClient
      initialResources={resources}
      initialServices={services}
      agents={agents}
      remindersEnabled={remindersEnabled}
      remindersModule={remindersModule}
      isMeta={isMeta}
      confirmStatus={confirmStatus}
      approvedTemplates={approvedTemplates}
    />
  )
}
