import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { listResources, listServices, getAgendaRemindersEnabled } from "@/lib/actions/agenda"
import { AgendaConfigClient } from "@/components/agenda/agenda-config-client"

export default async function AgendaConfigPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/agenda")
  const tenantId = session.user.tenantId
  if (!(await hasModule(tenantId, "agenda"))) redirect("/inbox")

  const [resources, services, remindersEnabled, { data: agentsRaw }] = await Promise.all([
    listResources(true),
    listServices(true),
    getAgendaRemindersEnabled(),
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

  return <AgendaConfigClient initialResources={resources} initialServices={services} agents={agents} remindersEnabled={remindersEnabled} />
}
