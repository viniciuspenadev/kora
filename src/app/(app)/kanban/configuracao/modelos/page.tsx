import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { FunnelTemplatesClient } from "@/components/kanban/funnel-templates-client"

export default async function FunnelTemplatesPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/kanban")
  return <FunnelTemplatesClient />
}
