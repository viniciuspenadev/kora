import { NextResponse, type NextRequest } from "next/server"

/**
 * Auth dos endpoints de cron. **Fail-closed**: se CRON_SECRET não estiver setada,
 * recusa (503) em vez de rodar aberto. Em produção a env está setada — então isso
 * é invisível lá; só fecha o buraco de "aberto se a env sumir".
 *
 * @returns NextResponse de erro (401/503) se não autorizado, ou `null` se ok.
 */
export function requireCronSecret(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return null
}
