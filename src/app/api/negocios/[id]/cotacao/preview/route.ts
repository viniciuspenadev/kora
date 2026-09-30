import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { requireModule } from "@/lib/modules"
import { getViewerScope, seesAllDeals } from "@/lib/visibility"
import { canAccessDeal } from "@/lib/actions/deals"
import { renderQuotePreviewBuffer } from "@/lib/commercial/documents"
import type { RichDoc } from "@/lib/commercial/richdoc"

/**
 * POST /api/negocios/[id]/cotacao/preview
 * Renderiza o PDF de PRÉVIA da cotação a partir do estado atual do compositor
 * (não persiste). Escopo: tenant da sessão (buildQuoteSnapshot filtra o deal por
 * tenant_id — anti-IDOR cross-tenant) + gate POR-ATENDENTE do negócio (H-10, auditoria
 * 2026-07-30: sem ele um agent enumeraria IDs e puxaria o PDF — com PII/doc/preços — de
 * negócios que não vê; espelha /api/documents/[id]/pdf).
 * Body: { validUntil, paymentTerms(RichDoc), notes(RichDoc), clauses }.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.tenantId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
  try { await requireModule("crm") } catch { return NextResponse.json({ error: "Módulo CRM não habilitado" }, { status: 403 }) }

  const { id: dealId } = await params

  // H-10: gate por-atendente do NEGÓCIO (defesa em profundidade — a rota estável não pode
  // ser mais frouxa que a UI). Falha rápido, antes de parsear body/renderizar PDF caro.
  const scope = await getViewerScope()
  if (!seesAllDeals(scope)) {
    const { data: deal } = await supabaseAdmin.from("tenant_deals")
      .select("contact_id, assigned_to").eq("id", dealId).eq("tenant_id", session.user.tenantId).maybeSingle()
    const d = deal as { contact_id: string | null; assigned_to: string | null } | null
    const mine = d?.assigned_to === session.user.id
    if (!d || (!mine && !(await canAccessDeal(session.user.tenantId, d.contact_id)))) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 })
    }
  }

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
