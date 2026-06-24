import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { IdCard } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { listContactFields } from "@/lib/actions/custom-fields"
import { CamposClient } from "./campos-client"

export default async function CamposCadastroPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const fields = await listContactFields({ includeInactive: true })

  return (
    <PageShell
      title="Campos do cadastro"
      description="Crie campos personalizados pro cadastro de contatos — do jeito do seu negócio (convênio, tamanho, área…). Aparecem na ficha de cada contato."
      icon={IdCard}
    >
      <CamposClient fields={fields} />
    </PageShell>
  )
}
