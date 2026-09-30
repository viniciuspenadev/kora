import { redirect } from "next/navigation"

// "Propostas" foi absorvida pela Lista de negócios (dono, 29/09/2026): a coluna "Orçamento"
// mostra o PDF e a situação, e os atalhos cobram os vencidos. Aceitar/recusar, anular e o
// histórico de versões ficam na aba de orçamentos do negócio. O endereço antigo segue vivo.
export default function PropostasPage() {
  redirect("/negocios?view=list&status=open&focus=with_quote")
}
