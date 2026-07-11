import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { hasModule } from "@/lib/modules"
import { supabaseAdmin } from "@/lib/supabase"
import { getDeal } from "@/lib/actions/deals"
import { listDealTasks } from "@/lib/actions/tasks"
import { listCustomFields } from "@/lib/actions/custom-fields"
import { DealPageClient } from "@/components/crm/deal-page-client"

export const dynamic = "force-dynamic"

export default async function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  const { id } = await params
  if (!(await hasModule(session.user.tenantId, "crm"))) redirect("/inbox")

  const [deal, tasks, dealFields] = await Promise.all([getDeal(id), listDealTasks(id), listCustomFields("deal")])
  if ("error" in deal) redirect("/negocios")

  // Gestor vê custo/margem e edita a validade da proposta (o server revalida tudo).
  const isManager = ["owner", "admin"].includes(session.user.role)

  // Agentes do tenant pro seletor de participante.
  const { data: agentRows } = await supabaseAdmin.from("tenant_users")
    .select("user_id, profiles!tenant_users_user_id_fkey ( full_name )")
    .eq("tenant_id", session.user.tenantId).eq("active", true)
  const agents = ((agentRows ?? []) as unknown as { user_id: string; profiles: { full_name: string | null } | { full_name: string | null }[] | null }[])
    .map((r) => { const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles; return { id: r.user_id, name: p?.full_name ?? "—" } })

  return <DealPageClient deal={deal} tasks={tasks} isManager={isManager} dealFields={dealFields} agents={agents} currentUserId={session.user.id} />
}
