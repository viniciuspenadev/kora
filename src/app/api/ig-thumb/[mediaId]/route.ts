import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { readIgThumb } from "@/lib/instagram/thumb"

/**
 * GET /api/ig-thumb/[mediaId]
 *
 * Proxy estável da thumbnail do post do Instagram usada no gatilho de comentário.
 * A URL do CDN da Meta é assinada e expira em ~1-2 dias; os bytes ficam no Storage
 * privado e são servidos por aqui (mesmo padrão de /api/media/[id] e /api/avatar).
 *
 * Segurança:
 *  • sem sessão → 401, sempre. Nunca signed URL do Storage no cliente.
 *  • o tenant vem da SESSÃO e entra no caminho do Storage → um tenant não alcança a
 *    pasta do outro nem trocando o id da URL (sem enumeração cross-tenant).
 *  • papel owner/admin: é o mesmo gate do editor de fluxos, único lugar que renderiza.
 *  • id da mídia é validado antes de virar caminho (traversal) — ver isSafeIgMediaId.
 */
export const runtime = "nodejs"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ mediaId: string }> }) {
  const session = await auth()
  if (!session?.user?.tenantId) return new NextResponse("Unauthorized", { status: 401 })
  if (!["owner", "admin"].includes(session.user.role)) {
    return new NextResponse("Forbidden", { status: 403 })
  }

  const { mediaId } = await params
  const thumb = await readIgThumb(session.user.tenantId, mediaId)
  if (!thumb) return new NextResponse("Not found", { status: 404 })

  return new NextResponse(thumb.blob, {
    headers: {
      "Content-Type":   thumb.mime,
      "Content-Length": String(thumb.blob.size),
      "Cache-Control":  "private, max-age=86400",   // 1 dia no browser; a URL é estável
    },
  })
}
