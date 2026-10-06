import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { loadPublicFormById } from "@/lib/forms/public"
import { embedHostPage } from "@/lib/forms/embed"
import { EmbedForm } from "@/components/forms/embed-form"

// O formulário dentro do site do cliente (docs/forms-design.md §4.2 · Fase 2b). Quem abre é o
// carregador /f.js, com a página do site em `?page=`. Os sites que podem mostrar esta página
// são impostos pelo navegador (`frame-ancestors`, no proxy). Sempre dinâmica: o bilhete é por visita.
export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Formulário", robots: { index: false, follow: false } }

export default async function EmbedPage({ params, searchParams }: {
  params: Promise<{ publicId: string }>; searchParams: Promise<{ page?: string | string[] }>
}) {
  const [{ publicId }, { page }] = await Promise.all([params, searchParams])
  const f = await loadPublicFormById(publicId)
  if (f.state === "not_found") notFound()
  const host = embedHostPage(typeof page === "string" ? page : null, f.allowedDomains, { dev: process.env.NODE_ENV !== "production" })
  const hostProps = { hostOrigin: host?.origin ?? null, hostPage: host?.url ?? null }

  return f.state === "ok"
    ? <EmbedForm {...hostProps} state="ok" publicId={f.publicId} definition={f.definition} businessName={f.businessName} renderToken={f.renderToken} />
    : <EmbedForm {...hostProps} state="unavailable" businessName={f.businessName} />
}
