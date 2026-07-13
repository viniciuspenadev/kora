import { NextResponse, type NextRequest } from "next/server"
import { createElement } from "react"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { renderToBuffer } from "@react-pdf/renderer"
import { InvoicePdf, type InvoicePdfData, type Party, type IssuerParty } from "@/lib/pdf/invoice-pdf"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const KIND_ORDER: Record<string, number> = { plan: 0, overage: 1, addon: 2, oneoff: 3 }

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.isPlatformAdmin) {
    return NextResponse.json({ error: "Acesso restrito" }, { status: 403 })
  }

  const { id } = await params

  const { data: inv } = await supabaseAdmin
    .from("invoices").select("*, invoice_items(*)").eq("id", id).maybeSingle()
  if (!inv) return NextResponse.json({ error: "Fatura não encontrada" }, { status: 404 })

  const [{ data: tenant }, { data: customer }, { data: issuer }] = await Promise.all([
    supabaseAdmin.from("tenants").select("name").eq("id", inv.tenant_id).maybeSingle(),
    supabaseAdmin.from("tenant_billing_profile").select("*").eq("tenant_id", inv.tenant_id).maybeSingle(),
    supabaseAdmin.from("billing_issuer").select("*").eq("id", true).maybeSingle(),
  ])

  const items = ((inv.invoice_items ?? []) as Array<{ kind: string; description: string; quantity: number; unit_price_cents: number; amount_cents: number }>)
    .slice()
    .sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9))

  const data: InvoicePdfData = {
    ref:            id.slice(0, 8).toUpperCase(),
    status:         inv.status,
    period_start:   inv.period_start,
    period_end:     inv.period_end,
    due_date:       inv.due_date,
    issued_at:      inv.issued_at,
    subtotal_cents: inv.subtotal_cents,
    total_cents:    inv.total_cents,
    items:          items.map((it) => ({ description: it.description, quantity: it.quantity, unit_price_cents: it.unit_price_cents, amount_cents: it.amount_cents })),
    customer:       (customer ?? null) as Party | null,
    customerName:   tenant?.name ?? "—",
    issuer:         (issuer ?? null) as IssuerParty | null,
  }

  const buffer = await renderToBuffer(
    createElement(InvoicePdf, { data }) as Parameters<typeof renderToBuffer>[0],
  )

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `inline; filename="fatura-${data.ref}.pdf"`,
      "Cache-Control":       "private, no-store",
    },
  })
}
