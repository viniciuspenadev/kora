import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { hasModule } from "@/lib/modules"
import { getViewerScope, canViewInventory, canEditInventory, canManageInventory } from "@/lib/visibility"
import { getInventory } from "@/lib/actions/inventory"
import { EstoqueClient } from "./estoque-client"

export const dynamic = "force-dynamic"

export default async function EstoquePage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!(await hasModule(session.user.tenantId, "inventory"))) redirect("/inbox")
  // VER: owner/admin OU agente com nível view/manage.
  const scope = await getViewerScope()
  if (!canViewInventory(scope)) redirect("/inbox")

  const items = await getInventory()

  return (
    <EstoqueClient items={items} canEdit={canEditInventory(scope)} canManage={canManageInventory(scope)} />
  )
}
