import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { FileText } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { hasModule } from "@/lib/modules"
import { listQuoteTemplates } from "@/lib/actions/quote-templates"
import { TemplatesClient } from "./templates-client"

export default async function QuoteTemplatesPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")
  if (!(await hasModule(session.user.tenantId, "crm"))) redirect("/inbox")

  const templates = await listQuoteTemplates()

  return (
    <PageShell
      title="Cotação e Contrato"
      description="Modelos reutilizáveis de condições, observações e contrato. O time insere na cotação com 1 clique; você governa o que fica disponível."
      icon={FileText}
    >
      <TemplatesClient initial={templates} />
    </PageShell>
  )
}
