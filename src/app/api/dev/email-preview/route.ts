import { NextResponse, type NextRequest } from "next/server"
import { auth } from "@/auth"
import { getEmailTemplate } from "@/lib/email/catalog"

/**
 * GET /api/dev/email-preview?type=<slug>
 *
 * Renderiza o HTML do template de email no browser, sem enviar. Usado pelo
 * /admin/emails pra preview ao vivo. Sample context vem do próprio catalog.
 *
 * Acesso restrito ao platform admin pra evitar exposição pública dos
 * templates (poderiam revelar estrutura interna pra phishing).
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isPlatformAdmin) {
    return NextResponse.json({ error: "Acesso restrito" }, { status: 403 })
  }

  const type = req.nextUrl.searchParams.get("type") ?? "invite"
  const tpl  = getEmailTemplate(type)
  if (!tpl) {
    return NextResponse.json({ error: `Template desconhecido: ${type}` }, { status: 404 })
  }

  const email = tpl.build()
  return new NextResponse(email.html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}
