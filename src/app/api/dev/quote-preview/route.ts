import { NextResponse, type NextRequest } from "next/server"
import { createElement } from "react"
import { createHash } from "node:crypto"
import { auth } from "@/auth"
import { renderToBuffer } from "@react-pdf/renderer"
import { QuotePdf, type QuotePdfData } from "@/lib/pdf/quote-pdf"
import type { RichDoc } from "@/lib/commercial/richdoc"

/**
 * GET /api/dev/quote-preview
 * Preview da cotação em PDF com dados fictícios (harness de validação visual,
 * sem depender da tabela commercial_documents). Espelha /api/dev/invoice-preview.
 * Restrito a platform admin.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// ── Amostras de texto rico (harness visual da F1) ──────────────
const RICH_TERMS: RichDoc = {
  v: 1,
  blocks: [
    { t: "ul", items: [
      [{ text: "30% na assinatura", b: true }, { text: " (R$ 987,00);" }],
      [{ text: "70% em 3× sem juros", b: true }, { text: " no cartão ou boleto;" }],
      [{ text: "Mensalidade da licença a partir do 2º mês." }],
    ] },
  ],
}
const RICH_NOTES: RichDoc = {
  v: 1,
  blocks: [
    { t: "p", runs: [
      { text: "Suporte via WhatsApp em horário comercial, com " },
      { text: "SLA de 1 dia útil", b: true },
      { text: ". Valores não incluem mídia paga." },
    ] },
  ],
}
const RICH_CONTRACT: RichDoc = {
  v: 1,
  blocks: [
    { t: "h", runs: [{ text: "Garantia & suporte" }] },
    { t: "p", runs: [{ text: "Correções de defeito sem custo durante toda a vigência do contrato. Acesso ao " }, { text: "portal de suporte", u: true, link: "https://kora.bluedigitalhub.com.br" }, { text: "." }] },
    { t: "h", runs: [{ text: "LGPD & tratamento de dados" }] },
    { t: "p", runs: [{ text: "Os dados são tratados conforme a Lei 13.709/2018. O cliente é o controlador dos dados dos seus contatos; a Kora atua como operadora." }] },
  ],
}

export async function GET(_req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isPlatformAdmin) {
    return NextResponse.json({ error: "Acesso restrito" }, { status: 403 })
  }

  // Mistura de naturezas (prova a caixa de totais adaptativa): setup avulso +
  // serviços mensais de 6 meses + um produto por medida (kg). É o cenário do
  // Dr. Renan — mensalidade que somava 6 meses e parecia preço à vista.
  const items: QuotePdfData["items"] = [
    { name: "Setup & Implantação",       type: "service", qty: 1,   unit: "un", unit_price_cents: 300000, billing: "one_time", term_months: null, total_cents: 300000 },
    { name: "Gestão de Marketing",       type: "service", qty: 1,   unit: "un", unit_price_cents: 200000, billing: "monthly",  term_months: 6,    total_cents: 1200000 },
    { name: "Tráfego pago (gestão)",     type: "service", qty: 1,   unit: "un", unit_price_cents: 100000, billing: "monthly",  term_months: 6,    total_cents: 600000 },
    { name: "Camarão (teste medida)",    type: "product", qty: 3.5, unit: "kg", unit_price_cents: 14990,  billing: "one_time", term_months: null, total_cents: 52465 },
  ]
  const total = items.reduce((s, i) => s + i.total_cents, 0) // R$ 21.524,65

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
    // Exemplo com TEXTO RICO (negrito + lista) — prova o motor RichDoc no PDF real.
    conditions: {
      payment_terms: RICH_TERMS,
      notes:         RICH_NOTES,
    },
    contract: RICH_CONTRACT,   // bloco de contrato (texto único), abaixo das observações
    paymentMethod: "Cartão de crédito", installments: 3,   // condição estabelecida (selo antes do Total)
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
