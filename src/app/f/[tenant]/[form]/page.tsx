import { cache } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { loadPublicForm } from "@/lib/forms/public"
import { PublicForm, PublicFormShell, PublicFormUnavailable } from "@/components/forms/public-form"

// Link próprio do formulário: /f/<empresa>/<formulário> (docs/forms-design.md §4.2 e D5 —
// só o formulário, sem construtor de página). Sempre dinâmica: o bilhete da página é por visita.
export const dynamic = "force-dynamic"

type Params = Promise<{ tenant: string; form: string }>
const load = cache((tenant: string, form: string) => loadPublicForm(tenant, form))

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { tenant, form } = await params
  const f = await load(tenant, form)
  // Formulário de cliente não vai para o Google (quem divulga é a empresa).
  const robots = { index: false, follow: false }
  if (f.state !== "ok") return { title: "Formulário", robots }
  return {
    title: `${f.definition.appearance.title.trim() || f.name}${f.businessName ? ` · ${f.businessName}` : ""}`,
    description: f.definition.appearance.intro.trim() || undefined,
    robots,
  }
}

export default async function PublicFormPage({ params }: { params: Params }) {
  const { tenant, form } = await params
  const f = await load(tenant, form)
  if (f.state === "not_found") notFound()
  return (
    <PublicFormShell businessName={f.businessName}>
      {f.state === "ok"
        ? <PublicForm publicId={f.publicId} definition={f.definition} businessName={f.businessName} renderToken={f.renderToken} />
        : <PublicFormUnavailable businessName={f.businessName} />}
    </PublicFormShell>
  )
}
