import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { hasModule } from "@/lib/modules"
import { supabaseAdmin } from "@/lib/supabase"
import { getQuoteDefaults } from "@/lib/actions/documents"
import { listQuoteTemplatesForUse } from "@/lib/actions/quote-templates"
import { docCode, type QuoteSnapshot, type DocumentKind } from "@/lib/commercial/documents"
import { QuoteComposer } from "./composer-client"

export default async function NewQuotePage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  const tenantId = session.user.tenantId
  if (!(await hasModule(tenantId, "crm"))) redirect("/inbox")

  const { id: dealId } = await params
  const { from } = await searchParams
  const { data: deal } = await supabaseAdmin.from("tenant_deals")
    .select("id, name, payment_method, installments, proposal_expires_at")
    .eq("id", dealId).eq("tenant_id", tenantId).maybeSingle()
  if (!deal) redirect("/negocios")

  const { count: itemCount } = await supabaseAdmin.from("tenant_deal_items")
    .select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("deal_id", dealId)

  const defaults = await getQuoteDefaults()
  const d = "error" in defaults ? { paymentTerms: null, validityDays: 7, defaultNotes: null } : defaults
  const templates = await listQuoteTemplatesForUse()

  // ?from=<docId> → NOVA VERSÃO: pré-carrega as condições da cotação de origem
  // (snapshot congelado; escopo tenant+deal — anti-IDOR). Anulada não versiona.
  let fromDoc: { id: string; code: string } | null = null
  let initial: { terms: unknown; notes: unknown; contract: unknown; validUntil: string | null } | null = null
  let payMethod: string | null = (deal.payment_method as string | null) ?? null
  let installments: number | null = (deal.installments as number | null) ?? null
  if (from) {
    const { data: doc } = await supabaseAdmin.from("commercial_documents")
      .select("id, kind, number, year, status, snapshot")
      .eq("id", from).eq("tenant_id", tenantId).eq("deal_id", dealId).eq("kind", "quote").maybeSingle()
    if (doc && (doc.status as string) !== "void") {
      const snap = doc.snapshot as QuoteSnapshot
      fromDoc = { id: doc.id as string, code: docCode(doc.kind as DocumentKind, doc.number as number, doc.year as number) }
      const today = new Date().toISOString().slice(0, 10)
      initial = {
        terms:      snap.conditions?.payment_terms ?? null,
        notes:      snap.conditions?.notes ?? null,
        contract:   snap.conditions?.contract ?? null,
        // Validade da origem só se ainda futura — vencida não faz sentido herdar.
        validUntil: snap.conditions?.valid_until && snap.conditions.valid_until >= today ? snap.conditions.valid_until : null,
      }
      payMethod    = snap.conditions?.payment_method ?? payMethod
      installments = snap.conditions?.installments ?? installments
    }
  }

  return (
    <QuoteComposer
      dealId={dealId}
      dealName={(deal.name as string | null) ?? "Negócio"}
      hasItems={(itemCount ?? 0) > 0}
      itemCount={itemCount ?? 0}
      defaults={d}
      dealPaymentMethod={payMethod}
      dealInstallments={installments}
      dealProposalExpiresAt={initial?.validUntil ?? ((deal.proposal_expires_at as string | null) ?? null)}
      fromDoc={fromDoc}
      initialConditions={initial ? { terms: initial.terms, notes: initial.notes, contract: initial.contract } : null}
      templates={templates}
    />
  )
}
