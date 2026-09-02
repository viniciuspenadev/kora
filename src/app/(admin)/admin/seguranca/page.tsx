import { getSecurityOverview } from "@/lib/actions/admin-security"
import { SecurityClient } from "./client"

export const dynamic = "force-dynamic"

export default async function SegurancaPage() {
  const data = await getSecurityOverview()
  return <SecurityClient data={data} />
}
