import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { getTeamMember, listDepartments, listTeamNumbers, listActiveUnits } from "@/lib/actions/team"
import { hasModule } from "@/lib/modules"
import { MemberProfileClient } from "./member-client"

export const dynamic = "force-dynamic"

export default async function MemberPage({ params }: { params: Promise<{ userId: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")
  const { userId } = await params

  const [member, departments, numbers, units, hasInventory, hasCrm, hasContacts, hasMarketing] = await Promise.all([
    getTeamMember(userId),
    listDepartments(),
    listTeamNumbers(),
    listActiveUnits(),
    hasModule(session.user.tenantId, "inventory"),
    hasModule(session.user.tenantId, "crm"),
    hasModule(session.user.tenantId, "contacts"),
    hasModule(session.user.tenantId, "broadcasts"),
  ])
  if (!member) notFound()

  return (
    <MemberProfileClient
      member={member}
      departments={departments}
      numbers={numbers}
      units={units}
      currentUserId={session.user.id}
      currentUserRole={session.user.role}
      hasInventory={hasInventory}
      hasCrm={hasCrm}
      hasContacts={hasContacts}
      hasMarketing={hasMarketing}
      hasCatalog={hasCrm || hasInventory}
    />
  )
}
