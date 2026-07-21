import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { User } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { BackToIA } from "../back-to-ia"
import { PersonaClient } from "./persona-client"
import type { AIConfig } from "@/types/ai"

export default async function PersonaPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const tenantId = session.user.tenantId
  if (!(await hasModule(tenantId, "ai_atendente"))) redirect("/automacao/mensagens")

  const { data: config } = await supabaseAdmin
    .from("ai_config")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle()

  return (
    <PageShell
      title="Persona"
      description="Quem é a sua IA e como ela conversa."
      icon={User}
      actions={<BackToIA />}
    >
      <PersonaClient config={(config as AIConfig | null) ?? null} />
    </PageShell>
  )
}
