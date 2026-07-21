import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { hasModule } from "@/lib/modules"
import { BookOpen } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { BackToIA } from "../back-to-ia"
import { listKnowledgeItems } from "@/lib/actions/ai/knowledge"
import { ConhecimentoClient } from "./conhecimento-client"

export default async function ConhecimentoPage() {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const tenantId = session.user.tenantId
  if (!(await hasModule(tenantId, "ai_atendente"))) redirect("/automacao/mensagens")

  const items = await listKnowledgeItems()

  return (
    <PageShell
      title="Base de conhecimento"
      description="Os fatos que a IA pode usar pra responder — FAQ, políticas, catálogo."
      icon={BookOpen}
      actions={<BackToIA />}
    >
      <ConhecimentoClient items={items} />
    </PageShell>
  )
}
