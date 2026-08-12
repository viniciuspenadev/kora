import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { getPlatformSettings } from "@/lib/platform-settings"
import { transitionLifecycleCore } from "@/lib/lifecycle-core"
import { TRIAL_ENDED_GRACE_DAYS } from "@/lib/lifecycle-shared"
import { assinaturaRealId } from "@/lib/billing/gateway-limits"

/**
 * Housekeeping diário do trial (chamado pelo cron /api/cron/trial-housekeeping):
 *
 *  1. SUSPENDE trials vencidos — `active=false` + `lifecycle_state=suspended`.
 *     O gate do [auth.ts] (H2) expulsa o tenant suspenso no próximo re-check de
 *     5min e barra o login → o trial "morde" sem precisar de banner.
 *
 *  2. (M2 / LGPD Art. 16) PURGA PII de `signup_verifications` consumidas (conta
 *     já criada) ou expiradas (abandonadas) — minimização de dados.
 */
export async function runTrialHousekeeping(): Promise<{
  suspended: number; purged: number; outboxPurged: number
}> {
  const nowIso = new Date().toISOString()

  // 1. Suspende trials vencidos — via o CORE (server-only, não-action; `system:true`
  //    relaxa a máquina de estados e audita como system:cron). Não passa pela action
  //    pública `transitionLifecycle`, que sempre exige platform admin (crítico C-01).
  const { data: expired, error: expiredErr } = await supabaseAdmin
    .from("tenants")
    .select("id, asaas_subscription_id")
    .eq("lifecycle_state", "trialing")
    .lt("trial_ends_at", nowIso)
  // 🔴 A LISTA VAZIA DIZIA "NENHUM TESTE VENCEU" (F1 da refundação, 11/08). O `error` era
  //    descartado: uma falha aqui devolvia `data: null`, o laço não rodava, e o job fechava
  //    com `suspended: 0` e status **ok**. Como zero trials vencidos é o dia normal, o
  //    número não chama atenção de ninguém — e todo mundo cujo teste acabou naquele dia
  //    segue com o produto inteiro, gastando IA na nossa chave, até alguém reparar.
  // 🔑 O erro é gritado AGORA e relançado no FIM da função, não aqui: os blocos seguintes
  //    (encerrar cobrança do paywall, anular fatura não servida, purgas) são independentes
  //    deste, e abortar já na primeira leitura trocaria uma falha por várias. Lá embaixo o
  //    `throw` faz `executarJob` fechar a corrida como `failed`, que é o que o vigia lê.
  if (expiredErr) {
    console.error(JSON.stringify({ src: "housekeeping", kind: "leitura-de-trials-vencidos-falhou", msg: expiredErr.message }))
  }
  let suspended = 0
  for (const t of expired ?? []) {
    // 🔴 QUEM JÁ TEM ASSINATURA NO GATEWAY NÃO É SUSPENSO AQUI (2026-08-04).
    //    A assinatura é criada durante o trial com `nextDueDate = trial_ends_at`, então o
    //    fim do teste e a primeira cobrança são o MESMO dia. Sem esta guarda, este cron
    //    (8h05) suspenderia o cliente ANTES de o Asaas cobrar — e o resultado seria um
    //    cliente que colocou o cartão, pagou, e amanheceu bloqueado.
    // ⚠️ Quem manda no estado dele daqui pra frente é o webhook: pagamento confirmado
    //    move `trialing → active`; vencido move pra `past_due` (degrau 3). Este cron
    //    continua dono APENAS de quem terminou o teste sem configurar pagamento.
    // ⚠️ Reserva órfã do claim NÃO pode fazer o teste virar vitalício (era o efeito: o
    //    cron pulava o tenant pra sempre e ele seguia gastando IA na nossa chave).
    if (assinaturaRealId((t as { asaas_subscription_id?: string | null }).asaas_subscription_id)) continue

    // 🔴 ENCERRA O TESTE, NÃO SUSPENDE (decisão do dono, 2026-08-05).
    //    Suspender negava o login — e a tela de login não distingue "seu teste acabou" de
    //    "senha errada". A pessoa que queria pagar era tratada igual a quem errou a senha,
    //    sem aviso, sem plano e sem botão. `trial_ended` mantém a porta de pagar aberta
    //    pra owner/admin, corta o gasto, e barra o atendente (que não resolve assinatura).
    //    Quem suspende de verdade é o bloco abaixo, depois da carência.
    const r = await transitionLifecycleCore(t.id as string, "end_trial", { system: true })
    if (!r.error) suspended++
  }

  // 1.a Teste encerrado há mais de TRIAL_ENDED_GRACE_DAYS → aí sim, suspende.
  //
  // 🔑 O relógio é o próprio `trial_ends_at` — sem coluna nova. Ele já guarda o instante
  //    em que o teste venceu, e `end_trial` **não o limpa** justamente pra servir de
  //    carimbo aqui. (Quem paga tem o campo zerado pelo webhook, então some deste filtro.)
  // ⚠️ Sem esta varredura, `trial_ended` seria acesso vitalício a um produto travado.
  // ⚠️ O prazo vem do banco desde 12/08 (`platform_settings.trial_ended_grace_days`); a
  //    constante importada é só o piso de quando a leitura falha. Ver `platform-settings.ts`.
  const { trialEndedGraceDays } = await getPlatformSettings()
  const diasTeste = Number.isFinite(trialEndedGraceDays) && trialEndedGraceDays >= 0
    ? trialEndedGraceDays
    : TRIAL_ENDED_GRACE_DAYS
  const limite = new Date(Date.now() - diasTeste * 86_400_000).toISOString()
  const { data: semPagar, error: spErr } = await supabaseAdmin
    .from("tenants")
    .select("id")
    .eq("lifecycle_state", "trial_ended")
    .lt("trial_ends_at", limite)
    // 🔴 MESMA GUARDA DO BLOCO 1, QUE FALTAVA AQUI (05/08). O bloco acima pula quem tem
    //    assinatura no gateway; este não pulava — e a diferença derrubava exatamente quem
    //    tinha pagado. Cenário medido na auditoria: cliente assina, o webhook se perde (ou
    //    a rota está fora do ar por 1 minuto), ele fica em `trial_ended`, e 48h depois
    //    ESTE bloco o **suspende** — login negado, com o cartão sendo debitado todo mês.
    // ⚠️ A reconciliação abaixo é a outra metade: ela LIBERA quem pagou e ficou pra trás.
    //    Esta guarda garante que, enquanto ela não roda, ninguém é punido por engano.
    .is("asaas_subscription_id", null)
  if (spErr) console.error("[housekeeping] leitura de testes encerrados falhou:", spErr.message)

  for (const t of semPagar ?? []) {
    const r = await transitionLifecycleCore((t as { id: string }).id, "suspend", { system: true })
    if (!r.error) suspended++
  }

  // 1.b Cancelamentos cujo ciclo pago ACABOU → agora sim vira `canceled`.
  //
  // 🔑 Esta é a segunda metade da regra "o acesso continua até o fim do ciclo": o webhook
  //    só CARIMBA `subscription_ends_at` no cancelamento; quem vira o estado é aqui, quando
  //    a data passa. Separar as duas metades é o que impede o cancelamento de retomar
  //    produto já pago — e é o que permite ao cliente voltar atrás antes da data sem que
  //    nada tenha sido cortado.
  // ⚠️ Só mexe em `subscription_status` (dinheiro), nunca no `lifecycle_state` (a relação).
  //    Encerrar cliente continua sendo decisão do god mode — gateway não desliga ninguém.
  // 🔴 `asaas_subscription_id is null` — a guarda que o "retomar assinatura" EXIGE, posta
  //    antes dele existir. `subscription_ends_at` é carimbo histórico e **de propósito nunca
  //    é limpo** (ver o comentário do bloco abaixo). Quem cancela e volta atrás fica com a
  //    data antiga gravada e uma assinatura NOVA no gateway — e sem esta linha, no dia em
  //    que a data velha passasse, este bloco encerraria um cliente **pagante** e apagaria o
  //    cartão dele. Sem assinatura viva no gateway, não há o que este bloco possa quebrar.
  // ⚠️ Medido em prod (11/08) antes de entrar: ZERO tenants com `subscription_ends_at`
  //    carimbado — hoje o filtro não muda nada; ele existe pro amanhã.
  const { data: vencidos, error: vErr } = await supabaseAdmin
    .from("tenants")
    .select("id, subscription_ended_reason")
    .not("subscription_ends_at", "is", null)
    .lt("subscription_ends_at", nowIso)
    .neq("subscription_status", "canceled")
    .is("asaas_subscription_id", null)
  if (vErr) console.error("[housekeeping] leitura de cancelamentos vencidos falhou:", vErr.message)

  let encerrados = 0
  for (const t of vencidos ?? []) {
    const { error } = await supabaseAdmin
      .from("tenants")
      // 🔴 `past_due_since: null` — este era o QUARTO escritor de `subscription_status` e
      //    o único que eu não cobri (M-02 do pentest de 08/08). Sem limpar aqui, um tenant
      //    que estava atrasado e depois é encerrado guarda um carimbo órfão, e a invariante
      //    2 da migration — publicada como "deve voltar vazia para sempre" — passa a
      //    devolver linhas. Quem consultasse concluiria que o carimbo é confiável.
      // 🔴 `subscription_ends_at` NÃO PODE SER LIMPO AQUI (achado do QA, 09/08). Ele é o
      //    ÚNICO carimbo em que `jaEncerrado` se apoia pra impedir que um
      //    `PAYMENT_CONFIRMED` tardio ressuscite a assinatura — e este bloco o apagava
      //    justamente ao encerrar. O tenant voltava a `active` sem assinatura e sem cartão,
      //    fora do alcance de todas as varreduras. A data cumpriu o papel dela e é
      //    histórico: fica.
      // 🔑 `subscription_ended_reason` entra junto: este é o caminho de quem cancelou por
      //    vontade própria, e sem ele a invariante 4 da migration devolve linha no primeiro
      //    cancelamento normal — apagando a distinção que a coluna veio criar.
      // 🔴 …MAS SÓ SE AINDA NÃO HOUVER MOTIVO (11/08). Desde que o god mode passou a AGENDAR
      //    o cancelamento em vez de cortar na hora, ele carimba `decisao_interna` no ato e
      //    quem fecha o estado é este bloco, dias depois — sobrescrever aqui reescreveria a
      //    história como "pedido do cliente" e apagaria o fato de que a Kora cancelou. Numa
      //    disputa é exatamente esta linha que alguém vai ler. Achado ao conferir o CHECK do
      //    vocabulário no banco de produção, não pelo compilador: os dois valores são
      //    válidos, então nada reclamaria.
      // 🔒 AQUI O CARTÃO MORRE — e é aqui que ele sempre deveria ter morrido no cancelamento
      //    a pedido do cliente. A regra "credencial não sobrevive ao seu propósito" continua
      //    valendo; o que mudou (11/08) é QUANDO o propósito acaba: não no clique em
      //    "cancelar", e sim agora, quando o período pago fecha e a relação de fato termina.
      //    Até este instante ele era cliente com acesso, e o cartão era meio de pagamento de
      //    um contrato vivo — o que permite desfazer o cancelamento com um clique.
      // ⚠️ Os três juntos, sempre: rótulo sem credencial mente na tela ("mastercard ••8003"
      //    num cartão que não existe mais), credencial sem assinatura é resíduo.
      // 🔑 Idempotente e inofensivo pros outros caminhos: quem chegou aqui pelo padrão já
      //    veio com os três nulos, e a guarda `asaas_subscription_id is null` garante que
      //    nenhum cliente com assinatura viva cai neste laço.
      .update({
        subscription_status:       "canceled",
        subscription_ended_reason: (t as { subscription_ended_reason?: string | null }).subscription_ended_reason
          ?? "pedido_do_cliente",
        past_due_since:            null,
        asaas_card_token:          null,
        card_brand:                null,
        card_last4:                null,
      })
      .eq("id", (t as { id: string }).id)
    if (error) console.error("[housekeeping] falha ao encerrar assinatura:", (t as { id: string }).id, error.message)
    // 🔑 SIMÉTRICO AO BLOCO 4 (achado do QA, 09/08): quem cancela com fatura aberta ficava
    //    `canceled` — logo, no paywall, logo, sem gerar mais nada — **com uma cobrança de
    //    um período que nunca será entregue**, para sempre. A regra do dono vale igual nos
    //    dois caminhos: em pré-pago, período não servido não gera cobrança.
    else {
      const { error: anErr } = await supabaseAdmin.from("invoices")
        .update({ status: "void", void_reason: "nao_servido", updated_at: new Date().toISOString() })
        .eq("tenant_id", (t as { id: string }).id)
        .in("status", ["open", "overdue", "partial"])
      if (anErr) console.error("[housekeeping] faturas não anuladas no cancelamento:", (t as { id: string }).id, anErr.message)
      encerrados++
    }
  }
  if (encerrados > 0) console.log(JSON.stringify({ src: "housekeeping", kind: "assinaturas-encerradas", n: encerrados }))

  // ── 1.c · RETENÇÃO DO LIVRO DE EXECUÇÕES ────────────────────────────────
  // 🔴 O DESIGN PROMETIA ISTO E NÃO EXISTIA (revisão 11/08). O §13.5 dizia "retenção é
  //    declaração… é purgada pelo housekeeping" — e não havia purga nenhuma. São ~3.100
  //    linhas/dia (os dois jobs de cadência de 1 minuto sozinhos fazem 2.880), ou seja
  //    ~1,1 milhão por ano, guardadas para sempre, com texto de erro de terceiro dentro.
  //    Declarar retenção e não implementar é pior que não declarar: alguém lê a política
  //    e para de se preocupar.
  // ⚠️ 90 dias é o que responde "o que houve no fechamento do mês passado" — a pergunta
  //    que se faz quando uma fatura sai errada. Menos que isso não cobre um ciclo.
  {
    const corte = new Date(Date.now() - 90 * 86_400_000).toISOString()
    const { error } = await supabaseAdmin.from("cron_runs").delete().lt("started_at", corte)
    if (error) console.error("[housekeeping] purga do livro de execuções falhou:", error.message)
  }

  // 2. Purga PII: consumidas + expiradas (sequencial pra não dupla-contar a corrida).
  const { data: consumed } = await supabaseAdmin
    .from("signup_verifications").delete().not("consumed_at", "is", null).select("id")
  const { data: stale } = await supabaseAdmin
    .from("signup_verifications").delete().lt("expires_at", nowIso).select("id")
  const purged = (consumed?.length ?? 0) + (stale?.length ?? 0)

  // 3. Retenção do email_outbox (LGPD/minimização) — apaga registros de envio
  //    com mais de 90 dias (mantém o histórico recente pro /admin/emails/log).
  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString()
  const { data: oldMail } = await supabaseAdmin
    .from("email_outbox").delete().lt("created_at", cutoff).select("id")
  const outboxPurged = oldMail?.length ?? 0

  // ── 4 · REMOVIDO: a máquina não encerra mais relação comercial ────────────
  //
  // 🔴 AQUI MORAVA O ENCERRAMENTO AUTOMÁTICO POR FALTA DE PAGAMENTO, retirado em 12/08 por
  //    decisão do dono. Ele cancelava a assinatura no gateway, anulava a fatura em aberto e
  //    marcava `canceled` assim que a carência passava — no MESMO relógio do paywall, ou
  //    seja, os dois efeitos caíam juntos.
  //
  // 🔑 A REGRA NOVA, e ela é de produto, não de código: **o automático termina no paywall.**
  //    Fechar o acesso é reversível — o cliente paga e volta no mesmo segundo. Encerrar a
  //    cobrança não é: cancela no gateway, apaga o cartão, e voltar significa recontratar do
  //    zero. Decisão irreversível sobre uma relação comercial passa a exigir gente:
  //      • o CLIENTE, cancelando (`cancelarAssinatura`, com o ciclo pago respeitado); ou
  //      • o OPERADOR, suspendendo/desativando no god mode — que já cancela a assinatura
  //        junto, na cascata de `transitionLifecycleCore`.
  //
  // ⚠️ A CONSEQUÊNCIA QUE ISTO CRIA, e está registrada de propósito: sem esta varredura, a
  //    assinatura de quem está no paywall **continua viva no Asaas**. Se o cartão voltar a
  //    funcionar meses depois, o gateway cobra — e o cliente que se considerava fora pode
  //    ser debitado por um produto que não usa, virando contestação. O antídoto não é
  //    ressuscitar a automação: é o operador CONSEGUIR VER quem está preso no paywall.
  //    É por isso que a lista de paywall no god mode deixou de ser conforto e virou
  //    requisito — sem ela, "só o humano encerra" vira "ninguém encerra".
  //
  // ⚠️ O void da fatura não servida foi junto e ganhou dono novo: o caminho de SUSPENSÃO
  //    (`lifecycle-core`), que é onde a relação de fato acaba. Sem isso a regra do pré-pago
  //    ("período não servido não gera cobrança") ficaria sem executor nenhum.

  // 🔴 O RESTO DO DIA FOI FEITO, MAS A RODADA NÃO PODE SER CHAMADA DE SUCESSO (F1, 11/08).
  //    Ver o bloco 1: sem isto, "não consegui ler os testes vencidos" ficava indistinguível
  //    de "nenhum venceu hoje" para quem lê o livro de execuções.
  // ⚠️ No fim, de propósito: tudo o que não dependia dessa leitura já rodou.
  if (expiredErr) throw new Error(`leitura de trials vencidos falhou: ${expiredErr.message}`)

  return { suspended, purged, outboxPurged }
}
