"use client"

import { useRouter } from "next/navigation"
import type { MetaTemplate } from "@/lib/providers/meta-cloud-provider"
import { TemplateBuilder, templateToBuilderState } from "./template-builder"

/**
 * Wrapper de edição: recebe o template (do server component) e o injeta no builder
 * em modo "edit". Voltar/concluir levam de volta pra ficha do template.
 */
export function EditTemplateClient({ id, template }: { id: string; template: MetaTemplate }) {
  const router = useRouter()
  return (
    <TemplateBuilder
      mode="edit"
      templateId={id}
      initial={templateToBuilderState(template)}
      onClose={() => router.push(`/templates/${id}`)}
      onDone={() => router.push(`/templates/${id}`)}
    />
  )
}
