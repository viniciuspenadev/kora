import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { requireModule } from "@/lib/modules"
import { renderQuotePreviewBuffer } from "@/lib/commercial/documents"
import type { RichDoc } from "@/lib/commercial/richdoc"

/**
 * POST /api/negocios/[id]/cotacao/preview
 * Renderiza o PDF de PRÉVIA da cotação a partir do estado atual do compositor
 * (não persiste). Escopo: tenant da sessão (buildQuoteSnapshot filtra o deal por
 * tenant_id — anti-IDOR). Body: { validUntil, paymentTerms(RichDoc), notes(RichDoc), clauses }.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
  try { await requireModule("crm") } catch { return NextResponse.json({ error: "Módulo CRM não habilitado" }, { status: 403 }) }

  const { id: dealId } = await params
  const body = (await req.json().catch(() => ({}))) as {
    validUntil?: string | null
    paymentTerms?: RichDoc | null
    notes?: RichDoc | null
    contract?: RichDoc | null
    paymentMethod?: string | null
    installments?: number | null
  }
  // Parcelas: inteiro 1..60 ou null (payload é do client — sanitiza).
  const inst = typeof body.installments === "number" && Number.isFinite(body.installments)
    ? Math.min(60, Math.max(1, Math.floor(body.installments))) : null

  const res = await renderQuotePreviewBuffer(session.user.tenantId, dealId, {
    validUntil:    body.validUntil ?? null,
    paymentTerms:  body.paymentTerms ?? null,
    notes:         body.notes ?? null,
    contract:      body.contract ?? null,
    paymentMethod: typeof body.paymentMethod === "string" ? body.paymentMethod.slice(0, 60) : null,
    installments:  inst,
  })
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: 400 })

  return new NextResponse(res.buffer as unknown as BodyInit, {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": "inline; filename=\"cotacao-previa.pdf\"",
      "Cache-Control":       "no-store",
    },
  })
}
