import { redirect } from "next/navigation"

// A Distribuição automática foi REMOVIDA do produto em 2026-08-26 (decisão do dono;
// nunca executou em produção). A rota fica viva só pra não quebrar bookmarks antigos —
// quem chegar aqui cai em Atendimento, onde moram Vínculo e Inatividade.
export default function DistribuicaoRedirect() {
  redirect("/configuracoes/atendimento")
}
