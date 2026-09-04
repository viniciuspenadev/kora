import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { listDepartments } from "@/lib/actions/team"
import { OrgShell } from "../org-shell"
import { DepartamentosClient } from "./departamentos-client"

export default async function DepartamentosPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const departments = await listDepartments()

  return (
    <OrgShell>
      <DepartamentosClient departments={departments} />
    </OrgShell>
  )
}
