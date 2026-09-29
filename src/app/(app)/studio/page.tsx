import { redirect } from "next/navigation"

/**
 * /studio virou REDIRECT (decisão do dono, 2026-07-30).
 *
 * Era um hub com 4 cards (Fluxos · Persona · Conhecimento · Atividade). Na prática ele
 * juntava coisas de ritmos muito diferentes — fluxo é trabalho diário, persona/conhecimento
 * se mexe uma vez, atividade é relatório — e cobrava um clique de pedágio antes da única
 * coisa que se usa todo dia. A lista de fluxos passou a ser a home do Studio, e os outros
 * três viraram um menu ao lado do CTA "Novo fluxo".
 *
 * O redirect fica: link antigo, favorito do cliente e `/studio` digitado na mão continuam
 * funcionando. Gate de sessão/role/módulo é da página de destino — não duplicar aqui
 * (regra duplicada é regra que diverge).
 */
export default async function StudioPage() {
  redirect("/studio/fluxos")
}
