import "server-only"
import { createElement } from "react"
import { renderToBuffer } from "@react-pdf/renderer"
import { supabaseAdmin } from "@/lib/supabase"
import { InvoicePdf, type InvoicePdfData, type Party, type IssuerParty } from "@/lib/pdf/invoice-pdf"

// ═══════════════════════════════════════════════════════════════
// Montagem do PDF da fatura — UM lugar, dois consumidores
// ═══════════════════════════════════════════════════════════════
//
// 🔴 O PDF já existia e só o GOD MODE alcançava (`/api/admin/invoice/[id]/pdf`). O cliente
//    — dono do documento — não tinha como ver a própria fatura em lugar nenhum. Achado do
//    dono em 06/08, junto com o motivo de não haver fatura alguma pra ver.
//
// 🔑 Extraído para cá em vez de copiado: a rota do god mode e a do cliente montam o MESMO
//    documento, com os mesmos itens e a mesma ordem. Duas montagens divergiriam no primeiro
//    campo novo — e aí operação e cliente passariam a ler faturas diferentes do mesmo mês,
//    que é o pior tipo de divergência que um sistema de cobrança pode ter.
//
// ⚠️ Este módulo NÃO decide quem pode ver. Ele monta. A autorização mora em cada rota:
//    o god mode exige platform admin; a do cliente exige que a fatura seja DO tenant da
//    sessão. Misturar as duas coisas aqui faria um gate viajar junto com um renderizador.

/** Ordem de leitura dos itens: plano, depois excedente, add-on e avulsos. */
const KIND_ORDER: Record<string, number> = { plan: 0, overage: 1, addon: 2, oneoff: 3 }

/**
 * Lê a fatura e devolve o PDF pronto.
 *
 * @param invoiceId  id da fatura
 * @param tenantId   quando presente, a fatura PRECISA ser deste tenant (anti-IDOR).
 *                   O god mode passa `undefined` porque atende todos os clientes.
 */
export async function renderInvoicePdf(
  invoiceId: string,
  tenantId?: string,
): Promise<{ buffer: Buffer; ref: string } | { error: string; status: number }> {
  const { data: inv } = await supabaseAdmin
    .from("invoices").select("*, invoice_items(*)").eq("id", invoiceId).maybeSingle()

  if (!inv) return { error: "Fatura não encontrada", status: 404 }

  // 🔒 ANTI-IDOR: o id da fatura vem da URL e é adivinhável por enumeração. Sem esta
  //    comparação, um owner de um tenant baixaria a fatura de outro — com razão social,
  //    CNPJ, endereço e valores. Fail-closed: divergiu, é 404 (não 403 — negar a
  //    existência é melhor que confirmar que a fatura existe e é de outro).
  if (tenantId && inv.tenant_id !== tenantId) {
    return { error: "Fatura não encontrada", status: 404 }
  }

  const [{ data: tenant }, { data: customer }, { data: issuer }] = await Promise.all([
    supabaseAdmin.from("tenants").select("name").eq("id", inv.tenant_id).maybeSingle(),
    supabaseAdmin.from("tenant_billing_profile").select("*").eq("tenant_id", inv.tenant_id).maybeSingle(),
    supabaseAdmin.from("billing_issuer").select("*").eq("id", true).maybeSingle(),
  ])

  const items = ((inv.invoice_items ?? []) as Array<{
    kind: string; description: string; quantity: number
    unit_price_cents: number; amount_cents: number
  }>)
    .slice()
    .sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9))

  const data: InvoicePdfData = {
    ref:            invoiceId.slice(0, 8).toUpperCase(),
    status:         inv.status,
    period_start:   inv.period_start,
    period_end:     inv.period_end,
    due_date:       inv.due_date,
    issued_at:      inv.issued_at,
    subtotal_cents: inv.subtotal_cents,
    total_cents:    inv.total_cents,
    items:          items.map((it) => ({
      description: it.description, quantity: it.quantity,
      unit_price_cents: it.unit_price_cents, amount_cents: it.amount_cents,
    })),
    customer:       (customer ?? null) as Party | null,
    customerName:   tenant?.name ?? "—",
    issuer:         (issuer ?? null) as IssuerParty | null,
  }

  const buffer = await renderToBuffer(
    createElement(InvoicePdf, { data }) as Parameters<typeof renderToBuffer>[0],
  )

  return { buffer: buffer as Buffer, ref: data.ref }
}
