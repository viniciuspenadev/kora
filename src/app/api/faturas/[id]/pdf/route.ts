import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { renderInvoicePdf } from "@/lib/pdf/invoice-render"

/**
 * GET /api/faturas/[id]/pdf — a fatura do PRÓPRIO cliente, em PDF.
 *
 * 🔴 NÃO EXISTIA (achado do dono, 06/08/2026). O documento já era gerado — mas só em
 *    `/api/admin/invoice/[id]/pdf`, restrito ao god mode. O cliente, que é o titular da
 *    fatura e quem precisa dela pra contabilidade, não tinha por onde baixar.
 *
 * 🔒 Três paredes, nesta ordem:
 *    1. sessão — sem ela, 401;
 *    2. PAPEL: valor de fatura é assunto de owner/admin, nunca do atendente (mesmo
 *       recorte de `getMyBillingStanding`, que zera `invoice` pra `agent`);
 *    3. TENANT: o `renderInvoicePdf` recebe o tenant da SESSÃO e recusa fatura de outro.
 *       O id vem da URL e é enumerável — sem essa comparação, um owner baixaria a fatura
 *       de outro cliente, com razão social, CNPJ, endereço e valores.
 *
 * ⚠️ `no-store`: documento fiscal com PII não fica em cache de proxy nem de navegador.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
  }
  if (!["owner", "admin"].includes(session.user.role)) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 })
  }

  const { id } = await params
  const out = await renderInvoicePdf(id, session.user.tenantId)

  if ("error" in out) {
    return NextResponse.json({ error: out.error }, { status: out.status })
  }

  return new NextResponse(out.buffer as unknown as BodyInit, {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `inline; filename="fatura-${out.ref}.pdf"`,
      "Cache-Control":       "private, no-store",
    },
  })
}
