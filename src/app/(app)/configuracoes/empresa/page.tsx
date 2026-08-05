import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { getMyCompanyProfile } from "@/lib/actions/company-profile"
import { EmpresaClient } from "./client"

// ═══════════════════════════════════════════════════════════════
// Dados da empresa — o cadastro fiscal, do lado do cliente
// ═══════════════════════════════════════════════════════════════
// Esta tela fechou um buraco concreto: o cadastro fiscal só existia no god mode. Quem
// assinava e faltava um dado (CEP, número) via um aviso mandando "falar com a gente" —
// sem nenhum lugar pra resolver sozinho. Cobrança que depende de suporte pra começar é
// cobrança que não começa.

export const dynamic = "force-dynamic"

export default async function EmpresaPage() {
  const session = await auth()
  if (!session?.user?.tenantId) redirect("/auth/signin")

  // Dado fiscal é assunto de dono. O gate real está na action (que recusa e devolve
  // `null`); este redirect só evita a tela em branco pra quem não deveria ter chegado.
  const perfil = await getMyCompanyProfile()
  if (!perfil) redirect("/inbox")

  return <EmpresaClient inicial={perfil} />
}
