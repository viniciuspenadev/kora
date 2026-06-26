import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronRight, AtSign } from "lucide-react"
import { supabaseAdmin } from "@/lib/supabase"
import { PageShell } from "@/components/ui/page-shell"
import { InstagramConnectClient } from "./instagram-connect-client"

export const dynamic = "force-dynamic"

export default async function InstagramIntegrationPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")
  const sp = await searchParams
  const notice = sp.error ? { error: sp.error } : sp.connected ? { ok: true } : undefined

  const { data } = await supabaseAdmin
    .from("channel_connections")
    .select("external_account_id, username, status, access_token")
    .eq("tenant_id", session.user.tenantId).eq("channel", "instagram")
    .maybeSingle()

  const connection = data
    ? { external_account_id: data.external_account_id as string, username: (data.username as string | null) ?? null, status: data.status as string, hasToken: !!data.access_token }
    : null

  return (
    <PageShell title="Instagram Direct" description="Receba e responda mensagens do Instagram dentro da Kora." icon={AtSign}>
      <div className="text-xs flex items-center gap-1.5 text-slate-400 mb-5">
        <Link href="/integracoes" className="hover:text-slate-600">Integrações</Link>
        <ChevronRight className="size-3 text-slate-300" />
        <span className="font-semibold text-slate-600">Instagram Direct</span>
      </div>
      <InstagramConnectClient connection={connection} notice={notice} />
    </PageShell>
  )
}
