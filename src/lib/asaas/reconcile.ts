import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { asaas } from "./client"
import { RESERVA_TTL_MS, idadeDaReservaMs } from "@/lib/billing/gateway-limits"
import { processAsaasEvent } from "./webhook-handler"
import { procurarAssinaturaNoGateway } from "./subscriptions"

// ═══════════════════════════════════════════════════════════════
// Reconciliação — o webhook deixa de ser ponto único de falha
// ═══════════════════════════════════════════════════════════════
//
// 🔴 POR QUE EXISTE (auditoria 05/08/2026). O produto inteiro dependia de UMA entrega
//    HTTP dar certo: só o webhook `PAYMENT_CONFIRMED` tirava alguém de `trial_ended`.
//    Se o evento se perdesse — deploy no segundo errado, restart, 502 momentâneo, fila
//    interrompida pelo Asaas após falhas seguidas — o cliente ficava travado **com o
//    cartão sendo debitado todo mês**, e ninguém no sistema notava.
//
//    Pior: a rota do webhook grava o evento ANTES de processar e o cabeçalho dela afirma
//    *"quem re-tenta somos nós, a partir da fila persistida"* — só que esse re-tentador
//    **não existia**. Evento gravado e não processado ficava parado para sempre.
//
// 🔑 Duas varreduras baratas, ambas idempotentes:
//      1. eventos PENDENTES (guardados e não processados) → reprocessa;
//      2. tenants TRAVADOS com assinatura no gateway → pergunta ao Asaas e libera.
//    A (2) é a rede de verdade: mesmo que o evento nunca tenha chegado, o dinheiro
//    confirmado no gateway destrava o cliente no ciclo seguinte do cron.

/** Idade mínima pra reprocessar — evita competir com o `after()` da própria requisição. */
const IDADE_MINIMA_MS = 10 * 60_000

export interface ReconcileResult {
  reprocessados:  number
  liberados:      number
  erros:          number
  /** Reservas de claim abandonadas por crash/deploy que foram devolvidas. */
  reservasLimpas: number
}

export async function reconcileAsaas(): Promise<ReconcileResult> {
  const out: ReconcileResult = { reprocessados: 0, liberados: 0, erros: 0, reservasLimpas: 0 }

  // ── 0 · Faxina de reservas órfãs do claim atômico ────────────────────────
  // 🔴 SEM ISTO O CLIENTE FICA MURADO PRA SEMPRE (achado dos dois revisores, 06/08).
  //    `soltarReserva()` só roda em saídas EM PROCESSO. Crash, deploy, restart do
  //    container ou timeout do Server Action entre o claim e a resposta do gateway
  //    deixavam `pending:<uuid>` gravado — e a partir daí a pessoa não conseguia pagar,
  //    o cron de trial a pulava (teste vitalício gastando na nossa chave) e nenhuma
  //    rotina limpava. Bastava um deploy no segundo errado.
  // ⚠️ TTL curto: a janela real são duas chamadas HTTP ao gateway. Se passou de
  //    `RESERVA_TTL_MS`, ninguém está mais no meio da ativação.
  // ⚠️ A IDADE VEM DO TOKEN, não de `tenants.updated_at` — aquela coluna não é mantida
  //    (sem trigger; verificado em produção), então filtrar por ela apagava reserva de 3
  //    segundos e desarmava o claim atômico. Ver `novaReservaDeClaim`.
  const { data: orfas } = await supabaseAdmin
    .from("tenants")
    .select("id, asaas_subscription_id")
    .like("asaas_subscription_id", "pending:%")
    .order("id")
    .limit(100)

  for (const t of (orfas ?? []) as { id: string; asaas_subscription_id: string }[]) {
    const idade = idadeDaReservaMs(t.asaas_subscription_id)
    // `null` = formato legado sem timestamp ⇒ não mexe (fail-safe: reserva presa é
    // reparável à mão; apagar a de quem está pagando agora cria cobrança em dobro).
    if (idade === null || idade < RESERVA_TTL_MS) continue

    // 🔴 CORROBORA ANTES DE LIMPAR (achado da auditoria, 07/08). A faxina apagava a reserva
    //    no escuro — e a reserva órfã nasce justamente do timeout, o caso em que a
    //    assinatura PODE ter sido criada e o cartão cobrado. Limpar sem perguntar devolvia
    //    a vaga e deixava a próxima tentativa criar a segunda assinatura mensal, com a
    //    primeira cobrando pra sempre sem ninguém saber.
    const existente = await procurarAssinaturaNoGateway(t.id)

    // Existe: adota em vez de apagar. É o mesmo tenant, é o `externalReference` dele.
    if (existente) {
      const { error } = await supabaseAdmin
        .from("tenants")
        .update({ asaas_subscription_id: existente })
        .eq("id", t.id)
        .eq("asaas_subscription_id", t.asaas_subscription_id)
      if (error) { out.erros++; continue }
      out.reservasLimpas++
      console.error(JSON.stringify({ src: "reconcile", kind: "reserva-virou-assinatura",
        tenant: t.id, subscription: existente }))
      continue
    }
    // ⚠️ `undefined` = o gateway não respondeu. Não sabemos ⇒ não mexe: a reserva presa é
    //    reparável na próxima rodada; a cobrança em dobro, não.
    if (existente === undefined) { out.erros++; continue }

    const { error } = await supabaseAdmin
      .from("tenants")
      .update({ asaas_subscription_id: null })
      .eq("id", t.id)
      .eq("asaas_subscription_id", t.asaas_subscription_id)   // não pisa numa ativação nova
    if (error) { out.erros++; continue }
    out.reservasLimpas++
    console.log(JSON.stringify({ src: "reconcile", kind: "reserva-orfa-limpa", tenant: t.id }))
  }

  // ── 1 · Eventos que ficaram pendentes ────────────────────────────────────
  const corte = new Date(Date.now() - IDADE_MINIMA_MS).toISOString()
  const { data: pendentes, error: pErr } = await supabaseAdmin
    .from("asaas_webhook_events")
    .select("id")
    .is("processed_at", null)
    .lt("received_at", corte)
    // ⚠️ `limit` sem `order` não garante QUAIS linhas voltam: com fila acima do teto, a
    //    cauda podia nunca ser alcançada — presos em silêncio. Mais antigo primeiro.
    .order("received_at", { ascending: true })
    .limit(200)

  if (pErr) {
    console.error("[reconcile] leitura de eventos pendentes falhou:", pErr.message)
    out.erros++
  }

  for (const e of (pendentes ?? []) as { id: string }[]) {
    try {
      await processAsaasEvent(e.id)
      out.reprocessados++
    } catch (err) {
      out.erros++
      console.error("[reconcile] reprocessamento falhou:", e.id, (err as Error).message)
    }
  }

  // ── 2 · Quem pagou e continua travado ────────────────────────────────────
  // ⚠️ Só quem TEM assinatura no gateway: sem ela não há o que reconciliar, e varrer todo
  //    `trial_ended` seria pedir ao Asaas por gente que nunca contratou.
  // 🔴 `past_due` ENTROU AQUI (06/08). O filtro só olhava `trial_ended` — ou seja, cobria
  //    a transição "testou → pagou" e deixava de fora **quem já é cliente**: um tenant que
  //    caiu em `past_due` (campanhas, IA e automações cortadas) e depois PAGOU só voltava
  //    se o webhook chegasse. Perdida a entrega, ele ficava mutilado indefinidamente e
  //    nenhuma varredura olhava pra ele. Era metade do problema declarado como resolvido.
  const { data: travados, error: tErr } = await supabaseAdmin
    .from("tenants")
    .select("id, asaas_subscription_id, asaas_customer_id")
    .or("lifecycle_state.eq.trial_ended,subscription_status.eq.past_due")
    .eq("billing_mode", "gateway")
    .not("asaas_subscription_id", "is", null)
    .order("id")
    .limit(200)

  if (tErr) {
    console.error("[reconcile] leitura de tenants travados falhou:", tErr.message)
    out.erros++
  }

  for (const t of (travados ?? []) as { id: string; asaas_subscription_id: string; asaas_customer_id: string | null }[]) {
    // A reserva do claim atômico não é assinatura — pular.
    if (t.asaas_subscription_id.startsWith("pending:")) continue
    // Sem customer não há como o handler achar o tenant (ver o payload abaixo).
    if (!t.asaas_customer_id) continue

    try {
      // ⚠️ FILTRO DE DATA (06/08): sem ele a consulta podia devolver uma cobrança de meses
      //    atrás e o cron REVERTERIA uma decisão do operador — god mode encerra o teste de
      //    propósito num cliente que já pagou algum ciclo, e a madrugada seguinte
      //    destravava tudo sozinha.
      const desde = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10)
      const pagos = await asaas.get<{ data?: { id: string; status?: string }[] }>(
        `/payments?subscription=${encodeURIComponent(t.asaas_subscription_id)}` +
        `&status=CONFIRMED&confirmedDate[ge]=${desde}&limit=1`,
      )
      const pago = pagos?.data?.[0]
      if (!pago) continue

      // 🔴 DEDUP POR `payment_id`, NÃO PELA PK (06/08). O comentário anterior afirmava que
      //    a PK protegia contra o webhook chegar depois — **falso**: a PK do webhook é
      //    `evt_…` e a daqui era `reconcile_…`, chaves DIFERENTES, então os dois entravam e
      //    `liberar` rodava duas vezes pro mesmo pagamento. Hoje o dano é contido por sorte
      //    (baixa de fatura e `applyPlan` são idempotentes); qualquer efeito futuro não
      //    idempotente em `liberar` dispararia dobrado.
      const { data: jaVisto } = await supabaseAdmin
        .from("asaas_webhook_events").select("id").eq("payment_id", pago.id).limit(1)
      if (jaVisto && jaVisto.length > 0) continue

      // 🔑 Não duplica regra: injeta o evento na MESMA fila que o webhook usa e deixa o
      //    `processAsaasEvent` decidir. Ele corrobora no gateway, aplica o plano e é
      //    idempotente pela PK — se o webhook chegar depois, o segundo INSERT falha com
      //    23505 e nada acontece duas vezes.
      const { error: insErr } = await supabaseAdmin.from("asaas_webhook_events").insert({
        id:         `reconcile_${pago.id}`,
        event_type: "PAYMENT_CONFIRMED",
        payment_id: pago.id,
        // 🔴 O `customer` É OBRIGATÓRIO no payload — é por ele que o handler encontra o
        //    tenant (filtro de tenancy). Injetar `null` faria o evento ser fechado como
        //    "sem customer no payload" e a reconciliação viraria um no-op silencioso:
        //    rodaria todo dia, contaria sucesso, e não liberaria ninguém.
        payload:    { payment: { id: pago.id, customer: t.asaas_customer_id, status: pago.status } },
        tenant_id:  t.id,
      })
      // 23505 = já existe (o webhook chegou primeiro). Caminho normal, não erro.
      if (insErr && insErr.code !== "23505") { out.erros++; continue }
      if (insErr) continue

      await processAsaasEvent(`reconcile_${pago.id}`)
      out.liberados++
      console.log(JSON.stringify({
        src: "reconcile", kind: "liberado-por-reconciliacao", tenant: t.id, payment: pago.id,
      }))
    } catch (err) {
      out.erros++
      console.error("[reconcile] consulta ao gateway falhou:", t.id, (err as Error).message)
    }
  }

  return out
}
