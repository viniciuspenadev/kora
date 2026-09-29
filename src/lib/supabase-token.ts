import { SignJWT } from "jose"

export async function generateSupabaseToken(params: {
  userId: string
  tenantId: string
  role: string
}) {
  const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!)

  return new SignJWT({
    sub: params.userId,
    role: "authenticated",
    app_tenant_id: params.tenantId,
    app_role: params.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    // 🔒 10 MINUTOS (era 1h até 2026-08-03). Este é o ÚNICO token do produto que fala
    //    direto com o Postgres, sem passar pelo nosso servidor — então nenhuma checagem
    //    nossa o alcança depois de emitido, e a RLS filtra por cliente e por atendente,
    //    nunca por STATUS do cliente. Com 1h, desativar um cliente deixava quem estava com
    //    a aba aberta recebendo mensagem em tempo real por até 55 minutos.
    //    A regra: um token que fala direto com o banco não vive mais que a janela de
    //    revogação prometida (docs/access-revocation-design.md §4).
    // ⚠️ Mexer aqui exige mexer em REFRESH_MS (lib/realtime.ts) e no limiar de regeneração
    //    do callback jwt (auth.ts) — os três relógios são um só.
    .setExpirationTime("10m")
    .sign(secret)
}
