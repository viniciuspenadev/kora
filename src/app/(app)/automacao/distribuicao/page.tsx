import { redirect } from "next/navigation"

// A Distribuição foi consolidada em Configurações → Atendimento (1ª aba).
// Mantém a rota viva pra não quebrar links/bookmarks.
export default function DistribuicaoRedirect() {
  redirect("/configuracoes/atendimento")
}
