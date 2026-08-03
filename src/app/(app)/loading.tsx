import { GenericPageSkeleton } from "@/components/ui/page-skeleton"

// Fallback de navegação pra TODAS as rotas do app sem skeleton próprio:
// a casca aparece na hora, os dados chegam por streaming.
export default function Loading() {
  return <GenericPageSkeleton />
}
