import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { ListChecks } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { supabaseAdmin } from "@/lib/supabase"
import { getLists } from "@/lib/actions/lists"
import { ListasClient } from "./listas-client"

export default async function ListasPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const [lists, { data: tags }] = await Promise.all([
    getLists(),
    supabaseAdmin.from("tags").select("id, name, color").eq("tenant_id", session.user.tenantId).order("name"),
  ])

  return (
    <PageShell
      title="Listas"
      description="Segmentos salvos — estáticos (curadoria) ou dinâmicos (regras que se atualizam sozinhas)."
      icon={ListChecks}
    >
      <ListasClient lists={lists} tags={(tags ?? []) as { id: string; name: string; color: string }[]} />
    </PageShell>
  )
}
