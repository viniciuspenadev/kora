import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { AssinaturaShell } from "./components/assinatura-shell"
import { AssinaturaClient } from "./assinatura-client"
import { buildMock, parseDegrau } from "./mock"
import { loadAssinatura } from "./loader"

// B1 · Minha assinatura
// ⚠️ Gate igual ao de /configuracoes/uso (owner + admin). TODO(orquestrador):
//    se a decisão for restringir cobrança a OWNER, é aqui e nas irmãs — a tela
//    não deve inferir permissão do dado que recebe.

export const dynamic = "force-dynamic"

export default async function AssinaturaPage({
  searchParams,
}: {
  searchParams: Promise<{ degrau?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  // `?degrau=` é o modo PRÉVIA (revisar os 5 estados da escada sem cliente inadimplente
  // de verdade). Só platform admin — o layout desta pasta já garante isso hoje, e a
  // checagem aqui sobrevive ao dia em que a rota abrir pros clientes.
  const { degrau } = await searchParams
  const preview = degrau && session.user.isPlatformAdmin
  const mock = preview ? buildMock(parseDegrau(degrau)) : await loadAssinatura(session.user.tenantId)

  return (
    <AssinaturaShell>
      <AssinaturaClient mock={mock} />
    </AssinaturaShell>
  )
}
