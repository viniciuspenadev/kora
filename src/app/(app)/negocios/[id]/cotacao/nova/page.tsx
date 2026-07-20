import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { hasModule } from "@/lib/modules"
import { supabaseAdmin } from "@/lib/supabase"
import { getQuoteDefaults } from "@/lib/actions/documents"
import { QuoteComposer } from "./composer-client"

export default async function NewQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  const tenantId = session.user.tenantId
  if (!(await hasModule(tenantId, "crm"))) redirect("/inbox")

  const { id: dealId } = await params
  const { data: deal } = await supabaseAdmin.from("tenant_deals")
    .select("id, name, payment_method, installments, proposal_expires_at")
    .eq("id", dealId).eq("tenant_id", tenantId).maybeSingle()
  if (!deal) redirect("/negocios")

  const { count: itemCount } = await supabaseAdmin.from("tenant_deal_items")
    .select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("deal_id", dealId)

  const defaults = await getQuoteDefaults()
  const d = "error" in defaults ? { paymentTerms: null, validityDays: 7, defaultNotes: null } : defaults

  return (
    <QuoteComposer
      dealId={dealId}
      dealName={(deal.name as string | null) ?? "Negócio"}
      hasItems={(itemCount ?? 0) > 0}
      itemCount={itemCount ?? 0}
      defaults={d}
      dealPaymentMethod={(deal.payment_method as string | null) ?? null}
      dealInstallments={(deal.installments as number | null) ?? null}
      dealProposalExpiresAt={(deal.proposal_expires_at as string | null) ?? null}
    />
  )
}
