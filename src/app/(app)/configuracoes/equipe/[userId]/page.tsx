import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { getTeamMember, listDepartments, listTeamNumbers } from "@/lib/actions/team"
import { hasModule } from "@/lib/modules"
import { MemberProfileClient } from "./member-client"

export const dynamic = "force-dynamic"

export default async function MemberPage({ params }: { params: Promise<{ userId: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")
  const { userId } = await params

  const [member, departments, numbers, hasInventory, hasCrm, hasContacts] = await Promise.all([
    getTeamMember(userId),
    listDepartments(),
    listTeamNumbers(),
    hasModule(session.user.tenantId, "inventory"),
    hasModule(session.user.tenantId, "crm"),
    hasModule(session.user.tenantId, "contacts"),
  ])
  if (!member) notFound()

  return (
    <MemberProfileClient
      member={member}
      departments={departments}
      numbers={numbers}
      currentUserId={session.user.id}
      currentUserRole={session.user.role}
      hasInventory={hasInventory}
      hasCrm={hasCrm}
      hasContacts={hasContacts}
    />
  )
}
