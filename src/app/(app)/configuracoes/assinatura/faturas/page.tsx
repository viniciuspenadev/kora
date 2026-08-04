import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { AssinaturaShell } from "../components/assinatura-shell"
import { FaturasClient } from "./faturas-client"
import { buildMock, parseDegrau } from "../mock"
import { loadAssinatura } from "../loader"

// B4 · Histórico de faturas

export const dynamic = "force-dynamic"

export default async function FaturasPage({
  searchParams,
}: {
  searchParams: Promise<{ degrau?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  // TODO(dev): `select * from invoices where tenant_id = … order by due_date desc`.
  const { degrau } = await searchParams
  // ⚠️ Esta página ficou pra trás quando as irmãs foram ligadas ao dado real (achado do
  //    revisor, 2026-08-04): o script que fez a troca casou `const mock = buildMock(...)`
  //    e esta usa `const { faturas } = ...`. O import de `loadAssinatura` entrou, a troca
  //    não — e como import não usado não quebra nada, ninguém reclamou. Sem isto, o
  //    cliente veria TRÊS faturas pagas do "Plano Pro" que nunca existiram, e clicar em
  //    qualquer uma daria 404 (o id do mock não é uuid).
  const preview = degrau && session.user.isPlatformAdmin
  const { faturas } = preview
    ? buildMock(parseDegrau(degrau))
    : await loadAssinatura(session.user.tenantId)

  return (
    <AssinaturaShell>
      <FaturasClient faturas={faturas} />
    </AssinaturaShell>
  )
}
