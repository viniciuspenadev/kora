import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { getContactRecord, getContactActivity } from "@/lib/actions/deals"
import { getContactAppointments } from "@/lib/actions/agenda"
import { getContactChannels } from "@/lib/contacts/channels"
import { getViewerScope, canManageContacts } from "@/lib/visibility"
import { supabaseAdmin } from "@/lib/supabase"
import { listContactFields } from "@/lib/actions/custom-fields"
import { getPriceTablesForSelect } from "@/lib/actions/price-lists"
import { ClienteRecord } from "./cliente-client"

export default async function ContatoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  const { id } = await params

  const [record, appts, activity, scope, customFields, channels, priceTables] = await Promise.all([
    getContactRecord(id),
    getContactAppointments(id).catch(() => null),
    getContactActivity(id).catch(() => []),
    getViewerScope(),
    listContactFields().catch(() => []),
    getContactChannels(id).catch(() => []),
    getPriceTablesForSelect().catch(() => []),
  ])
  if ("error" in record) notFound()

  const appointments = appts && appts.enabled
    ? appts.items.map((a) => ({ id: a.id, starts_at: a.starts_at, status: a.status, service: a.service_name ?? null, resource: a.resource_name ?? null }))
    : null

  // Identidade (telefone/BSUID) só admin/owner ou supervisor (view_all) — gate tb no backend.
  const canEditIdentity = scope.isAdmin || scope.viewAll

  // Dono da conta (carteira, F1): reatribuir só Gerenciar-contatos/admin.
  const canSetOwner = canManageContacts(scope)
  const { data: agentRows } = await supabaseAdmin.from("tenant_users")
    .select("user_id, profiles!tenant_users_user_id_fkey ( full_name )")
    .eq("tenant_id", session.user.tenantId).eq("active", true)
  const agents = ((agentRows ?? []) as unknown as { user_id: string; profiles: { full_name: string | null } | { full_name: string | null }[] | null }[])
    .map((r) => {
      const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
      return { id: r.user_id, name: p?.full_name ?? "—" }
    })

  // Empresa vinculada (F2): chat_contacts.company_id → tenant_companies(id,name).
  // Alimenta o botão "Abrir para {Empresa}" do expander de Novo negócio. Só quando o CRM
  // está ligado (o expander só aparece com CRM); getContactRecord não expõe o company_id.
  let company: { id: string; name: string } | null = null
  if (record.crmEnabled) {
    const { data: cc } = await supabaseAdmin.from("chat_contacts")
      .select("company_id").eq("id", id).eq("tenant_id", session.user.tenantId).maybeSingle()
    const companyId = (cc as { company_id: string | null } | null)?.company_id ?? null
    if (companyId) {
      const { data: co } = await supabaseAdmin.from("tenant_companies")
        .select("id, name").eq("id", companyId).eq("tenant_id", session.user.tenantId).maybeSingle()
      if (co) company = co as { id: string; name: string }
    }
  }

  return <ClienteRecord record={record} appointments={appointments} activity={activity} canEditIdentity={canEditIdentity} customFields={customFields} channels={channels} priceTables={priceTables} agents={agents} canSetOwner={canSetOwner} company={company} />
}
