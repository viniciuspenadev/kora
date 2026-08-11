import { redirect } from "next/navigation"

/**
 * /configuracoes não tem tela própria — cai na PRIMEIRA do índice.
 *
 * Perfil, e não Tags: é a tela que TODO papel pode abrir (Tags depende do que a pessoa
 * administra) e a que ela mais procura. Landing tem que ser a porta mais provável, não a
 * primeira que alguém escreveu.
 * ⚠️ Mudou a ordem do índice (components/app/settings-nav)? Este destino acompanha.
 */
export default function ConfiguracoesPage() {
  redirect("/configuracoes/perfil")
}
