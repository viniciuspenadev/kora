import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { listUnits } from "@/lib/actions/team"
import { OrgShell } from "../org-shell"
import { UnidadesClient } from "./unidades-client"

export default async function UnidadesPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const units = await listUnits()

  return (
    <OrgShell>
      <UnidadesClient units={units} />
    </OrgShell>
  )
}
