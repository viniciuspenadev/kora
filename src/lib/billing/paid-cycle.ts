import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

// ═══════════════════════════════════════════════════════════════
// Até quando o cliente já pagou
// ═══════════════════════════════════════════════════════════════
//
// 🔑 UMA PERGUNTA, UM LUGAR. Três caminhos de cancelamento precisavam da mesma resposta e
//    cada um a consultava por conta própria: o webhook (`calcularFimDoCiclo`), o pedido do
//    cliente (`cancelarAssinatura`) e o god mode. Consulta duplicada em três lugares é
//    convite pra divergirem — e o que diverge aqui é **até que dia o cliente tem acesso ao
//    que pagou**. Foi assim que o filtro `kind='recorrente'` (§9.5) precisou ser aplicado
//    três vezes em 11/08, uma de cada vez, ao ser descoberto.
//
// ⚠️ A POLÍTICA NÃO MORA AQUI, de propósito. Esta função só MEDE; o que fazer com cada
//    resposta é decisão de quem chama, e as três divergem legitimamente:
//      • webhook   — `undefined` adia o evento (lança); `null` tenta o gateway e depois corta
//      • cliente   — `undefined` e `null` viram erro: nunca cortar dias de quem pediu pra sair
//      • god mode  — `undefined` aborta; `null` encerra na hora (não há ciclo a respeitar)
//    Colapsar isso numa política única aqui dentro tiraria de cada chamador a única decisão
//    que ele precisa tomar.

/**
 * Fim do período já pago deste tenant, como instante ISO.
 *
 * - `string`    — há ciclo pago; o acesso vale até aí.
 * - `null`      — perguntei, **não há** nenhuma mensalidade paga.
 * - `undefined` — a consulta FALHOU. Não é "não há".
 *
 * 🔴 OS TRÊS ESTADOS EXISTEM PORQUE COLAPSAR DOIS CORTA O ACESSO DE QUEM PAGOU (F1, 11/08).
 *    Com o `error` engolido, um blip de segundos no banco virava "não há ciclo pago" — e o
 *    fail-closed de quem chama encerrava na hora um cliente em dia.
 *
 * 🔑 `kind = 'recorrente'` (§9.5 do livro-caixa): a pergunta é sobre o CICLO. Uma cobrança
 *    avulsa carrega `period_start = period_end = dia da cobrança` — um período de UM dia —
 *    e sem o filtro ela seria "a última paga", encerrando o acesso HOJE de quem tem a
 *    mensalidade em dia até o fim do mês.
 */
export async function fimDoCicloPago(tenantId: string): Promise<string | null | undefined> {
  const { data, error } = await supabaseAdmin
    .from("invoices")
    .select("period_end")
    .eq("tenant_id", tenantId)
    .eq("status", "paid")
    .eq("kind", "recorrente")
    .order("period_end", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error(JSON.stringify({
      src: "paid-cycle", kind: "fim-de-ciclo-indisponivel", tenant: tenantId, msg: error.message,
    }))
    return undefined
  }

  const periodEnd = (data as { period_end?: string } | null)?.period_end
  // ⚠️ `T23:59:59Z` e não `T00:00:00Z`: `period_end` é o último dia INCLUSIVE. Cortar à
  //    meia-noite tiraria do cliente o dia inteiro que ele comprou.
  return periodEnd ? new Date(`${periodEnd}T23:59:59Z`).toISOString() : null
}
