import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { Sparkles } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { BackToIA } from "../../back-to-ia"
import { TriggerDetailClient, type TriggerOption } from "./trigger-detail-client"
import type { AITrigger } from "@/types/ai"

export default async function TriggerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!["owner", "admin"].includes(session.user.role)) redirect("/inbox")

  const tenantId = session.user.tenantId
  if (!(await hasModule(tenantId, "ai_atendente"))) redirect("/automacao/mensagens")

  const isNew = id === "new"

  const [{ data: trigger }, { data: departments }, { data: tags }, { data: stages }] = await Promise.all([
    isNew
      ? Promise.resolve({ data: null })
      : supabaseAdmin.from("ai_triggers").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle(),
    supabaseAdmin.from("tenant_departments").select("id, name, color").eq("tenant_id", tenantId).order("name"),
    supabaseAdmin.from("tags").select("id, name, color").eq("tenant_id", tenantId).order("name"),
    supabaseAdmin.from("pipeline_stages").select("id, name, color").eq("tenant_id", tenantId).order("position"),
  ])

  if (!isNew && !trigger) notFound()

  const departmentOptions: TriggerOption[] = (departments ?? []).map((d) => ({ id: d.id, name: d.name, color: d.color }))
  const tagOptions:        TriggerOption[] = (tags ?? []).map((t) => ({ id: t.id, name: t.name, color: t.color }))
  const stageOptions:      TriggerOption[] = (stages ?? []).map((s) => ({ id: s.id, name: s.name, color: s.color }))

  return (
    <PageShell
      title={isNew ? "Novo trigger" : "Editar trigger"}
      description="Quando essa regra deve fazer a IA atender, e como."
      icon={Sparkles}
      iconWrapClass="size-10 rounded-xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shrink-0"
      iconClass="size-5 text-white"
      actions={<BackToIA />}
    >
      <TriggerDetailClient
        trigger={(trigger as AITrigger | null) ?? null}
        departments={departmentOptions}
        tags={tagOptions}
        stages={stageOptions}
      />
    </PageShell>
  )
}
