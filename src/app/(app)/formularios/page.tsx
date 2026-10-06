import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { hasModule } from "@/lib/modules"
import { getViewerScope, canViewForms } from "@/lib/visibility"
import { supabaseAdmin } from "@/lib/supabase"
import { listForms } from "@/lib/actions/forms"
import { FormsClient } from "./forms-client"

export const dynamic = "force-dynamic"

export default async function FormulariosPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  // Mesmo portão do menu e das ações: módulo + permissão (fail-closed; a ação re-confere).
  if (!(await hasModule(session.user.tenantId, "forms"))) redirect("/inbox")
  const scope = await getViewerScope()
  if (!canViewForms(scope)) redirect("/inbox")

  const [result, { data: tenant }] = await Promise.all([
    listForms(),
    supabaseAdmin.from("tenants").select("name").eq("id", session.user.tenantId).maybeSingle(),
  ])
  if ("error" in result) redirect("/inbox")

  // O cabeçalho (com "Ver modelos"/"Novo formulário") mora no client: os botões abrem a galeria.
  return <FormsClient items={result.items} canManage={result.canManage} canCreateFlow={result.canCreateFlow}
    replied30d={result.replied30d} starts30d={result.starts30d} avgSecondsToCall={result.avgSecondsToCall} businessName={(tenant as { name?: string } | null)?.name ?? ""} />
}
