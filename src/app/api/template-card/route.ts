import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Mídia de um card de carrossel — servida SÓ pra membros do tenant dono do
 * template (tenant-gated; storage privado). Query: ?name=&lang=&i=<índice>.
 * A mídia mora em wa_templates.card_assets[i].path. Mesmo modelo do
 * /api/catalog-image (sem enumeração cross-tenant).
 */
export const runtime = "nodejs"

const BUCKET = "chat-attachments"
const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", mp4: "video/mp4",
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.tenantId) return new NextResponse("Unauthorized", { status: 401 })

  const url  = new URL(req.url)
  const name = url.searchParams.get("name")
  const lang = url.searchParams.get("lang")
  const i    = Number(url.searchParams.get("i"))
  if (!name || !lang || !Number.isInteger(i) || i < 0) return new NextResponse("Bad request", { status: 400 })

  const { data } = await supabaseAdmin.from("wa_templates")
    .select("card_assets").eq("tenant_id", session.user.tenantId).eq("name", name).eq("language", lang).maybeSingle()
  const assets = (data as { card_assets: Array<{ path: string; mime?: string }> | null } | null)?.card_assets
  const asset  = assets?.[i]
  if (!asset?.path) return new NextResponse("Not found", { status: 404 })

  const { data: blob, error } = await supabaseAdmin.storage.from(BUCKET).download(asset.path)
  if (error || !blob) return new NextResponse("Not found", { status: 404 })

  const buffer = Buffer.from(await blob.arrayBuffer())
  const ext = asset.path.split(".").pop()?.toLowerCase() ?? "jpg"
  return new NextResponse(buffer, {
    headers: { "Content-Type": asset.mime ?? MIME[ext] ?? "image/jpeg", "Cache-Control": "private, max-age=3600" },
  })
}
