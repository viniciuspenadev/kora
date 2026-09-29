import { auth } from "@/auth"
import { notFound, redirect } from "next/navigation"
import { FaturaClient } from "./fatura-client"
import { buildMock, parseDegrau } from "../../mock"
import { loadFatura } from "../../loader"

// B3 · Fatura (visão do cliente).
// Sem a casca de abas: é um DOCUMENTO, e documento tem volta explícita, não aba.

export const dynamic = "force-dynamic"

export default async function FaturaPage({
  params, searchParams,
}: {
  params:       Promise<{ id: string }>
  searchParams: Promise<{ degrau?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const { id } = await params
  const { degrau } = await searchParams

  // 🔒 IDOR FECHADO: `loadFatura` filtra por `tenant_id` DENTRO da query — trocar o id na
  //    URL devolve `null`, não a fatura de outro cliente. E `notFound()` em vez de 403:
  //    confirmar que um id existe já é informação. (O designer desta tela deixou o aviso
  //    aqui; está cumprido em `lib/billing/invoices-view.ts`.)
  const preview = degrau && session.user.isPlatformAdmin
  const fatura = preview
    ? buildMock(parseDegrau(degrau)).faturas.find((f) => f.id === id) ?? null
    : await loadFatura(session.user.tenantId, id)
  if (!fatura) notFound()

  return <FaturaClient fatura={fatura} />
}
