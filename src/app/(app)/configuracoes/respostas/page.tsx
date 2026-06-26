import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { MessageSquare } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { RespostasConfigClient } from "./respostas-client"

export default async function RespostasConfigPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const { data: quickReplies } = await supabaseAdmin
    .from("chat_quick_replies")
    .select("*")
    .eq("tenant_id", session.user.tenantId)
    .order("shortcut")

  return (
    <PageShell
      title="Respostas rápidas"
      description="Atalhos prontos que o time digita com / no chat — economiza tempo nas dúvidas mais comuns."
      icon={MessageSquare}
    >
      <RespostasConfigClient quickReplies={quickReplies ?? []} />
    </PageShell>
  )
}
