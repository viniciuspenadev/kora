import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { getViewerScope, seesAllDeals } from "@/lib/visibility"
import { canAccessDeal } from "@/lib/actions/deals"
import { docCode, type DocumentKind } from "@/lib/commercial/documents"

/**
 * GET /api/documents/[id]/pdf
 *
 * Serve o PDF congelado de um documento comercial (cotação). Mesmo padrão
 * de /api/media/[id]: auth → lookup com tenant_id da sessão (anti-IDOR) →
 * MESMO gate de acesso ao negócio das actions (defesa em profundidade — a URL
 * é estável, então a rota não pode ser mais frouxa que a UI) →
 * stream-through do storage. O browser NUNCA vê o path do storage.
 * `?download=1` força attachment com filename "COT-0001-2026.pdf".
 */

export const runtime = "nodejs"

const BUCKET = "chat-attachments"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // ── 1. Auth ─────────────────────────────────────────────────
  const session = await auth()
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
  }
  const tenantId = session.user.tenantId

  // Entitlement vale em TODA superfície (auditoria F4): tenant sem o módulo CRM
  // (downgrade) não serve PDF nem pela URL estável.
  if (!(await hasModule(tenantId, "crm"))) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 })
  }

  // ── 2. Lookup (tenant_id explícito previne IDOR) ────────────
  const { data: doc } = await supabaseAdmin
    .from("commercial_documents")
    .select("id, kind, year, number, pdf_path, deal_id")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle()

  const row = doc as { kind: DocumentKind; year: number; number: number; pdf_path: string | null; deal_id: string | null } | null
  if (!row || !row.pdf_path) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 })
  }

  // ── 2b. Gate do NEGÓCIO (espelha requireDealAccess das actions) ──
  const scope = await getViewerScope()
  if (!seesAllDeals(scope)) {
    if (!row.deal_id) return NextResponse.json({ error: "Não encontrado" }, { status: 404 })
    const { data: deal } = await supabaseAdmin.from("tenant_deals")
      .select("contact_id, assigned_to").eq("id", row.deal_id).eq("tenant_id", tenantId).maybeSingle()
    const d = deal as { contact_id: string | null; assigned_to: string | null } | null
    const mine = d?.assigned_to === session.user.id
    if (!d || (!mine && !(await canAccessDeal(tenantId, d.contact_id)))) {
      return NextResponse.json({ error: "Não encontrado" }, { status: 404 })
    }
  }

  // ── 3. Download do storage (stream-through) ─────────────────
  const { data: blob, error } = await supabaseAdmin.storage.from(BUCKET).download(row.pdf_path)
  if (error || !blob) {
    return NextResponse.json({ error: "Falha ao baixar o documento" }, { status: 500 })
  }

  // "COT-0001/2026" → filename seguro "COT-0001-2026.pdf"
  const fileName = `${docCode(row.kind, row.number, row.year).replace("/", "-")}.pdf`
  const download = req.nextUrl.searchParams.get("download") === "1"

  return new NextResponse(blob, {
    status: 200,
    headers: {
      "Content-Type":   "application/pdf",
      "Content-Length": String(blob.size),
      "Cache-Control":  "private, max-age=3600",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
    },
  })
}
