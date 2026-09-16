import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { listTeamMembers, listPendingInvites, listDepartments, listTeamNumbers } from "@/lib/actions/team"
import { uncoveredTeamQueues } from "@/lib/team-queue-coverage"
import { checkLimit } from "@/lib/limits"
import { OrgShell } from "./org-shell"
import { EquipeClient } from "./client"

export default async function EquipePage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const [members, invites, departments, userLimit, numbers] = await Promise.all([
    listTeamMembers(),
    listPendingInvites(),
    listDepartments(),
    checkLimit(session.user.tenantId, "users"),
    listTeamNumbers(),
  ])

  return (
    <OrgShell>
      <EquipeClient
        members={members}
        invites={invites}
        departments={departments}
        currentUserId={session.user.id}
        currentUserRole={session.user.role}
        queueWarnings={uncoveredTeamQueues(members, departments, numbers)}
        userLimit={{
          used:      userLimit.used,
          max:       userLimit.max,
          remaining: userLimit.remaining,
          ok:        userLimit.ok,
        }}
      />
    </OrgShell>
  )
}
