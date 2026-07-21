"use client"

import { useRouter } from "next/navigation"
import { TemplateBuilder, type BuilderInitial } from "./template-builder"
import { getBlueprint } from "@/lib/templates/library"

/** Mapeia um blueprint da Biblioteca pro estado-semente do editor (personalização). */
function blueprintInitial(id: string): BuilderInitial | undefined {
  const bp = getBlueprint(id)
  if (!bp) return undefined
  return {
    name:          bp.name,
    category:      bp.metaCategory === "MARKETING" ? "MARKETING" : "UTILITY",
    koraCategory:  bp.koraCategory,   // a Biblioteca já sabe o propósito → vem pré-setado
    language:      bp.language,
    varMode:       "name",   // blueprints usam variáveis nomeadas ({{nome}})
    headerText:    "",
    headerExample: "",
    body:          bp.body,
    examples:      bp.bodyExamples,
    footer:        "",
    buttons:       (bp.buttons ?? []).map((b) => ({ type: b.type, text: b.text, ...(b.url ? { url: b.url } : {}) })),
  }
}

export function NewTemplateClient({ blueprintId }: { blueprintId?: string | null }) {
  const router = useRouter()
  const initial = blueprintId ? blueprintInitial(blueprintId) : undefined
  return (
    <TemplateBuilder
      initial={initial}
      onClose={() => router.push("/templates")}
      onDone={() => router.push("/templates?created=1")}
    />
  )
}
