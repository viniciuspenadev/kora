import { notFound } from "next/navigation"
import { auth } from "@/auth"

/**
 * 🔴 TRAVA TEMPORÁRIA — as telas de assinatura ainda renderizam `buildMock()`.
 *
 * Enquanto os dados forem mock, expor isto a um cliente é pior que não ter a tela:
 * ele abriria "Assinatura" e leria um valor de fatura **inventado**, com data de
 * vencimento inventada. Informação financeira falsa não é rascunho — é dano.
 *
 * Ao mesmo tempo, deixar as telas fora do deploy atrasaria tudo que já está pronto
 * (correções de segurança, gates de gasto, o Toaster). Então elas SOBEM, e ficam
 * alcançáveis apenas por platform admin — o dono consegue revisar o resultado em
 * produção, com o layout e a tipografia reais, sem nenhum cliente ver número falso.
 *
 * ⚠️ REMOVER ESTE ARQUIVO quando `buildMock()` for trocado por `getBillingStanding()` +
 *    queries reais. E, no mesmo commit, reativar o item "Assinatura" em
 *    `src/components/app/settings-nav.tsx` (está comentado, com este mesmo TODO).
 *    Enquanto os dois existirem, a tela está fechada de propósito — não é esquecimento.
 *
 * Gate no LAYOUT, não em cada página: cobre as 4 rotas (raiz, consumo, faturas,
 * fatura/[id]) de uma vez. Uma rota nova dentro da pasta nasce fechada junto.
 * `notFound()` em vez de redirect: não confirma que a rota existe pra quem sondar.
 */
export default async function AssinaturaGateLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user?.isPlatformAdmin) notFound()
  return <>{children}</>
}
