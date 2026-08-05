import "server-only"
import { getAssinaturaView } from "@/lib/billing/subscription-view"
import { listInvoicesForTenant, getInvoiceForTenant } from "@/lib/billing/invoices-view"
import type { AssinaturaMock } from "./mock"
import type { Fatura } from "./types"

// ═══════════════════════════════════════════════════════════════
// DADO REAL das telas de assinatura — substitui `buildMock()`
// ═══════════════════════════════════════════════════════════════
// Monta o MESMO shape que o mock produzia, para as telas não mudarem. O mock continua
// existindo de propósito: é o modo PRÉVIA (`?degrau=`), que permite revisar os 5 estados
// da escada sem precisar de um cliente inadimplente de verdade.
//
// ⚠️ O que este arquivo NÃO faz, e é decisão: não inventa número. Onde o dado real não
//    existe (forma de pagamento, adiamento, Pix), ele devolve vazio e a tela trata —
//    em vez de preencher com algo plausível. Numa tela de dinheiro, plausível é mentira.

/** Monta a visão real de um tenant no shape que as 4 telas consomem. */
export async function loadAssinatura(tenantId: string): Promise<AssinaturaMock> {
  const [view, faturas] = await Promise.all([
    getAssinaturaView(tenantId),
    listInvoicesForTenant(tenantId),
  ])

  // A lista do histórico é resumo; o detalhe (linhas) só é carregado ao abrir uma fatura.
  // Carregar item de todas as faturas pra listar 24 linhas seria pagar caro por nada.
  const comoFatura = (f: (typeof faturas)[number]): Fatura => ({
    id:            f.id,
    referencia:    f.referencia,
    periodoInicio: "",
    periodoFim:    "",
    vencimento:    f.vencimento,
    status:        f.status,
    totalCents:    f.totalCents,
    linhas:        [],
    pixCopiaECola: "",
    pagoEm:        f.pagoEm,
  })

  // "Fatura em aberto" = a que o standing já apontou como a mais antiga não paga.
  // Reusar o standing evita uma segunda regra de "qual fatura importa" — que divergiria.
  const abertaId = view.standing.invoice?.id ?? null
  const faturaAberta = abertaId ? (faturas.find((f) => f.id === abertaId) ?? null) : null

  return {
    standing:  view.standing,
    resumo:    view.resumo,
    conta:     view.conta,
    medidas:   view.medidas,
    discretas: view.discretas,
    faturaAberta: faturaAberta ? comoFatura(faturaAberta) : null,
    faturas:      faturas.map(comoFatura),
  }
}

/** Detalhe de UMA fatura. `null` quando não é do tenant — ver invoices-view. */
export async function loadFatura(tenantId: string, invoiceId: string): Promise<Fatura | null> {
  const f = await getInvoiceForTenant(tenantId, invoiceId)
  if (!f) return null
  return {
    id:            f.id,
    referencia:    f.referencia,
    periodoInicio: f.periodoInicio,
    periodoFim:    f.periodoFim,
    vencimento:    f.vencimento,
    status:        f.status,
    totalCents:    f.totalCents,
    linhas:        f.linhas,
    pixCopiaECola: f.pixCopiaECola,
    pagoEm:        f.pagoEm,
    formaPagamento: f.formaPagamento,
  }
}
