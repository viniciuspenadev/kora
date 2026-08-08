import "server-only"
import { cache } from "react"
import { asaas } from "./client"
import { assinaturaRealId } from "@/lib/billing/gateway-limits"

// ═══════════════════════════════════════════════════════════════
// O que o gateway VAI cobrar, e quando — a verdade, não a projeção
// ═══════════════════════════════════════════════════════════════
//
// 🔴 POR QUE EXISTE (achado do dono, 06/08/2026). A tela de assinatura dizia
//    *"Sua próxima fatura de R$ 599,90 fecha em 11 de agosto"* para um cliente cuja
//    assinatura no Asaas está congelada em **R$ 5,00** e cobra em **11 de setembro**.
//    Errado nos dois números, e por uma causa só: a tela DERIVAVA de dado local —
//    o preço atual do plano e o `billing_day` — em vez de perguntar a quem cobra.
//
//    • O VALOR errava porque o gateway cobra o que foi congelado na criação da
//      assinatura; mudar o preço do plano não viaja pra lá (não existe `PUT`).
//    • A DATA errava porque `nextClosing` projeta o próximo `billing_day` e não sabe
//      que a cobrança daquele mês já foi consumida (pagamento adiantado).
//
// 🔑 REGRA: quando existe assinatura no gateway, quem manda na resposta
//    "quanto e quando" é o GATEWAY. O plano diz o que a gente *quer* cobrar; a
//    assinatura diz o que *vai* ser cobrado. Anunciar o primeiro como se fosse o
//    segundo é a tela prometer um valor que o cartão não vai debitar.
//
// ⚠️ FAIL-SOFT de propósito: se o Asaas não responder, devolve `null` e a tela volta pra
//    projeção local. Um aviso de fatura não pode derrubar a página — e a projeção, ainda
//    que imprecisa, é melhor que tela em branco.
// ⚠️ Memoizado por request (`cache`): a mesma tela pergunta em mais de um lugar.

export interface CobrancaDoGateway {
  /** Valor que o cartão vai debitar, em centavos. */
  valorCents: number
  /** `YYYY-MM-DD` da próxima cobrança, conforme o gateway. */
  proximaEm: string | null
  /** `ACTIVE`, `INACTIVE`, `EXPIRED`… — o estado real da recorrência. */
  status: string | null
}

export const getCobrancaDoGateway = cache(async (
  asaasSubscriptionId: string | null | undefined,
): Promise<CobrancaDoGateway | null> => {
  const id = assinaturaRealId(asaasSubscriptionId)
  if (!id) return null

  try {
    const sub = await asaas.get<{ value?: number; nextDueDate?: string; status?: string }>(
      `/subscriptions/${id}`,
    )
    if (typeof sub?.value !== "number") return null
    return {
      valorCents: Math.round(sub.value * 100),
      proximaEm:  sub.nextDueDate ?? null,
      status:     sub.status ?? null,
    }
  } catch (e) {
    // Não derruba a tela. O chamador cai na projeção local.
    console.error("[asaas] não consegui ler a assinatura:", id, (e as Error).message)
    return null
  }
})
