"use client"

import { useRouter } from "next/navigation"
import type { MetaTemplate } from "@/lib/providers/meta-cloud-provider"
import type { KoraCategory } from "@/lib/templates/library"
import { TemplateBuilder, templateToBuilderState } from "./template-builder"

/**
 * Wrapper de edição: recebe o template (do server component) e o injeta no builder
 * em modo "edit". Voltar/concluir levam de volta pra ficha do template.
 * `koraCategory` (propósito atual) vem junto pra NÃO ser apagado ao salvar.
 */
export function EditTemplateClient({ id, template, koraCategory }: { id: string; template: MetaTemplate; koraCategory: string | null }) {
  const router = useRouter()
  return (
    <TemplateBuilder
      mode="edit"
      templateId={id}
      initial={{ ...templateToBuilderState(template), koraCategory: (koraCategory || null) as KoraCategory | null }}
      onClose={() => router.push(`/templates/${id}`)}
      onDone={() => router.push(`/templates/${id}`)}
    />
  )
}
