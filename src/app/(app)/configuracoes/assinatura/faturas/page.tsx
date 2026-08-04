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
  const { faturas } = buildMock(parseDegrau(degrau))

  return (
    <AssinaturaShell>
      <FaturasClient faturas={faturas} />
    </AssinaturaShell>
  )
}
