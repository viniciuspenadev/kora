import { listEmailOutbox, getEmailOutboxStats } from "@/lib/actions/emails"
import { EmailLogClient } from "./client"

export default async function EmailLogPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; template?: string; search?: string }>
}) {
  const sp = await searchParams

  const [{ rows }, stats] = await Promise.all([
    listEmailOutbox({
      status:       sp.status,
      templateSlug: sp.template,
      search:       sp.search,
      limit:        200,
    }),
    getEmailOutboxStats(30),
  ])

  return <EmailLogClient rows={rows} stats={stats} initialFilters={sp} />
}
