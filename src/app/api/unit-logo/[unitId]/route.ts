import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Logo de uma unidade (empresa/filial) por id. Qualquer membro autenticado do
 * tenant pode ver (não é PII sensível). Anti-IDOR: só serve se a unidade for do
 * MESMO tenant da sessão → sem enumeração cross-tenant. URL estável (auth pela sessão).
 */
export const runtime = "nodejs"

const UNIT_LOGO_BUCKET = "chat-attachments"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ unitId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 })
  if (!session.user.tenantId) return new NextResponse("Not found", { status: 404 })

  const { unitId } = await params

  const { data } = await supabaseAdmin
    .from("tenant_units")
    .select("logo_path")
    .eq("id", unitId)
    .eq("tenant_id", session.user.tenantId)
    .maybeSingle()

  const path = data?.logo_path
  if (!path) return new NextResponse("Not found", { status: 404 })

  const { data: blob, error } = await supabaseAdmin.storage.from(UNIT_LOGO_BUCKET).download(path)
  if (error || !blob) return new NextResponse("Not found", { status: 404 })

  const buffer = Buffer.from(await blob.arrayBuffer())
  return new NextResponse(buffer, {
    headers: {
      "Content-Type":  blob.type || "image/png",
      "Cache-Control": "private, max-age=3600",
    },
  })
}
