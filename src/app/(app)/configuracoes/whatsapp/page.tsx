import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { Server } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { ConfigPageClient } from "./config-client"

export default async function WhatsAppConfigPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")

  if (!["owner", "admin"].includes(session.user.role)) {
    redirect("/inbox")
  }

  const { data: instance } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("*")
    .eq("tenant_id", session.user.tenantId)
    .maybeSingle()

  return (
    <PageShell
      title="WhatsApp"
      description="Conecte seu número e veja o status da sua linha em tempo real."
      icon={Server}
    >
      <ConfigPageClient instance={instance} />
    </PageShell>
  )
}
