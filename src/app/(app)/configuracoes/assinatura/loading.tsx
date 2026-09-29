import { TabsPageSkeleton } from "@/components/ui/page-skeleton"

// Skeleton da seção (design-system §2.2) — a casca com as 3 abas aparece antes
// dos dados. Skeleton de header errado "pula" na transição; este casa com o
// AssinaturaShell.
export default function Loading() {
  return <TabsPageSkeleton tabs={3} />
}
