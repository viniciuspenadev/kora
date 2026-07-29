import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronRight, AtSign, Lock } from "lucide-react"
import { supabaseAdmin } from "@/lib/supabase"
import { getEnabledModuleSlugs } from "@/lib/modules"
import { PageShell } from "@/components/ui/page-shell"
import { InstagramConnectClient } from "./instagram-connect-client"

export const dynamic = "force-dynamic"

export default async function InstagramIntegrationPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")
  const sp = await searchParams
  const notice = sp.error ? { error: sp.error } : sp.connected ? { ok: true } : undefined

  // Gate de licença — a página é uma porta como qualquer outra (menu ↔ página fail-closed).
  const modules = await getEnabledModuleSlugs(session.user.tenantId)
  if (!modules.has("instagram_direct")) {
    return (
      <PageShell title="Instagram Direct" description="Receba e responda mensagens do Instagram dentro da Kora." icon={AtSign}>
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-card">
          <Lock className="size-8 text-slate-300 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-900">Instagram Direct não está habilitado</h2>
          <p className="mt-1.5 text-sm text-slate-500 max-w-md mx-auto">
            Este canal não faz parte do seu plano atual. Fale com o suporte para liberá-lo na sua conta.
          </p>
          <Link href="/integracoes" className="inline-flex items-center gap-1.5 mt-5 text-sm font-semibold text-primary hover:underline">
            Voltar para Integrações
          </Link>
        </div>
      </PageShell>
    )
  }

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
