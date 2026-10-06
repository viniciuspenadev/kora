import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { hasModule } from "@/lib/modules"
import { getViewerScope, canViewForms } from "@/lib/visibility"
import { supabaseAdmin } from "@/lib/supabase"
import { getForm } from "@/lib/actions/forms"
import { FormEditor } from "@/components/forms/form-editor"

export const dynamic = "force-dynamic"

export default async function FormEditorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aba?: string }> }) {
  const session = await auth()
  if (!session) redirect("/auth/signin")
  if (!(await hasModule(session.user.tenantId, "forms"))) redirect("/inbox")
  const scope = await getViewerScope()
  if (!canViewForms(scope)) redirect("/inbox")

  const { id } = await params
  const [form, { data: tenant }] = await Promise.all([
    getForm(id),
    supabaseAdmin.from("tenants").select("name").eq("id", session.user.tenantId).maybeSingle(),
  ])
  if ("error" in form) notFound()
  // `?aba=respostas`: o aviso "precisa de contato" abre direto nas respostas.
  const { aba } = await searchParams
  const initialTab = aba === "respostas" || aba === "publicar" || aba === "resultados" ? aba : undefined

  return <FormEditor form={form} businessName={(tenant as { name?: string } | null)?.name ?? ""} initialTab={initialTab} />
}
