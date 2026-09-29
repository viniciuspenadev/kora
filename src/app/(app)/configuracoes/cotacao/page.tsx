import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { FileText } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { hasModule } from "@/lib/modules"
import { listQuoteTemplates } from "@/lib/actions/quote-templates"
import { getCrmItemPolicies } from "@/lib/actions/crm-policies"
import { TemplatesClient } from "./templates-client"
import { ItemPolicyCard } from "./item-policy-card"
import { QUOTE_TERM, qg } from "@/lib/commercial/quote-terms"

export default async function QuoteTemplatesPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")
  if (!(await hasModule(session.user.tenantId, "crm"))) redirect("/inbox")

  const [templates, policies] = await Promise.all([listQuoteTemplates(), getCrmItemPolicies()])

  return (
    <PageShell
      title={QUOTE_TERM.settings}
      description={`Modelos reutilizáveis de condições, observações e contrato. O time insere ${qg("no", "na")} ${QUOTE_TERM.oneLower} com 1 clique; você governa o que fica disponível.`}
      icon={FileText}
    >
      {"error" in policies
        ? <p role="alert" className="mb-6 rounded-lg bg-danger-bg p-3 text-xs text-danger">{policies.error}</p>
        : <ItemPolicyCard manualItems={policies.manualItems} />}
      <TemplatesClient initial={templates} />
    </PageShell>
  )
}
