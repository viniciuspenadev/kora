import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope, canManageContacts } from "@/lib/visibility"
import { UploadCloud } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { listImports } from "@/lib/actions/import-contacts"
import { ImportarClient } from "./importar-client"

export default async function ImportarContatosPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  const scope = await getViewerScope()
  if (!canManageContacts(scope)) redirect("/contatos")

  const [{ data: tags }, imports] = await Promise.all([
    supabaseAdmin.from("tags").select("id, name, color").eq("tenant_id", session.user.tenantId).order("name"),
    listImports(),
  ])

  return (
    <PageShell
      title="Importar contatos"
      description="Cole sua lista (da planilha) ou suba um CSV. A gente valida os números, mostra o que é novo x já existe — sem duplicar — e importa."
      icon={UploadCloud}
    >
      <ImportarClient tags={tags ?? []} imports={imports} />
    </PageShell>
  )
}
