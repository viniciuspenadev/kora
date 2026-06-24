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
    .setExpirationTime("1h")
    .sign(secret)
}
