import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { fetchIgProfilePicture, getInstagramSender } from "@/lib/instagram/api"
import { isAllowedCdn } from "@/lib/instagram/thumb"

/**
 * GET /api/ig-avatar
 *
 * Foto de perfil da conta de Instagram CONECTADA, servida por URL estável e sem parâmetro.
 * Usada na prévia do gatilho de comentário (o "quem manda o direct" tem cara de gente).
 *
 * 🔴 POR QUE NÃO CONGELA NO STORAGE, ao contrário da thumb de post:
 *    a thumb de um post é imutável — congelou, vale pra sempre. **Foto de perfil muda**
 *    quando o cliente troca a dele, e um arquivo congelado ficaria mostrando a foto antiga
 *    sem ninguém perceber. Aqui a URL do CDN é buscada FRESCA a cada carga fria e os bytes
 *    são transmitidos na hora; o cache do browser (1 dia) segura o volume.
 *    A regra que continua valendo: URL de CDN da Meta **nunca** é gravada em lugar nenhum.
 *
 * Segurança:
 *  • sem sessão → 401, sempre.
 *  • papel owner/admin: mesmo gate de `/api/ig-thumb` — o editor de fluxos é o único
 *    lugar que renderiza isto.
 *  • **tenant vem da SESSÃO**; o token sai do `channel_connections` daquele tenant. Não há
 *    parâmetro nenhum na rota → não existe id pra trocar, logo não há enumeração.
 *  • anti-SSRF: a URL não vem do cliente (vem da Graph, fresca) E ainda passa pela
 *    allow-list de hosts de CDN da Meta, a mesma de `freezeIgThumb`.
 *  • teto de bytes antes de materializar o corpo.
 */
export const runtime = "nodejs"

/** Foto de perfil é pequena (~200x200). Acima disso, não é o que pedimos. */
const MAX_AVATAR_BYTES = 2_000_000

export async function GET() {
  const session = await auth()
  if (!session?.user?.tenantId) return new NextResponse("Unauthorized", { status: 401 })
  if (!["owner", "admin"].includes(session.user.role)) {
    return new NextResponse("Forbidden", { status: 403 })
  }

  const sender = await getInstagramSender(session.user.tenantId)
  if (!sender) return new NextResponse("Not found", { status: 404 })

  const cdnUrl = await fetchIgProfilePicture(sender.token)
  if (!cdnUrl || !isAllowedCdn(cdnUrl)) return new NextResponse("Not found", { status: 404 })

  try {
    const res = await fetch(cdnUrl)
    if (!res.ok) return new NextResponse("Not found", { status: 404 })

    const declared = Number(res.headers.get("content-length") ?? 0)
    if (declared > MAX_AVATAR_BYTES) return new NextResponse("Not found", { status: 404 })

    const blob = await res.blob()
    if (!blob.size || blob.size > MAX_AVATAR_BYTES) return new NextResponse("Not found", { status: 404 })

    return new NextResponse(blob, {
      headers: {
        "Content-Type":   blob.type.startsWith("image/") ? blob.type : "image/jpeg",
        "Content-Length": String(blob.size),
        "Cache-Control":  "private, max-age=86400",   // 1 dia; a URL é estável
      },
    })
  } catch (e) {
    console.error("[ig-avatar] download:", (e as Error).message)
    return new NextResponse("Not found", { status: 404 })
  }
}
