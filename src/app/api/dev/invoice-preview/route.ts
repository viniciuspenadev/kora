import { NextResponse, type NextRequest } from "next/server"
import { createElement } from "react"
import path from "path"
import { auth } from "@/auth"
import { renderToBuffer } from "@react-pdf/renderer"
import { InvoicePdf, type InvoicePdfData } from "@/lib/pdf/invoice-pdf"

/**
 * GET /api/dev/invoice-preview
 * Preview da fatura em PDF com dados fictícios (sem precisar gerar uma real).
 * Restrito a platform admin.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isPlatformAdmin) {
    return NextResponse.json({ error: "Acesso restrito" }, { status: 403 })
  }

  const data: InvoicePdfData = {
    ref:            "A1B2C3D4",
    status:         "open",
    period_start:   "2026-05-05",
    period_end:     "2026-06-04",
    due_date:       "2026-05-12",
    issued_at:      "2026-05-05",
    subtotal_cents: 39700,
    total_cents:    39700,
    items: [
      { description: "Plano Pro", quantity: 1, unit_price_cents: 29900, amount_cents: 29900 },
      { description: "2 usuário(s) adicional(is) — cota 5, ativos 7", quantity: 2, unit_price_cents: 4900, amount_cents: 9800 },
    ],
    customerName: "Bernardo Concept",
    customer: {
      person_type: "pj", legal_name: "Bernardo Concept Ltda", trade_name: "Bernardo Concept",
      tax_id: "12.345.678/0001-90", state_registration: "123.456.789.000",
      billing_email: "financeiro@bernardoconcept.com.br", phone: "(11) 99999-9999",
      zip: "01310-100", street: "Av. Paulista", number: "1000", complement: "Sala 50",
      district: "Bela Vista", city: "São Paulo", state: "SP",
    },
    issuer: {
      person_type: "pj", legal_name: "BlueDigitalHub Tecnologia Ltda", trade_name: "Kora",
      tax_id: "98.765.432/0001-10", state_registration: "ISENTO",
      billing_email: "contato@bluedigitalhub.com.br", phone: "(11) 98725-3394",
      zip: "01000-000", street: "Rua Exemplo", number: "123",
      district: "Centro", city: "São Paulo", state: "SP",
      pix_key: "contato@bluedigitalhub.com.br",
      bank_info: "Banco 000 · Ag 0001 · CC 12345-6",
      payment_instructions: "Pague até o vencimento via PIX usando a chave acima.",
      logo_url: path.join(process.cwd(), "public/logo_kora.png"),
    },
  }

  const buffer = await renderToBuffer(
    createElement(InvoicePdf, { data }) as Parameters<typeof renderToBuffer>[0],
  )

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": "inline; filename=\"fatura-preview.pdf\"",
      "Cache-Control":       "no-store",
    },
  })
}
