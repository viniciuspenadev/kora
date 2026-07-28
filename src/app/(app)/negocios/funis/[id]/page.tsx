import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { hasModule } from "@/lib/modules"
import { getDealFunnel } from "@/lib/actions/deal-pipelines"
import { DealFunnelEditor } from "../deal-funnel-editor"

export const dynamic = "force-dynamic"

export default async function DealFunnelEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/negocios")
  if (!(await hasModule(session.user.tenantId, "crm"))) redirect("/inbox")

  const { id } = await params
  const data = await getDealFunnel(id)
  if (!data) redirect("/negocios/funis")

  return <div className="p-6"><DealFunnelEditor pipeline={data.pipeline} stages={data.stages} /></div>
}
