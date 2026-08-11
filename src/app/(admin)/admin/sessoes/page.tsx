import { listActiveSessions } from "@/lib/actions/admin-sessions"
import { SessionsClient } from "./client"

export const dynamic = "force-dynamic"

export default async function SessoesPage() {
  const { sessions, active, total } = await listActiveSessions()
  return <SessionsClient sessions={sessions} active={active} total={total} />
}
