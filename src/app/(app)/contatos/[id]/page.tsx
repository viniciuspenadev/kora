import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { getContactRecord, getContactActivity } from "@/lib/actions/deals"
import { getContactAppointments } from "@/lib/actions/agenda"
import { getViewerScope } from "@/lib/visibility"
import { listContactFields } from "@/lib/actions/custom-fields"
import { ClienteRecord } from "./cliente-client"

export default async function ContatoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  const { id } = await params

  const [record, appts, activity, scope, customFields] = await Promise.all([
    getContactRecord(id),
    getContactAppointments(id).catch(() => null),
    getContactActivity(id).catch(() => []),
    getViewerScope(),
    listContactFields().catch(() => []),
  ])
  if ("error" in record) notFound()

  const appointments = appts && appts.enabled
    ? appts.items.map((a) => ({ id: a.id, starts_at: a.starts_at, status: a.status, service: a.service_name ?? null, resource: a.resource_name ?? null }))
    : null

  // Identidade (telefone/BSUID) só admin/owner ou supervisor (view_all) — gate tb no backend.
  const canEditIdentity = scope.isAdmin || scope.viewAll

  return <ClienteRecord record={record} appointments={appointments} activity={activity} canEditIdentity={canEditIdentity} customFields={customFields} />
}
