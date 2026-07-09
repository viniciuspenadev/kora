import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { IdCard } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { listCustomFields } from "@/lib/actions/custom-fields"
import { CamposClient } from "./campos-client"

export default async function CamposCadastroPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const [contact, deal, product] = await Promise.all([
    listCustomFields("contact", { includeInactive: true }),
    listCustomFields("deal", { includeInactive: true }),
    listCustomFields("product", { includeInactive: true }),
  ])

  return (
    <PageShell
      title="Campos de cadastro"
      description="Monte a ficha do seu jeito. Defina o campo uma vez e ele aparece em todos os registros da entidade — pra todo o time."
      icon={IdCard}
    >
      <CamposClient fields={{ contact, deal, product }} />
    </PageShell>
  )
}
