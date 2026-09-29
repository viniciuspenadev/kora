import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Foto de um item do catálogo — servida SÓ pra membros do tenant dono do item
 * (mesmo padrão do /api/user-avatar: sem enumeração cross-tenant; storage privado).
 */
export const runtime = "nodejs"

const CATALOG_BUCKET = "chat-attachments"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const session = await auth()
  if (!session?.user?.tenantId) return new NextResponse("Unauthorized", { status: 401 })

  const { itemId } = await params
  const { data } = await supabaseAdmin.from("catalog_items")
    .select("image_path").eq("id", itemId).eq("tenant_id", session.user.tenantId).maybeSingle()
  const path = (data as { image_path: string | null } | null)?.image_path
  if (!path) return new NextResponse("Not found", { status: 404 })

  const { data: blob, error } = await supabaseAdmin.storage.from(CATALOG_BUCKET).download(path)
  if (error || !blob) return new NextResponse("Not found", { status: 404 })

  const buffer = Buffer.from(await blob.arrayBuffer())
  const ext = path.split(".").pop()
  const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg"
  return new NextResponse(buffer, {
    headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" },
  })
}
