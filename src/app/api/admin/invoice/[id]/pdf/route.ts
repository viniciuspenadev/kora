import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { renderInvoicePdf } from "@/lib/pdf/invoice-render"

/**
 * GET /api/admin/invoice/[id]/pdf — a mesma fatura, pela ótica da operação.
 *
 * ⚠️ A MONTAGEM saiu daqui para `lib/pdf/invoice-render.ts` (06/08/2026), quando o cliente
 *    ganhou a rota dele. Eram 60 linhas de leitura, ordenação de itens e mapeamento que
 *    teriam que existir em dois lugares — e divergiriam no primeiro campo novo, fazendo
 *    operação e cliente lerem faturas diferentes do mesmo mês.
 * 🔒 Sem `tenantId`: o platform admin atende todos os clientes, então aqui é de propósito
 *    que não há filtro de tenant. O gate é o `isPlatformAdmin` logo abaixo.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.isPlatformAdmin) {
    return NextResponse.json({ error: "Acesso restrito" }, { status: 403 })
  }

  const { id } = await params
  const out = await renderInvoicePdf(id)

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
