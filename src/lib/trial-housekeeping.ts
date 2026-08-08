import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
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
export async function runTrialHousekeeping(): Promise<{ suspended: number; purged: number; outboxPurged: number }> {
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
      .update({ subscription_status: "canceled", subscription_ends_at: null })
      .eq("id", (t as { id: string }).id)
    if (error) console.error("[housekeeping] falha ao encerrar assinatura:", (t as { id: string }).id, error.message)
    else encerrados++
  }
  if (encerrados > 0) console.log(JSON.stringify({ src: "housekeeping", kind: "assinaturas-encerradas", n: encerrados }))

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

  return { suspended, purged, outboxPurged }
}
