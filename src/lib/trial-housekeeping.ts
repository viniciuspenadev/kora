import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { transitionLifecycleCore } from "@/lib/lifecycle-core"
import { TRIAL_ENDED_GRACE_DAYS, passouDaCarencia } from "@/lib/lifecycle-shared"
import { assinaturaRealId } from "@/lib/billing/gateway-limits"
import { cancelSubscriptionForTenant } from "@/lib/asaas/subscriptions"

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
  /** Quantos passaram da carência e tiveram a cobrança encerrada (pré-pago). */
  encerradosPorFalta: number
}> {
  const nowIso = new Date().toISOString()

  // 1. Suspende trials vencidos — via o CORE (server-only, não-action; `system:true`
  //    relaxa a máquina de estados e audita como system:cron). Não passa pela action
  //    pública `transitionLifecycle`, que sempre exige platform admin (crítico C-01).
  const { data: expired } = await supabaseAdmin
    .from("tenants")
    .select("id, asaas_subscription_id")
    .eq("lifecycle_state", "trialing")
    .lt("trial_ends_at", nowIso)
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
  const limite = new Date(Date.now() - TRIAL_ENDED_GRACE_DAYS * 86_400_000).toISOString()
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
  const { data: vencidos, error: vErr } = await supabaseAdmin
    .from("tenants")
    .select("id")
    .not("subscription_ends_at", "is", null)
    .lt("subscription_ends_at", nowIso)
    .neq("subscription_status", "canceled")
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
      .update({
        subscription_status:       "canceled",
        subscription_ended_reason: "pedido_do_cliente",
        past_due_since:            null,
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

  // ── 4 · PRÉ-PAGO: passou da carência ⇒ a relação de cobrança ENCERRA ──────
  //
  // 🔴 O PROBLEMA QUE ISTO FECHA (achado do dono, 08/08): quem entrava no paywall
  //    continuava com a assinatura viva no Asaas **e** ganhando fatura nova todo mês. Três
  //    meses parado = três faturas de um período que ele não usou, mais uma recorrência
  //    que ninguém pediu. Dívida acumulando dos dois lados, para alguém que não está
  //    recebendo nada. A regra do produto é pagamento **antecipado**: pendência não pode
  //    sequer existir.
  //
  // 🔑 O PAYWALL É UM ESTADO DERIVADO, não um evento — ninguém "entra" nele, ele é
  //    calculado na leitura. Por isso o desligamento precisa de varredura: é aqui que o
  //    relógio vira consequência.
  //
  // 🔑 E `canceled` passa a ser o terminal ÚNICO do paywall — tenha ele cancelado ou
  //    simplesmente parado de pagar. O que distingue os dois é `subscription_ended_reason`,
  //    porque colapsar "ele saiu" e "ele não pagou" apagaria a informação mais valiosa que
  //    a saída de um cliente produz.
  //
  // ⚠️ NÃO mexe em `lifecycle_state`. Encerrar a relação segue sendo decisão humana
  //    (degraus 4 e 5). Isto encerra a COBRANÇA, que é outra alavanca.
  let encerradosPorFalta = 0
  const { data: atrasados, error: atrErr } = await supabaseAdmin
    .from("tenants")
    .select("id, past_due_since, past_due_grace_days, asaas_subscription_id")
    .eq("subscription_status", "past_due")
    .eq("billing_mode", "gateway")
  if (atrErr) console.error("[housekeeping] leitura de atrasados falhou:", atrErr.message)

  for (const row of (atrasados ?? []) as Array<{
    id: string; past_due_since: string | null; past_due_grace_days: number | null
    asaas_subscription_id: string | null
  }>) {
    // ⚠️ O filtro fino é em TS porque a carência é POR TENANT — não dá pra expressar
    //    `now - past_due_since >= past_due_grace_days` num filtro do PostgREST. São poucas
    //    linhas (só quem está atrasado) e existe índice parcial em `past_due_since`.
    if (!passouDaCarencia(row.past_due_since, row.past_due_grace_days)) continue

    // 1º desliga a cobrança. Se falhar, NÃO marca `canceled` — senão o cliente fica
    // "encerrado" no nosso livro e debitado no cartão, que é o pior estado possível.
    // ⚠️ A varredura de cobrança órfã do `reconcile` é a segunda rede, para o caso de
    //    isto falhar depois de a marcação já ter acontecido numa rodada anterior.
    if (assinaturaRealId(row.asaas_subscription_id)) {
      const c = await cancelSubscriptionForTenant(row.id)
      if ("error" in c) {
        console.error(JSON.stringify({ src: "housekeeping", kind: "PAYWALL-NAO-DESLIGOU-COBRANCA",
          tenant: row.id }))
        continue
      }
    }

    const { error: upErr } = await supabaseAdmin.from("tenants")
      .update({
        subscription_status:       "canceled",
        subscription_ended_reason: "falta_de_pagamento",
        // O relógio do atraso cumpriu o papel dele; deixá-lo aqui viraria carimbo órfão.
        past_due_since:            null,
        // 🔴 SEM ESTE CARIMBO O ENCERRAMENTO É REVERSÍVEL POR ACIDENTE (achado do QA,
        //    09/08). A guarda que impede um evento antigo de ressuscitar a assinatura é
        //    `jaEncerrado = !!subscription_ends_at && !nossa` (webhook-handler): ela EXIGE
        //    a data. Sem ela, um `PAYMENT_CONFIRMED` pendente — e o reconcile retenta por
        //    **7 dias, exatamente o tamanho da carência padrão** — reescrevia
        //    `subscription_status: "active"` num tenant sem assinatura e sem cartão.
        //    Ninguém mais olharia pra ele: não está em `past_due`, não tem `ends_at`, não
        //    está `suspended`. Produto inteiro, de graça, para sempre.
        // ⚠️ `now` e não uma data futura: ele NÃO pagou este período. O acesso acaba agora.
        subscription_ends_at:      new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("subscription_status", "past_due")   // guarda de concorrência
    if (upErr) { console.error("[housekeeping] falha ao encerrar por falta de pagamento:", row.id, upErr.message); continue }

    // 🔑 A FATURA ABERTA NÃO É DÍVIDA — É UMA OFERTA QUE EXPIROU. Ela cobre o período
    //    **à frente** (`currentPeriod` começa hoje), e esse período não vai ser entregue.
    //    Mantê-la aberta sujaria o livro para sempre com um valor que não se pretende
    //    cobrar; anular sem dizer por quê apagaria a diferença entre isso e um erro nosso.
    const { error: vErr } = await supabaseAdmin.from("invoices")
      .update({ status: "void", void_reason: "nao_servido", updated_at: new Date().toISOString() })
      .eq("tenant_id", row.id)
      .in("status", ["open", "overdue", "partial"])
    if (vErr) console.error("[housekeeping] faturas não anuladas:", row.id, vErr.message)

    encerradosPorFalta++
    console.warn(JSON.stringify({ src: "housekeeping", kind: "cobranca-encerrada-por-falta-de-pagamento",
      tenant: row.id }))
  }
  if (encerradosPorFalta > 0) {
    console.log(JSON.stringify({ src: "housekeeping", kind: "paywall-encerrou-cobranca", n: encerradosPorFalta }))
  }

  return { suspended, purged, outboxPurged, encerradosPorFalta }
}
