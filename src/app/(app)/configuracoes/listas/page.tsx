import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { ListChecks } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope, canManageMarketing } from "@/lib/visibility"
import { getLists } from "@/lib/actions/lists"
import { ListasClient } from "./listas-client"

export default async function ListasPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  const scope = await getViewerScope()
  if (!canManageMarketing(scope)) redirect("/inbox")

  const [lists, { data: tags }] = await Promise.all([
    getLists(),
    supabaseAdmin.from("tags").select("id, name, color").eq("tenant_id", session.user.tenantId).order("name"),
  ])

  return (
    <PageShell
      variant="list"
      title="Listas"
      description="Segmentos salvos — estáticos (curadoria) ou dinâmicos (regras que se atualizam sozinhas)."
      icon={ListChecks}
    >
      <ListasClient lists={lists} tags={(tags ?? []) as { id: string; name: string; color: string }[]} />
    </PageShell>
  )
}
