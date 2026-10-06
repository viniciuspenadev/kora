import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { AssinaturaShell } from "../components/assinatura-shell"
import { ConsumoClient } from "./consumo-client"
import { buildMock, parseDegrau } from "../mock"
import { loadAssinatura } from "../loader"

// B2 · Consumo — evolução de /configuracoes/uso.
// ⚠️ Esta tela NÃO substitui o arquivo antigo por conta própria: o dono troca
//    quando aprovar. `src/app/(app)/configuracoes/uso/` segue intocado.

export const dynamic = "force-dynamic"

export default async function ConsumoPage({
  searchParams,
}: {
  searchParams: Promise<{ degrau?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  // TODO(dev): `listAllLimits()` + preço do plano + projeção do ciclo. O shape
  // que a tela espera está em ../types.ts (LinhaMedida / LinhaDiscreta).
  // `?degrau=` é o modo PRÉVIA (revisar os 5 estados da escada sem cliente inadimplente
  // de verdade). Só platform admin — o layout desta pasta já garante isso hoje, e a
  // checagem aqui sobrevive ao dia em que a rota abrir pros clientes.
  const { degrau } = await searchParams
  const preview = degrau && session.user.isPlatformAdmin
  const mock = preview ? buildMock(parseDegrau(degrau)) : await loadAssinatura(session.user.tenantId)

  return (
    <AssinaturaShell>
      <ConsumoClient mock={mock} />
    </AssinaturaShell>
  )
}
