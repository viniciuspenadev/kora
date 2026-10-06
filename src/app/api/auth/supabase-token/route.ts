import { NextResponse } from "next/server"
import { auth } from "@/auth"

/**
 * GET /api/auth/supabase-token
 *
 * Retorna o JWT Supabase atual do usuário logado. Cliente chama no mount e
 * a cada ~50min pra renovar o token usado pelo Realtime (expira em 1h, NextAuth
 * auto-renova no callback jwt quando faltam <5min).
 *
 * Sem sessão → 401. Sem tenant_id (platform admin sem tenant ativo) → 401.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.supabaseToken || !session.user.tenantId) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
  }
  return NextResponse.json({
    token:    session.user.supabaseToken,
    tenantId: session.user.tenantId,
  })
}
