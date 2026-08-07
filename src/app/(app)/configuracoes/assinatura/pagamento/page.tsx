import { redirect } from "next/navigation"

// B5 · Ativar assinatura (captura de cartão)
//
// 🔴 A PÁGINA FOI DESLIGADA (07/08) — a compra inteira mora no modal de planos, que faz
//    escolher → cadastro → cartão sem trocar de tela. Nenhum link do produto apontava mais
//    pra cá: `escolherPlano` parou de navegar em 05/08 e esta rota ficou órfã.
//
// 🔴 E ÓRFÃ ELA JÁ TINHA APODRECIDO. Ela anunciava a primeira cobrança para
//    `trial_ends_at` — o fim do teste — quando a regra mudou em 06/08 e passamos a cobrar
//    **hoje** (`dataDaPrimeiraCobranca`). Uma tela de pagamento sem entrada de usuário não
//    recebe correção: ninguém abre, ninguém reclama, e a data errada fica lá esperando o
//    dia em que alguém chega por um favorito antigo e recebe uma promessa que o gateway
//    não vai cumprir. Era a terceira superfície de checkout do produto, e as três
//    duplicavam as mesmas quatro guardas.
//
// 🔴 O DESTINO É A VITRINE, não a tela de assinatura (correção da revisão, 07/08). A
//    primeira versão deste redirect mandava pra `/configuracoes/assinatura?plano=…` — e
//    ninguém lê `?plano=` lá; pior, o modal de planos daquela rota só monta quando o teste
//    ACABOU. Quem clicasse num link antigo em pleno trial caía numa tela onde simplesmente
//    **nada acontecia**. Um beco que eu mesmo criei ao desligar a página.
// ⚠️ `/planos` existe, é gateada e monta o catálogo em qualquer degrau.

export default async function PagamentoPage({ searchParams }: {
  searchParams: Promise<{ plano?: string }>
}) {
  await searchParams   // consumido de propósito: a escolha é refeita na vitrine
  redirect("/configuracoes/assinatura/planos")
}
