import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { applyPlan } from "@/lib/plans"
import { generateInvoiceForTenant } from "@/lib/billing"
import { normalizeState } from "@/lib/lifecycle-shared"
import { asaas, AsaasError } from "./client"

// ═══════════════════════════════════════════════════════════════
// Processamento dos eventos do Asaas — onde a escada é acionada
// ═══════════════════════════════════════════════════════════════
// docs/asaas-billing-design.md §5 e §6 · docs/access-revocation-design.md §2
//
// 🔑 TUDO AQUI CONVERGE PARA UMA COLUNA: `tenants.subscription_status`. A escada inteira
//    — os 3 gates de gasto, as faixas, os botões travados, o corte da IA — já reage a ela,
//    construída e cronometrada em 2026-08-03. Este arquivo NÃO implementa bloqueio nenhum:
//    ele só move o estado, e o resto do produto já sabe o que fazer.

/** Eventos que LIBERAM. `CONFIRMED` já basta — ver o comentário em `liberar`. */
const LIBERA = new Set(["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"])

/** Eventos que RESTRINGEM (degrau 3) — todos passam por confirmação, ver `restringir`. */
const RESTRINGE = new Set(["PAYMENT_OVERDUE"])

/** Eventos que restringem E pedem olho humano (dinheiro voltou / foi contestado). */
const ALERTA = new Set([
  "PAYMENT_REFUNDED", "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_CHARGEBACK_REQUESTED", "PAYMENT_CHARGEBACK_DISPUTE",
])

/**
 * 🔴 FALHA DE CARTÃO NÃO FAZ NADA — é o DEGRAU 1, e o dono dele é o Asaas.
 *    `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED` é o cartão recusado; o Asaas re-tenta sozinho,
 *    e boa parte disso é cartão vencido que resolve em dias. Restringir aqui gastaria a
 *    munição do degrau 3 num problema que geralmente se resolve sozinho — e puniria o
 *    cliente antes de a régua de cobrança ter feito o trabalho dela.
 *    Só quando o Asaas desiste é que vem `PAYMENT_OVERDUE`, e AÍ a escada entra.
 */
const SILENCIOSOS = new Set([
  "PAYMENT_CREATED", "PAYMENT_UPDATED", "PAYMENT_AUTHORIZED",
  "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
  "PAYMENT_AWAITING_RISK_ANALYSIS", "PAYMENT_APPROVED_BY_RISK_ANALYSIS",
  "PAYMENT_BANK_SLIP_VIEWED", "PAYMENT_CHECKOUT_VIEWED",
])

/**
 * 🔴 FIM DA ASSINATURA — o buraco que a configuração do webhook expôs (2026-08-04).
 *
 * Sem estes dois, cancelar a assinatura no Asaas era **grátis pra sempre**: sem assinatura
 * não se gera cobrança, sem cobrança não vem `PAYMENT_OVERDUE`, e sem `OVERDUE` a escada
 * nunca é acionada — o cliente ficava `active` indefinidamente, sem pagar.
 * É a mesma família do defeito da guarda do trial: sai do domínio de um mecanismo e não
 * entra no de ninguém.
 */
const ENCERRA = new Set(["SUBSCRIPTION_DELETED", "SUBSCRIPTION_INACTIVATED"])

/**
 * 🔎 `SUBSCRIPTION_UPDATED` NÃO é silencioso — vira detector de divergência.
 *
 * A primeira leitura foi "é eco do nosso próprio comando" (somos nós que atualizamos o
 * valor com o excedente do ciclo). Errada por dois motivos, e o dono corrigiu:
 *   1. **O cliente pode fazer upgrade de plano** — então a mudança de valor é um fato de
 *      negócio, não ruído de integração.
 *   2. Alguém pode alterar o valor **direto no painel do Asaas**. Este evento é o ÚNICO
 *      sinal disso; tratá-lo como silêncio faria o gateway cobrar um valor e a Kora
 *      acreditar em outro, indefinidamente e sem ninguém perceber.
 *
 * Não muda estado — só compara e grita quando o gateway e a Kora discordam. Agir sozinho
 * aqui seria deixar o valor cobrado ser decidido por quem editou por último.
 */
const CONFERE_VALOR = new Set(["SUBSCRIPTION_UPDATED"])

interface EventRow {
  id: string
  event_type: string
  payment_id: string | null
  /**
   * ⚠️ O envelope MUDA de forma conforme o evento: `PAYMENT_*` traz `payment`,
   *    `SUBSCRIPTION_*` traz `subscription`. Assumir só `payment` fazia o evento de
   *    assinatura ser fechado como "sem customer" e **nunca processado, em silêncio** —
   *    justamente o cancelamento, que é o que a escada mais precisa saber.
   */
  payload: {
    payment?:      { id?: string; customer?: string; value?: number; status?: string }
    /** Preenchido pela consulta ao gateway, não pelo payload. */
    subscription?: { id?: string; customer?: string; status?: string }
  } | null
  processed_at: string | null
}

/** Marca o evento como resolvido. `nota` vira o `error` quando algo não deu certo. */
async function fechar(id: string, nota?: string): Promise<void> {
  await supabaseAdmin.from("asaas_webhook_events")
    .update({ processed_at: new Date().toISOString(), error: nota ?? null })
    .eq("id", id)
}

export async function processAsaasEvent(eventId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("asaas_webhook_events")
    .select("id, event_type, payment_id, payload, processed_at")
    .eq("id", eventId)
    .maybeSingle()

  if (error) { console.error("[asaas-handler] leitura falhou:", eventId, error.message); return }
  if (!data) return
  const ev = data as EventRow
  if (ev.processed_at) return   // já resolvido (corrida entre entrega e reprocessamento)

  // Cobre os dois envelopes (ver o comentário em `EventRow.payload`).
  const customerId = ev.payload?.payment?.customer ?? ev.payload?.subscription?.customer ?? null

  // ── Regra 3 · FILTRO DE TENANCY ─────────────────────────────────────────
  // Um webhook do Asaas recebe TODOS os eventos da conta — inclusive de outro produto que
  // compartilhe a mesma conta (medido no sandbox: havia um webhook de outro sistema).
  // Sem este filtro, o Kora daria baixa em fatura alheia. Evento sem dono nosso é
  // REGISTRADO (pra diagnóstico) e nunca processado.
  if (!customerId) { await fechar(ev.id, "sem customer no payload"); return }

  const { data: tenantRow } = await supabaseAdmin
    .from("tenants")
    .select("id, lifecycle_state, subscription_status, billing_mode")
    .eq("asaas_customer_id", customerId)
    .maybeSingle()

  if (!tenantRow) {
    console.log(JSON.stringify({ src: "asaas-handler", kind: "nao-e-nosso", event: ev.event_type, customer: customerId }))
    await fechar(ev.id, "customer não pertence a nenhum tenant")
    return
  }
  const tenant = tenantRow as { id: string; lifecycle_state: string | null; subscription_status: string | null; billing_mode: string | null }

  // ⚠️ Cliente `manual` (ativado à mão) NUNCA é movido pela automação — §2 do design.
  //    Se ele tem customer no Asaas por algum motivo, o evento é registrado e ignorado.
  if (tenant.billing_mode !== "gateway") {
    await fechar(ev.id, `tenant em billing_mode=${tenant.billing_mode} — automação não atua`)
    return
  }

  const tipo = ev.event_type

  if (SILENCIOSOS.has(tipo)) { await fechar(ev.id); return }

  if (LIBERA.has(tipo)) { await liberar(tenant, ev); return }

  if (RESTRINGE.has(tipo) || ALERTA.has(tipo)) {
    await restringir(tenant, ev, ALERTA.has(tipo))
    return
  }

  if (ENCERRA.has(tipo)) { await encerrar(tenant, ev); return }

  if (CONFERE_VALOR.has(tipo)) { await conferirValor(tenant, ev); return }

  // Evento que não mapeamos: registra e segue. Não inventa comportamento.
  console.log(JSON.stringify({ src: "asaas-handler", kind: "nao-mapeado", event: tipo, tenant: tenant.id }))
  await fechar(ev.id, "evento não mapeado")
}

/**
 * O valor da assinatura mudou no gateway → confere contra o que a Kora acha que cobra.
 *
 * 🔑 NÃO muda estado, de propósito. Duas origens possíveis, e o evento não as distingue:
 *      • **upgrade de plano feito pelo cliente** (legítimo, e a Kora já sabe — foi ela que
 *        mandou atualizar); ou
 *      • **edição direta no painel do Asaas**, que a Kora NÃO sabe.
 *    No segundo caso, sincronizar automaticamente faria o valor cobrado ser decidido por
 *    quem editou por último — e o preço do produto passaria a morar no gateway. Alinhar
 *    isso é decisão de negócio, então o código só aponta a divergência.
 *
 * ⚠️ Compara com `plans.price_cents` (o preço-base). Excedente do ciclo anterior é somado
 *    ao valor da assinatura por nós, então uma diferença POSITIVA e igual a um múltiplo do
 *    preço de usuário extra é esperada — o alerta é ponto de partida pra investigação
 *    humana, não veredicto.
 */
async function conferirValor(
  tenant: { id: string },
  ev: EventRow,
): Promise<void> {
  const subId = ev.payload?.subscription?.id ?? null
  if (!subId) { await fechar(ev.id, "sem id de assinatura no payload"); return }

  try {
    const sub = await asaas.get<{ value?: number }>(`/subscriptions/${subId}`)
    const noGateway = Math.round((sub?.value ?? 0) * 100)   // Asaas usa reais; guardamos centavos

    const { data } = await supabaseAdmin
      .from("tenants")
      .select("plans:plan_id ( name, price_cents )")
      .eq("id", tenant.id)
      .maybeSingle()
    const plano = (data as { plans?: { name: string; price_cents: number } | null } | null)?.plans ?? null
    const naKora = plano?.price_cents ?? 0

    if (noGateway !== naKora) {
      console.error(JSON.stringify({ src: "asaas-handler", kind: "DIVERGENCIA-DE-VALOR",
        tenant: tenant.id, subscription: subId, plano: plano?.name ?? null,
        gateway_cents: noGateway, kora_cents: naKora,
        nota: "diferenca esperada se houver excedente do ciclo anterior; investigar se nao houver" }))
      await fechar(ev.id, `valor divergente: gateway=${noGateway} kora=${naKora}`)
      return
    }
    await fechar(ev.id)
  } catch (e) {
    console.error("[asaas-handler] não conferiu o valor:", subId, (e as Error).message)
    await fechar(ev.id, "não foi possível conferir o valor no gateway")
  }
}

/**
 * Assinatura acabou (cancelada, removida ou inativada pelo gateway) → `canceled`.
 *
 * 🔑 Por que isto NÃO é o mesmo que `past_due`: inadimplência é *"devia e não pagou"*;
 *    aqui a relação de cobrança simplesmente **deixou de existir**. Sem assinatura não se
 *    gera cobrança, logo nunca viria um `PAYMENT_OVERDUE` — o cliente ficaria `active`
 *    para sempre, de graça. Este é o único evento que fecha esse caminho.
 *
 * ⚠️ Mexe SÓ em `subscription_status`, nunca no `lifecycle_state`. Cancelar assinatura é
 *    evento de DINHEIRO (degrau 3: para o gasto, mantém o atendimento); encerrar a relação
 *    é decisão comercial e continua sendo do god mode. Um gateway não desliga cliente.
 *
 * ⚠️ E LIMPA o `asaas_subscription_id`: ele é o que faz o cron de trial pular o tenant.
 *    Deixá-lo apontando para uma assinatura morta manteria o cliente fora do domínio do
 *    cron e fora do domínio do webhook ao mesmo tempo — o "grátis pra sempre" que o
 *    revisor descreveu, por outra porta.
 */
async function encerrar(
  tenant: { id: string },
  ev: EventRow,
): Promise<void> {
  // 🔴 NÃO corta agora — CARIMBA ATÉ QUANDO (regra do dono, 2026-08-04): *"o acesso dele
  //    continua até o fim, caso esteja no ciclo"*. Marcar `canceled` aqui faria os 3 gates
  //    de gasto pararem campanhas, automação e IA **no mesmo dia** — quem cancelou no dia 3
  //    de um mês já pago perderia 27 dias que comprou. Isso não é régua de inadimplência,
  //    é retomar produto entregue.
  //    A virada para `canceled` é da varredura diária, quando a data passar.
  const fimDoCiclo = await calcularFimDoCiclo(tenant.id, ev)

  const { error } = await supabaseAdmin.from("tenants")
    .update({
      // ⚠️ `subscription_status` fica como está. Ele ainda é cliente pago até a data.
      subscription_ends_at:  fimDoCiclo,
      asaas_subscription_id: null,
    })
    .eq("id", tenant.id)

  if (error) { await fechar(ev.id, `falha ao encerrar: ${error.message}`); return }

  console.error(JSON.stringify({ src: "asaas-handler", kind: "ASSINATURA-ENCERRADA",
    motivo: ev.event_type, tenant: tenant.id, acesso_ate: fimDoCiclo }))
  await fechar(ev.id)
}

/**
 * Até quando o ciclo já pago vai. Duas fontes, nesta ordem:
 *   1. `period_end` da última fatura **paga** — é a verdade do nosso livro-caixa.
 *   2. `nextDueDate` da assinatura no gateway — a data em que a próxima cobrança cairia,
 *      que é o mesmo que o fim do período corrente.
 *
 * ⚠️ Sem nenhuma das duas, devolve **agora**: o corte é imediato. É o fail-closed correto
 *    aqui — sem evidência de ciclo pago, não há ciclo pago a preservar. Inventar "mais 30
 *    dias" daria um mês de produto de graça a quem talvez nunca tenha pagado.
 */
async function calcularFimDoCiclo(tenantId: string, ev: EventRow): Promise<string> {
  const { data: ultima } = await supabaseAdmin
    .from("invoices")
    .select("period_end")
    .eq("tenant_id", tenantId)
    .eq("status", "paid")
    .order("period_end", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  const periodEnd = (ultima as { period_end?: string } | null)?.period_end
  if (periodEnd) return new Date(`${periodEnd}T23:59:59Z`).toISOString()

  const subId = ev.payload?.subscription?.id
  if (subId) {
    try {
      const sub = await asaas.get<{ nextDueDate?: string }>(`/subscriptions/${subId}`)
      if (sub?.nextDueDate) return new Date(`${sub.nextDueDate}T23:59:59Z`).toISOString()
    } catch {
      // assinatura já removida do gateway — cai no fail-closed abaixo
    }
  }

  console.warn("[asaas-handler] sem evidência de ciclo pago, corte imediato:", tenantId)
  return new Date().toISOString()
}

/**
 * Baixa na fatura da Kora quando o gateway confirma o pagamento.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔴 O FURO QUE ISTO FECHA (achado 2026-08-05, confirmado linha a linha)
 * ══════════════════════════════════════════════════════════════════════════════
 * A versão anterior casava a fatura por `.eq("gateway_ref", ev.payment_id)`. Só que
 * **`invoices.gateway_ref` NÃO TINHA NENHUM ESCRITOR** — a coluna existia na migration,
 * era LIDA aqui, e nunca era gravada em lugar nenhum do repositório. Logo o filtro casava
 * **zero linhas, sempre**: nenhuma fatura jamais virava `paid` pelo webhook.
 *
 * O laço estava aberto nas duas pontas, e por um motivo estrutural: a Kora gera a fatura
 * no `billing_day` (cron), e o Asaas cobra o cartão no `nextDueDate` da assinatura. São
 * dois relógios diferentes — **as duas pontas nunca foram apresentadas uma à outra.**
 *
 * O dano NÃO era só contábil:
 *   • `standing.ts` mantinha quem acabou de pagar no degrau `grace` ("sua fatura está em
 *     aberto") — a tela acusando de caloteiro quem estava em dia;
 *   • `calcularFimDoCiclo` procura uma fatura `paid` pra saber até quando o cliente tem
 *     acesso; sem nenhuma, caía no fallback `"sem evidência de ciclo pago, corte
 *     imediato"` — cortando na hora quem pagou 12 meses. Isso contradizia frontalmente a
 *     decisão do dono ("o acesso continua até o fim do ciclo").
 *
 * ── COMO CASA AGORA ──────────────────────────────────────────────────────────
 * Pela **fatura em aberto mais ANTIGA do tenant** — exatamente a definição que
 * `standing.ts` já usa pra dizer "é esta que ele tem que pagar". Reusar a definição em vez
 * de inventar uma segunda é o que impede as duas telas de discordarem sobre qual fatura é
 * a da vez.
 *
 * ⚠️ NÃO caso por VALOR. O valor da assinatura no gateway é o preço do plano; o da fatura
 *    inclui excedente. Exigir igualdade faria a baixa falhar justamente em quem consome
 *    mais — o cliente que a gente menos pode irritar. A divergência é REGISTRADA (é sinal
 *    de que o `PUT` de atualização de valor não rodou), mas não impede a baixa: quem diz
 *    quanto entrou é o gateway.
 *
 * ⚠️ Pagamento SEM fatura correspondente é NORMAL e não é erro: durante o trial a
 *    assinatura cobra em `trial_ends_at`, antes de o cron ter gerado qualquer fatura. Fica
 *    logado como fato, não como falha — mas fica logado, porque dinheiro que entra sem
 *    contrapartida no livro é a coisa que a gente mais precisa enxergar.
 */
async function darBaixaNaFatura(tenantId: string, ev: EventRow): Promise<void> {
  if (!ev.payment_id) return

  // Idempotência: `gateway_ref` já carimbado com ESTE pagamento ⇒ evento repetido.
  // ("at least once" é contrato do Asaas — repetição é caminho normal, não erro.)
  const { data: jaBaixada } = await supabaseAdmin
    .from("invoices").select("id")
    .eq("tenant_id", tenantId).eq("gateway_ref", ev.payment_id)
    .limit(1).maybeSingle()
  if (jaBaixada) return

  const { data: encontrada, error: buscaErr } = await supabaseAdmin
    .from("invoices")
    .select("id, total_cents")
    .eq("tenant_id", tenantId)
    .in("status", ["open", "overdue"])
    // A mais ANTIGA primeiro — mesma ordenação de `standing.ts`.
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  // Mutável: o ramo abaixo pode CRIAR a fatura quando o pagamento chega antes dela.
  let alvo = encontrada

  if (buscaErr) {
    // 🔴 Grita. Dinheiro entrou e o livro não soube — é exatamente o estado que este
    //    helper existe pra tornar impossível, então ele não pode falhar em silêncio.
    console.error(JSON.stringify({
      src: "asaas-handler", kind: "baixa-falhou-na-busca",
      tenant: tenantId, payment: ev.payment_id, msg: buscaErr.message,
    }))
    return
  }

  // 🔴 PAGAMENTO SEM FATURA GERAVA A FATURA — DE NADA (corrigido 06/08/2026).
  //
  //    Antes este ramo só logava e voltava. O dinheiro entrava no gateway e **não existia
  //    registro nenhum no nosso livro**: o cliente pagava, o produto liberava, e ele não
  //    tinha fatura pra ver, baixar ou levar pra contabilidade. Medido ao vivo: assinatura
  //    paga, `invoices` com ZERO linhas pro tenant.
  //
  //    E não era caso de borda — era o caminho NORMAL da primeira cobrança. A fatura só
  //    nasce no `billing_day` pelo cron; o primeiro pagamento acontece antes disso, então
  //    todo cliente novo caía aqui. Nos meses seguintes vira cara-ou-coroa entre o cron
  //    (09h UTC) e a cobrança do cartão (madrugada).
  //
  // 🔑 Se o dinheiro entrou, a fatura TEM que existir: gera agora e dá baixa na sequência.
  //    `generateInvoiceForTenant` é idempotente por período (a guarda dele evita duplicar
  //    se o cron rodar depois), então gerar aqui não cria fatura dobrada.
  // ⚠️ Falhar aqui NÃO desfaz a liberação: o cliente pagou e o acesso é dele. Grita no log
  //    pra alguém emitir à mão — dinheiro sem fatura é problema de livro, não de produto.
  if (!alvo) {
    const nova = await generateInvoiceForTenant(tenantId)
    if (nova.id) {
      const { data: recem } = await supabaseAdmin
        .from("invoices").select("id, total_cents").eq("id", nova.id).maybeSingle()
      alvo = (recem ?? null) as typeof alvo
      console.log(JSON.stringify({
        src: "asaas-handler", kind: "fatura-gerada-no-pagamento",
        tenant: tenantId, payment: ev.payment_id, invoice: nova.id,
      }))
    }
    if (!alvo) {
      console.error(JSON.stringify({
        src: "asaas-handler", kind: "pagamento-SEM-FATURA-emitir-a-mao",
        tenant: tenantId, payment: ev.payment_id, motivo: nova.error ?? (nova.skipped ? "plano sem valor" : "desconhecido"),
      }))
      return
    }
  }

  const pago = typeof ev.payload?.payment?.value === "number" ? Math.round(ev.payload.payment.value * 100) : null
  const devido = (alvo as { total_cents: number }).total_cents
  if (pago !== null && pago !== devido) {
    console.warn(JSON.stringify({
      src: "asaas-handler", kind: "baixa-com-valor-divergente",
      tenant: tenantId, payment: ev.payment_id, pagoCents: pago, faturaCents: devido,
    }))
  }

  const { error } = await supabaseAdmin
    .from("invoices")
    .update({
      status:      "paid",
      paid_at:     new Date().toISOString(),
      paid_method: "credit_card",
      // 🔑 O ELO QUE FALTAVA. Daqui pra frente a fatura sabe qual pagamento a quitou —
      //    e a idempotência lá em cima passa a ter em que se apoiar.
      gateway_ref: ev.payment_id,
    })
    .eq("id", (alvo as { id: string }).id)
    .neq("status", "paid")

  if (error) {
    console.error(JSON.stringify({
      src: "asaas-handler", kind: "baixa-falhou",
      tenant: tenantId, payment: ev.payment_id, invoice: (alvo as { id: string }).id, msg: error.message,
    }))
    return
  }

  console.log(JSON.stringify({
    src: "asaas-handler", kind: "fatura-baixada",
    tenant: tenantId, payment: ev.payment_id, invoice: (alvo as { id: string }).id,
  }))
}

/**
 * Pagamento entrou → libera.
 *
 * 🔑 `PAYMENT_CONFIRMED` JÁ BASTA — não esperamos o `RECEIVED`. A diferença, na doc do
 *    Asaas: CONFIRMED = pagou, saldo ainda não disponível; RECEIVED = dinheiro na conta.
 *    Esperar a liquidação seria segurar o acesso de quem **já pagou** — a pior fricção
 *    possível, e exatamente o "restringe quem pagou ontem" que a escada existe pra evitar.
 *    O risco de liberar antes da liquidação é uma mensalidade; o de bloquear quem pagou é
 *    o cliente.
 */
async function liberar(
  tenant: { id: string; lifecycle_state: string | null },
  ev: EventRow,
): Promise<void> {
  // ══════════════════════════════════════════════════════════════════════════
  // 🔴 CORROBORAR ANTES DE LIBERAR (05/08/2026) — a assimetria estava furada
  // ══════════════════════════════════════════════════════════════════════════
  // Este arquivo declarava que bloquear exige confirmação no gateway e liberar não, com
  // o argumento de que "o token do webhook já protege". Mas o token é o MESMO controle
  // nos dois sentidos — contá-lo duas vezes não faz dele dois controles. Na prática,
  // liberar acreditava no corpo da requisição: não perguntava se o pagamento existe, se
  // é da NOSSA assinatura, nem se o valor bate.
  //
  // 🔴 E NÃO É TEÓRICO: foi assim que eu testei a ativação em 05/08. Disparei dois
  //    eventos com `payment_id` que NÃO EXISTE no Asaas e o sistema ativou a conta,
  //    ligou os módulos e limpou o `trial_ends_at`. O teste virou, sem querer, a prova
  //    de conceito do furo. Quem tiver o token (log de proxy, print do painel, `.env`
  //    vazado, ex-funcionário) ativa qualquer tenant de graça, para sempre.
  //
  // ⚠️ Falha de REDE não pune e não libera: deixa o evento PENDENTE (sem `processed_at`)
  //    pra a reconciliação do cron pegar. Marcar como processado aqui perderia um
  //    pagamento real por causa de um timeout — e o dinheiro já entrou.
  // ⚠️ Já `pagamento inexistente` ou status que não confirma são FECHADOS com nota: não é
  //    transitório, é evento que não deveria liberar nada.
  if (!ev.payment_id) { await fechar(ev.id, "sem payment_id — não libera"); return }

  let pagamento: { status?: string; subscription?: string | null; customer?: string | null }
  try {
    pagamento = await asaas.get(`/payments/${ev.payment_id}`)
  } catch (e) {
    const msg = (e as Error).message
    // 404 = o pagamento não existe no gateway ⇒ payload forjado ou id inválido. Fecha.
    if (e instanceof AsaasError && e.status === 404) {
      console.error(JSON.stringify({
        src: "asaas-handler", kind: "pagamento-inexistente-nao-libera",
        tenant: tenant.id, payment: ev.payment_id,
      }))
      await fechar(ev.id, "pagamento não existe no gateway")
      return
    }
    // Qualquer outra falha é tratada como transitória: NÃO fecha, pra ser reprocessado.
    console.error("[asaas-handler] não confirmou pagamento, NÃO libera (fica pendente):", ev.payment_id, msg)
    return
  }

  // 🔒 O `customer` do PAYLOAD é forjável (é o corpo da requisição) e é por ele que o
  //    filtro de tenancy acha o tenant. Confere contra o pagamento REAL do gateway: sem
  //    isto, quem tivesse o token podia replayar um pagamento confirmado legítimo com o
  //    `customer` trocado e liberar outro tenant.
  const { data: donoRow } = await supabaseAdmin
    .from("tenants").select("asaas_customer_id").eq("id", tenant.id).maybeSingle()
  const nossoCustomer = (donoRow as { asaas_customer_id?: string | null } | null)?.asaas_customer_id ?? null
  if (nossoCustomer && pagamento?.customer && pagamento.customer !== nossoCustomer) {
    await fechar(ev.id, "pagamento é de outro cliente do gateway")
    return
  }

  const status = pagamento?.status ?? ""
  if (!["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"].includes(status)) {
    await fechar(ev.id, `gateway diz status=${status} — não libera`)
    return
  }

  // ⚠️ O pagamento tem que ser DA NOSSA assinatura. Sem isto, uma cobrança avulsa de R$ 5
  //    criada no painel do Asaas destrava um plano de R$ 249,90 — o evento chega com o
  //    mesmo `customer` e o filtro de tenancy o aceita.
  // ⚠️ Tenant sem `asaas_subscription_id` (ativação manual, cliente legado) não tem contra
  //    o que comparar: aí a checagem é pulada de propósito, com log — apertar aqui
  //    quebraria quem a operação ativou à mão.
  const { data: assinatura } = await supabaseAdmin
    .from("tenants").select("asaas_subscription_id").eq("id", tenant.id).maybeSingle()
  const bruto = (assinatura as { asaas_subscription_id?: string | null } | null)?.asaas_subscription_id ?? null
  // ⚠️ `pending:<uuid>` é a RESERVA do claim atômico (subscriptions.ts), não um id de
  //    assinatura. Compará-la com o `subscription` do gateway recusaria um pagamento
  //    legítimo que chegasse no meio da ativação.
  const nossa = bruto && !bruto.startsWith("pending:") ? bruto : null
  // 🔴 IGUALDADE ESTRITA (06/08). A versão anterior exigia `pagamento?.subscription`
  //    presente — e **cobrança avulsa criada no painel do Asaas não tem esse campo**.
  //    Confirmado em payload real de produção. Ou seja: a guarda escrita pra impedir que
  //    "uma cobrança avulsa de R$ 5 destrave um plano de R$ 249,90" deixava passar
  //    exatamente esse caso, e só barrava o mais improvável (pagamento de outra assinatura).
  if (nossa && pagamento?.subscription !== nossa) {
    console.error(JSON.stringify({
      src: "asaas-handler", kind: "pagamento-de-outra-assinatura",
      tenant: tenant.id, payment: ev.payment_id, esperada: nossa, veio: pagamento.subscription,
    }))
    await fechar(ev.id, "pagamento não pertence à assinatura deste cliente")
    return
  }

  const patch: Record<string, unknown> = {
    subscription_status: "active",
    // 🔑 Limpa o carimbo de encerramento (05/08). `encerrar()` grava `subscription_ends_at`
    //    e NINGUÉM limpava: quem cancelava e recontratava antes da data era derrubado pela
    //    varredura 1.b do housekeeping — marcado `canceled` de novo, já pagando.
    subscription_ends_at: null,
  }

  // ⚠️ Fim do trial: quem pagou sai de `trialing` e vira cliente. Sem isto, ele ficaria
  //    `trialing` com `trial_ends_at` vencido pra sempre — e qualquer varredura futura de
  //    trial vencido suspenderia um cliente pagante.
  //
  // 🔴 `trial_ended` PRECISOU ENTRAR AQUI (05/08) — e a falta era a pior possível: **o
  //    cliente pagava e continuava travado**. Este ramo só conhecia `trialing`; o estado
  //    `trial_ended` nasceu ontem, pra travar o produto quando o teste vence, e ninguém
  //    voltou aqui pra ensinar a destravar. O desenho inteiro do fim de teste é
  //    "trava → paga → libera", e a última seta não existia: entrava dinheiro,
  //    `subscription_status` virava `active`, e o `lifecycle_state` seguia `trial_ended`
  //    ⇒ modal persistente na cara de quem acabou de pagar, para sempre.
  // ⚠️ Mesma classe do `KNOWN_STATES` de ontem: estado novo no tipo, consumidor antigo
  //    intacto, `tsc` verde. Estado novo obriga a varrer QUEM DECIDE em cima dele.
  if (["trialing", "trial_ended"].includes(normalizeState(tenant.lifecycle_state))) {
    patch.lifecycle_state = "active"
    patch.trial_ends_at   = null
    patch.active          = true
  }

  const { error } = await supabaseAdmin.from("tenants").update(patch).eq("id", tenant.id)
  if (error) { await fechar(ev.id, `falha ao liberar: ${error.message}`); return }

  // 🔴 APLICA O PLANO — elo que faltava (2026-08-05). `applyPlan` só era chamado pelo god
  //    mode e pelo signup: o cliente pagava, o `subscription_status` virava `active`, e os
  //    módulos do plano contratado **nunca eram ligados**. Quem saía do Trial pagando
  //    ficava com os módulos do Trial pra sempre, e quem escolhia um plano maior pagava
  //    por ele sem receber. O dinheiro entrava e o produto não mudava.
  // ⚠️ Aqui é o lugar certo, e não na escolha do plano. A cadeia tem três marcos distintos,
  //    e confundi-los foi o bug de 05/08: `escolherPlano` **não persiste nada** (só valida);
  //    `criarAssinatura` carimba `plan_id` quando o compromisso existe de fato; e este ramo
  //    LIBERA os módulos, só com pagamento confirmado. Liberar na escolha deixaria qualquer
  //    um marcar o plano mais caro e nunca pagar.
  // ⚠️ Best-effort com log ALTO: falhar aqui deixa um cliente que PAGOU sem os módulos.
  //    Não desfaz a liberação (ele pagou, o acesso é dele) — grita pra ser reparado à mão.
  const { data: comPlano } = await supabaseAdmin
    .from("tenants").select("plan_id").eq("id", tenant.id).maybeSingle()
  const planId = (comPlano as { plan_id?: string | null } | null)?.plan_id
  if (planId) {
    const ap = await applyPlan(tenant.id, planId)
    if (!ap.ok) {
      console.error(JSON.stringify({
        src: "asaas-handler", kind: "plano-nao-aplicado-apos-pagamento",
        tenant: tenant.id, plan: planId, msg: ap.error ?? null,
      }))
    }
  }

  await darBaixaNaFatura(tenant.id, ev)

  console.log(JSON.stringify({ src: "asaas-handler", kind: "liberado", tenant: tenant.id, event: ev.event_type }))
  await fechar(ev.id)
}

/**
 * Pagamento venceu / voltou → restringe (degrau 3).
 *
 * 🔴 REGRA 4 — A ASSIMETRIA. O webhook pode LIBERAR na palavra dele, mas para BLOQUEAR
 *    ele precisa de corroboração: consultamos o pagamento na API do Asaas antes de mexer.
 *    O motivo é o custo do erro em cada direção: um evento forjado que libera custa uma
 *    mensalidade; um que bloqueia **derruba a operação de um cliente pagante** — campanhas
 *    param, IA para, o WhatsApp dele emudece. O token do header já protege os dois lados;
 *    isto é a segunda parede, na direção em que o estrago não tem volta.
 * ⚠️ Se a consulta FALHAR, não restringe. Sem confirmar, o certo é não punir.
 */
async function restringir(
  tenant: { id: string; subscription_status: string | null },
  ev: EventRow,
  pedeOlhoHumano: boolean,
): Promise<void> {
  if (!ev.payment_id) { await fechar(ev.id, "sem payment_id para confirmar"); return }

  try {
    const pag = await asaas.get<{ status?: string }>(`/payments/${ev.payment_id}`)
    const status = pag?.status ?? ""
    // Só restringe se o gateway CONFIRMAR um estado ruim. `CONFIRMED`/`RECEIVED` aqui
    // significaria evento atrasado chegando depois do pagamento — nesse caso, não toca.
    const ruim = ["OVERDUE", "REFUNDED", "CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE", "REFUND_IN_PROGRESS"]
    if (!ruim.some((s) => status.includes(s))) {
      await fechar(ev.id, `gateway diz status=${status} — não restringe`)
      return
    }
  } catch (e) {
    // Não confirmou ⇒ não pune. Fica pendente e pode ser reprocessado.
    // ⚠️ NÃO fecha (06/08): o comentário acima dizia "fica pendente e pode ser
    //    reprocessado" e o código FECHAVA — um timeout num `PAYMENT_OVERDUE` legítimo
    //    virava inadimplente que nunca era restringido. Simétrico ao `liberar`.
    console.error("[asaas-handler] não confirmou o pagamento, NÃO restringindo (fica pendente):", ev.payment_id, (e as Error).message)
    return
  }

  const { error } = await supabaseAdmin.from("tenants")
    .update({ subscription_status: "past_due" }).eq("id", tenant.id)
  if (error) { await fechar(ev.id, `falha ao restringir: ${error.message}`); return }

  // Estorno e chargeback não são inadimplência comum — o dinheiro VOLTOU, e isso costuma
  // ter uma história atrás. Grita alto pra alguém olhar.
  if (pedeOlhoHumano) {
    console.error(JSON.stringify({ src: "asaas-handler", kind: "ATENCAO-HUMANA",
      motivo: ev.event_type, tenant: tenant.id, payment: ev.payment_id }))
  }

  console.log(JSON.stringify({ src: "asaas-handler", kind: "restringido", tenant: tenant.id, event: ev.event_type }))
  await fechar(ev.id)
}
