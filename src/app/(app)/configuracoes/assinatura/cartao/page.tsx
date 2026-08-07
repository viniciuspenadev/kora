import { redirect } from "next/navigation"

// B7 · Trocar o cartão da assinatura
//
// 🔑 A ROTA SOBREVIVEU, A PÁGINA NÃO (07/08). Trocar cartão virou MODAL na tela de
//    assinatura — são 4 campos, e mandar a pessoa pra outra página custa justamente o
//    contexto que ela precisa (a linha que diz que a cobrança falhou).
//
// ⚠️ Mas a URL não pode morrer: é pra ela que o e-mail de "cartão recusado" aponta, e
//    link de e-mail precisa de endereço, não de estado de React. Então a rota continua
//    existindo e faz uma coisa só — abrir a tela de assinatura com o modal aberto.
//
// ⚠️ Zero guarda aqui de propósito. Sessão, papel (owner/admin), existência da assinatura
//    e completude do cadastro fiscal são checados no DESTINO — e uma cópia das mesmas
//    quatro regras aqui seria a quinta chance de uma delas divergir. A página anterior
//    tinha três delas duplicadas.

export default function TrocarCartaoPage() {
  redirect("/configuracoes/assinatura?cartao=1")
}
