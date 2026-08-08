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

  // 🔴 JANELA DE RETENTATIVA — a dead-letter do pobre (08/08). Desde que falha transitória
  //    passou a DEIXAR o evento pendente (`fechar(..., false)`), esta varredura ganhou um
  //    risco novo: um evento que nunca vai resolver sozinho (pagamento menor que a fatura,
  //    por exemplo) seria reprocessado a cada rodada, PARA SEMPRE — e pior, ocuparia vaga
  //    no teto de 200, empurrando os eventos novos pra fora da fila. A rede de segurança
  //    viraria a própria fonte de fome.
  // 🔑 Passados 7 dias, o evento para de ser tentado e fica parado com o `error` gravado —
  //    que é exatamente o que uma dead-letter é: continua consultável, para de custar.
  const limiteRetentativa = new Date(Date.now() - 7 * 86_400_000).toISOString()

  const { data: pendentes, error: pErr } = await supabaseAdmin
    .from("asaas_webhook_events")
    .select("id")
    .is("processed_at", null)
    .lt("received_at", corte)
    .gt("received_at", limiteRetentativa)
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
  //
  // 🔴 `trialing` ENTROU AGORA (08/08) — o terço que faltava, que nem o pentest viu. Quem
  //    assina DURANTE o teste e perde o webhook não era alcançado por ninguém: este filtro
  //    exigia `trial_ended`/`past_due`, e o `trial-housekeeping` **pula** quem tem
  //    assinatura no gateway (pra não suspender quem acabou de pagar). Resultado: o tenant
  //    ficava `trialing` com a data vencida, **com os módulos do Trial**, sendo debitado
  //    todo mês — o dano exato que esta varredura existe pra impedir, entrando pela porta
  //    que o filtro deixou aberta.
  // ⚠️ O `.not("asaas_subscription_id","is",null)` logo abaixo é o que mantém isso barato:
  //    só entram tenants em teste que JÁ contrataram, não a base inteira de trials.
  // ⚠️ E o ramo `trialing` exige **teste JÁ VENCIDO** (`trial_ends_at.lt.agora`). Sem esse
  //    recorte, um tenant cujo cartão foi recusado ficaria `trialing` com assinatura
  //    gravada indefinidamente (o housekeeping pula quem tem assinatura) e passaria a ser
  //    consultado no gateway 96×/dia, para sempre. Com ele, a população é finita e é
  //    exatamente a que interessa: quem deveria ter virado cliente e não virou.
  const agoraIso = new Date().toISOString()
  const { data: travados, error: tErr } = await supabaseAdmin
    .from("tenants")
    .select("id, asaas_subscription_id, asaas_customer_id")
    .or(`lifecycle_state.eq.trial_ended,subscription_status.eq.past_due,and(lifecycle_state.eq.trialing,trial_ends_at.lt.${agoraIso})`)
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
      // `value` é lido pra viajar no payload injetado — sem ele o handler pula o piso de
      // aceite (ver o comentário no `payload` abaixo).
      const pagos = await asaas.get<{ data?: { id: string; status?: string; value?: number }[] }>(
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
      // 🔴 SÓ PULA SE UM EVENTO **LIBERADOR** JÁ RODOU COM SUCESSO (P0-4 + revalidação 08/08).
      //
      //    O filtro original era `payment_id` puro, e desligava a varredura em dois casos:
      //      1. evento que FALHOU (banco oscilou, `applyPlan` não aplicou) contava como
      //         visto — cliente pagava, não recebia os módulos, e nenhuma rotina voltava lá;
      //      2. pior e mais comum: o Asaas manda `PAYMENT_CREATED` **antes** do
      //         `PAYMENT_CONFIRMED`, com o MESMO `payment.id`. `CREATED` é silencioso e
      //         fecha limpo (sem `error`) — então bastava ele ter chegado pra esta
      //         varredura pular o tenant. Se o `CONFIRMED` se perdesse, o cliente pagava e
      //         **nunca era liberado**. A rede de segurança era inerte pra praticamente
      //         todo pagamento real, porque `CREATED` sempre chega.
      //
      // 🔑 A régua é o TIPO: só conta como visto um evento que de fato libera, processado e
      //    sem nota de erro. Corrigir só o `error is null` teria fechado o sintoma menor e
      //    deixado o dominante de pé.
      const { data: jaVisto } = await supabaseAdmin
        .from("asaas_webhook_events").select("id")
        .eq("payment_id", pago.id)
        .in("event_type", ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"])
        .not("processed_at", "is", null)
        .is("error", null)
        .limit(1)
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
        // ⚠️ `value` VAI JUNTO. Sem ele o handler lê `pago = null` e **pula o piso de
        //    aceite** (o "pagou menos que o plano ⇒ não quita"): a mesma quantia era
        //    barrada pela porta do webhook e aceita pela porta do reconcile. Validação que
        //    depende de por onde o evento entrou não é validação.
        payload:    { payment: { id: pago.id, customer: t.asaas_customer_id, status: pago.status, value: pago.value } },
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
