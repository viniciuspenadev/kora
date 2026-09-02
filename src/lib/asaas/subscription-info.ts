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
  /**
   * `YYYY-MM-DD` de quando o cartão vai ser DEBITADO — o vencimento da cobrança pendente
   * mais próxima. ⚠️ **Não** é o `nextDueDate` da assinatura: aquele é o próximo ciclo a
   * ser gerado, e fica um mês à frente assim que a cobrança do mês corrente existe.
   */
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

    // ══════════════════════════════════════════════════════════════════════
    // 🔴 `nextDueDate` NÃO É "QUANDO VEM A PRÓXIMA COBRANÇA" (achado do dono, 09/08)
    // ══════════════════════════════════════════════════════════════════════
    // Ele é *"o próximo ciclo que a assinatura ainda vai GERAR"*. Assim que o Asaas cria a
    // cobrança de um mês, esse campo já pula para o mês seguinte — então usá-lo deixa a
    // tela **sempre um ciclo à frente**.
    //
    // Medido ao vivo: assinatura criada em 08/08, cobrança de 08/08 confirmada, cobrança de
    // **08/09 PENDENTE no gateway**, e `nextDueDate` marcando 08/10. A faixa do topo dizia
    // *"sua próxima fatura fecha em 8 de outubro"* enquanto os cards da mesma página diziam
    // 8 de setembro — o dono viu as duas juntas.
    //
    // 🔑 A pergunta que o cliente faz é "quando vou ser cobrado?". Quem responde isso é o
    //    **vencimento da cobrança pendente mais próxima**, não o calendário de geração.
    // ⚠️ Sem pendente (o ciclo ainda não foi gerado), o `nextDueDate` volta a ser a melhor
    //    resposta disponível — aí ele significa exatamente o que a tela quer dizer.
    let proximaEm = sub.nextDueDate ?? null
    try {
      const pend = await asaas.get<{ data?: Array<{ dueDate?: string }> }>(
        `/payments?subscription=${encodeURIComponent(id)}&status=PENDING&limit=10`,
      )
      const datas = (pend?.data ?? []).map((p) => p.dueDate).filter(Boolean).sort() as string[]
      if (datas.length > 0) proximaEm = datas[0]
    } catch {
      // Falhou a consulta das cobranças: fica o `nextDueDate`. Impreciso em um ciclo é
      // melhor que a tela não dizer nada — e o erro cai pro lado de anunciar MAIS tarde.
    }

    return {
      valorCents: Math.round(sub.value * 100),
      proximaEm,
      status:     sub.status ?? null,
    }
  } catch (e) {
    // Não derruba a tela. O chamador cai na projeção local.
    console.error("[asaas] não consegui ler a assinatura:", id, (e as Error).message)
    return null
  }
})
