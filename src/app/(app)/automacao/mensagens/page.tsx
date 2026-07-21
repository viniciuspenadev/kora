import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { Bell } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { AutomationTab } from "../../configuracoes/whatsapp/automation-tab"

export default async function MensagensAutomaticasPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const { data: automation } = await supabaseAdmin
    .from("tenant_config")
    .select(`
      welcome_enabled, welcome_message, welcome_trigger, welcome_reopen_days,
      business_hours_enabled, business_hours_message, business_hours_schedule, business_hours_timezone
    `)
    .eq("tenant_id", session.user.tenantId)
    .maybeSingle()

  return (
    <PageShell
      variant="list"
      title="Mensagens automáticas"
      description="Boas-vindas e horário comercial. Resposta imediata 1:1, disponível em todos os planos."
      icon={Bell}
    >
      <AutomationTab initial={automation} />
    </PageShell>
  )
}
