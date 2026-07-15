import { NextResponse, type NextRequest } from "next/server"
import { createElement } from "react"
import { createHash } from "node:crypto"
import { auth } from "@/auth"
import { renderToBuffer } from "@react-pdf/renderer"
import { QuotePdf, type QuotePdfData } from "@/lib/pdf/quote-pdf"

/**
 * GET /api/dev/quote-preview
 * Preview da cotação em PDF com dados fictícios (harness de validação visual,
 * sem depender da tabela commercial_documents). Espelha /api/dev/invoice-preview.
 * Restrito a platform admin.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isPlatformAdmin) {
    return NextResponse.json({ error: "Acesso restrito" }, { status: 403 })
  }

  const items: QuotePdfData["items"] = [
    { name: "Desenvolvimento Site",        type: "service", qty: 1,   unit: "un", unit_price_cents: 500000, billing: "one_time", term_months: null, total_cents: 500000 },
    { name: "Meta/Google Ads",             type: "service", qty: 1,   unit: "un", unit_price_cents: 250000, billing: "one_time", term_months: null, total_cents: 250000 },
    { name: "Gerenc. Midias Sociais",      type: "service", qty: 1,   unit: "un", unit_price_cents: 250000, billing: "one_time", term_months: null, total_cents: 250000 },
    { name: "Camarão (teste)",             type: "product", qty: 3.5, unit: "kg", unit_price_cents: 14990,  billing: "one_time", term_months: null, total_cents: 52465 },
  ]
  const total = items.reduce((s, i) => s + i.total_cents, 0) // R$ 10.524,65

  const data: QuotePdfData = {
    code:       "COT-0001/2026",
    issuedAt:   new Date().toISOString(),
    validUntil: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    issuer: {
      name:       "Blue Digital Hub",
      legal_name: "Blue Digital Hub Tecnologia Ltda",
      tax_id:     "98.765.432/0001-10",
      phone:      "+55 (11) 98725-3394",
      email:      "contato@bluedigitalhub.com.br",
      address: {
        zip_code: "01000-000", street: "Rua Exemplo", number: "123", complement: null,
        district: "Centro", city: "São Paulo", state: "SP",
      },
    },
    logoDataUri: null, // sem logo → só o nome (fallback do template)
    client: { name: "Kleiton Moma Planejados", phone: "+55 (11) 99999-8888" },
    deal:   { name: "Projeto digital + fornecimento", seller: "Vinicius Henrique" },
    items,
    totals:     { subtotal_cents: total, discount_cents: 0, total_cents: total },
    conditions: {
      payment_terms: "50% na aprovação, 50% na entrega. Pix ou boleto.",
      notes:         "Valores não incluem taxas de mídia paga (investimento em anúncios é à parte, direto na plataforma).",
    },
    contentHash: createHash("sha256").update(JSON.stringify(items)).digest("hex"),
  }

  const buffer = await renderToBuffer(
    createElement(QuotePdf, { data }) as Parameters<typeof renderToBuffer>[0],
  )

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": "inline; filename=\"cotacao-preview.pdf\"",
      "Cache-Control":       "no-store",
    },
  })
}
