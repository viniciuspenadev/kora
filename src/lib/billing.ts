import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { getPlatformSettings } from "@/lib/platform-settings"
import { isTenantInPaywall } from "@/lib/lifecycle-shared"
import { atualizarValorDaAssinatura } from "@/lib/asaas/subscriptions"

/**
 * Núcleo financeiro (sem auth) — reusado por:
 *   - admin-billing.ts (server actions, com requirePlatformAdmin)
 *   - /api/cron/billing (geração mensal automática)
 *   - dashboard + /admin/financeiro (resumo de MRR)
 */

interface PlanRow { id: string; name: string; price_cents: number; user_quota: number; extra_user_price_cents: number }

export interface BillingSummary {
  mrr_cents: number
  billed:    number
  noPlan:    number
  byPlan:    Array<{ id: string; name: string; cents: number; count: number }>
}

/** MRR consolidado: tenants ativos, com plano, assinatura não-cancelada. */
export async function computeBillingSummary(): Promise<BillingSummary> {
  const [
    { data: tenants,     error: errTenants },
    { data: plans,       error: errPlans },
    { data: activeUsers, error: errUsers },
    { data: recurring,   error: errAddons },
  ] = await Promise.all([
    supabaseAdmin.from("tenants").select("id, plan_id, subscription_status").eq("active", true),
    supabaseAdmin.from("plans").select("id, name, price_cents, user_quota, extra_user_price_cents"),
    supabaseAdmin.from("tenant_users").select("tenant_id").eq("active", true),
    supabaseAdmin.from("tenant_charges").select("tenant_id, amount_cents").eq("kind", "recurring_addon").eq("active", true),
  ])

  // 🔴 AS QUATRO LEITURAS DESCARTAVAM O `error` (F1 da refundação, 11/08). Falha de
  //    consulta devolve `data: null`, o `?? []` logo abaixo transformava isso em lista
  //    vazia, e o MRR saía **zerado ou parcial** — sem sinal nenhum na tela nem no log.
  //    Cada uma tem um jeito próprio de mentir: sem `tenants` o total é 0; sem `plans`
  //    todo mundo é pulado; sem `tenant_users` o excedente some; sem `tenant_charges` os
  //    adicionais somem. Nos três últimos o número sai **plausível e menor** — e é assim
  //    que uma queda de receita inexistente vira decisão de negócio.
  // 🔑 Não há o que degradar: as quatro compõem o mesmo número. Melhor nenhum número que
  //    um número errado — aqui o erro sobe e a tela do god mode quebra alto.
  const falhou = errTenants ?? errPlans ?? errUsers ?? errAddons
  if (falhou) {
    const qual = errTenants ? "tenants" : errPlans ? "plans" : errUsers ? "tenant_users" : "tenant_charges"
    console.error(JSON.stringify({ src: "billing", kind: "resumo-de-mrr-nao-calculado", tabela: qual, msg: falhou.message }))
    throw new Error(`Resumo financeiro indisponível: leitura de ${qual} falhou`)
  }

  const planById = new Map<string, PlanRow>()
  for (const p of (plans ?? []) as PlanRow[]) planById.set(p.id, p)

  const usersByTenant = new Map<string, number>()
  for (const r of activeUsers ?? []) {
    const t = (r as { tenant_id: string }).tenant_id
    usersByTenant.set(t, (usersByTenant.get(t) ?? 0) + 1)
  }
  const addonsByTenant = new Map<string, number>()
  for (const r of recurring ?? []) {
    const c = r as { tenant_id: string; amount_cents: number }
    addonsByTenant.set(c.tenant_id, (addonsByTenant.get(c.tenant_id) ?? 0) + c.amount_cents)
  }

  let mrr = 0, billed = 0, noPlan = 0
  const byPlan = new Map<string, { id: string; name: string; cents: number; count: number }>()

  for (const t of (tenants ?? []) as Array<{ id: string; plan_id: string | null; subscription_status: string | null }>) {
    if (!t.plan_id) { noPlan++; continue }
    if (t.subscription_status === "canceled") continue
    const plan = planById.get(t.plan_id)
    if (!plan) continue
    billed++
    const users   = usersByTenant.get(t.id) ?? 0
    const overage = Math.max(0, users - plan.user_quota) * plan.extra_user_price_cents
    const addons  = addonsByTenant.get(t.id) ?? 0
    const total   = plan.price_cents + overage + addons
    mrr += total
    const agg = byPlan.get(plan.id) ?? { id: plan.id, name: plan.name, cents: 0, count: 0 }
    agg.cents += total; agg.count++
    byPlan.set(plan.id, agg)
  }

  return {
    mrr_cents: mrr,
    billed,
    noPlan,
    byPlan: Array.from(byPlan.values()).sort((a, b) => b.cents - a.cents),
  }
}

// ── Geração de fatura ───────────────────────────────────────────
export function currentPeriod(billingDay: number | null): { start: string; end: string; due: string } {
  const day = Math.min(Math.max(billingDay ?? 1, 1), 28)
  const now = new Date()
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate()
  let startY = y, startM = m
  if (d < day) { startM = m - 1; if (startM < 0) { startM = 11; startY = y - 1 } }
  const start   = new Date(Date.UTC(startY, startM, day))
  const endExcl = new Date(Date.UTC(startY, startM + 1, day))
  const end     = new Date(endExcl.getTime() - 86_400_000)
  const due     = new Date(start.getTime() + 7 * 86_400_000)
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10)
  return { start: fmt(start), end: fmt(end), due: fmt(due) }
}

/**
 * Gera a fatura do período atual de UM tenant (sem auth — caller decide).
 * Itens: plano base + overage de usuários + add-ons recorrentes + avulsas
 * pendentes. Idempotente por período (recusa se já houver fatura não-void).
 */
/**
 * @param opts.dinheiroJaEntrou — o chamador AFIRMA que um pagamento acabou de ser confirmado
 *   para este período. Só o caminho do webhook usa (`darBaixaNaFatura`), e ele é o único que
 *   tem essa informação de primeira mão.
 *
 * 🔑 POR QUE ESTE PARÂMETRO EXISTE (11/08): a guarda de paywall abaixo pergunta *"este
 *    período vai ser servido?"*. Quando o dinheiro **já entrou**, a resposta é sim — e até
 *    hoje a função descobria isso por ORDEM: o `liberar()` limpava o paywall ANTES de chamar
 *    a baixa, então a guarda nunca via um pagante bloqueado. Funcionava, mas por acidente de
 *    sequência, e o comentário da guarda declarava a suposição ("nesse caminho o tenant está
 *    pagando — não está no paywall") sem nada que a garantisse.
 * ⚠️ Isso travava a regra 3 do dono ("parcial não libera"): para condicionar a liberação ao
 *    pagamento cobrir a fatura, a baixa precisa rodar ANTES da liberação — e aí a guarda
 *    passaria a barrar justamente quem pagou, deixando dinheiro sem fatura.
 * 🔒 NÃO É BYPASS: não desliga regra nenhuma para o cron nem para o god mode, que continuam
 *    barrados no paywall. Só troca uma inferência frágil por uma afirmação explícita de quem
 *    sabe. Quem chamar com isto mentindo gera fatura de período não servido — por isso o
 *    único chamador autorizado é a baixa, logo após o gateway confirmar o pagamento.
 */
export async function generateInvoiceForTenant(
  tenantId: string,
  opts?: { dinheiroJaEntrou?: boolean },
): Promise<{ error?: string; id?: string; skipped?: boolean }> {
  const { data: tenant, error: tenantErr } = await supabaseAdmin
    // As 4 colunas extras alimentam a guarda de paywall logo abaixo — a linha já era lida.
    .from("tenants")
    .select("id, plan_id, billing_day, lifecycle_state, subscription_status, past_due_since, past_due_grace_days")
    .eq("id", tenantId).maybeSingle()
  // 🔴 "NÃO ACHEI" ≠ "NÃO CONSEGUI PROCURAR" (F1, 11/08). O `error` era descartado, então
  //    uma oscilação do banco devolvia `data: null` e a função respondia **"Tenant não
  //    encontrado"** — a mesma frase de um id que não existe. Pela mão, o operador conclui
  //    que o cliente sumiu; pelo cron, a linha vai pro relatório como falha do TENANT, e
  //    ninguém volta lá porque o motivo diz que o problema é o cadastro.
  // 🔑 A distinção é o que torna o retry legítimo: indisponibilidade passa, inexistência
  //    não. A mensagem tem que dizer qual das duas foi.
  if (tenantErr) {
    console.error(JSON.stringify({ src: "billing", kind: "leitura-do-tenant-falhou", tenant: tenantId, msg: tenantErr.message }))
    return { error: `Falha ao consultar o tenant: ${tenantErr.message}` }
  }
  if (!tenant)         return { error: "Tenant não encontrado" }
  if (!tenant.plan_id) return { error: "Tenant sem plano atribuído" }

  // ⚠️ Mesma regra pro plano: sem ele o preço base é desconhecido, e "não consegui ler a
  //    tabela de planos" não pode sair como "plano não existe" — o segundo sugere corrigir
  //    o cadastro do cliente, quando não há nada errado com ele.
  const { data: plan, error: planErr } = await supabaseAdmin.from("plans").select("*").eq("id", tenant.plan_id).maybeSingle()
  if (planErr) {
    console.error(JSON.stringify({ src: "billing", kind: "leitura-do-plano-falhou", tenant: tenantId, msg: planErr.message }))
    return { error: `Falha ao consultar o plano: ${planErr.message}` }
  }
  if (!plan) return { error: "Plano do tenant não encontrado" }

  // 🔴 PLANO GRATUITO NÃO GERA FATURA (2026-08-05). `createSubscriptionForTenant` já
  //    recusava preço zero; aqui não havia guarda nenhuma, e o efeito era pior que uma
  //    linha inútil no histórico: a fatura de **R$ 0,00** nasce `open` com vencimento, e 7
  //    dias depois `standing.ts` a lê como VENCIDA. O ramo de fatura vencida é avaliado
  //    ANTES do ramo de teste, então o cliente em trial passaria a ver *"fatura vencida —
  //    R$ 0,00"* e **o aviso de fim do teste sumiria da tela** — exatamente a surpresa que
  //    aquela superfície foi criada pra evitar, um dia antes.
  // ⚠️ `skipped`, não `error`: não é falha, é o caminho normal de quem está no Trial.
  //    Marcar como erro encheria o log do cron de alarme falso todo dia.
  if ((plan.price_cents ?? 0) <= 0) {
    return { skipped: true, error: "Plano sem valor — nada a faturar" }
  }

  // 🔴 PRÉ-PAGO: PERÍODO NÃO SERVIDO NÃO GERA FATURA (decisão do dono, 08/08 — *"elas nem
  //    devem existir em período não servido"*). A fatura cobre o período **à frente**
  //    (`currentPeriod`: começa hoje, termina daqui a um mês). Emitir uma para quem está no
  //    paywall seria vender um mês que não vamos entregar — e é literalmente o que
  //    acontecia: o cron só pulava `canceled`, então o bloqueado ganhava fatura nova todo
  //    mês. Três meses parado = três faturas de um período que ele não usou.
  // 🔑 Em pré-pago, fatura não paga não é dívida: é uma **oferta que expirou**. A que já
  //    estava aberta é encerrada com `void_reason='nao_servido'`; as seguintes nem nascem.
  // ⚠️ Aqui, e não só no cron: esta função também é chamada pelo webhook quando chega
  //    pagamento sem fatura. Nesse caminho o tenant está pagando — não está no paywall —
  //    então a guarda não atrapalha, e cobre o cron e a chamada avulsa de uma vez.
  const emPaywall = isTenantInPaywall(
    tenant.lifecycle_state, tenant.subscription_status,
    tenant.past_due_since, tenant.past_due_grace_days,
    (await getPlatformSettings()).pastDueGraceDays,
  )
  // 🔑 `dinheiroJaEntrou` desarma a guarda — e SÓ ela. Ver o porquê no docblock da função:
  //    período pago é período servido, e quem sabe disso é o caminho do pagamento, não a
  //    ordem em que as funções foram chamadas.
  if (emPaywall && !opts?.dinheiroJaEntrou) {
    return { skipped: true, error: "Tenant no paywall — período não servido não gera fatura" }
  }
  if (emPaywall && opts?.dinheiroJaEntrou) {
    console.log(JSON.stringify({
      src: "billing", kind: "fatura-emitida-para-tenant-em-paywall-porque-pagou",
      tenant: tenantId,
    }))
  }

  const period = currentPeriod(tenant.billing_day)

  const { count: dup, error: dupErr } = await supabaseAdmin
    .from("invoices").select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("period_start", period.start).neq("status", "void")
  // 🔴 FALHA NA CHECAGEM DE DUPLICATA VIRAVA "NÃO EXISTE" (F1, 11/08). `dup ?? 0` trata o
  //    erro como ausência: a função seguia em frente e EMITIA a segunda fatura do mesmo
  //    período. Sobrava só o índice único do banco — que é a última rede, não a primeira, e
  //    cobre só o caso em que ele mesmo está de pé.
  // ⚠️ Sem `skipped`: isto é falha, e conta como tal no relatório do cron. O retry do
  //    ciclo seguinte é exatamente o que se quer.
  if (dupErr) {
    console.error(JSON.stringify({ src: "billing", kind: "checagem-de-fatura-duplicada-falhou", tenant: tenantId, msg: dupErr.message }))
    return { error: `Falha ao checar fatura do período: ${dupErr.message}` }
  }
  if ((dup ?? 0) > 0) return { error: "Já existe uma fatura para este período", skipped: true }

  const { count: activeUsers, error: usersErr } = await supabaseAdmin
    .from("tenant_users").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("active", true)
  // 🔴 ERRO ⇒ ZERO USUÁRIOS ⇒ O EXCEDENTE SOME DA FATURA (F1, 11/08). `activeUsers ?? 0`
  //    não distinguia "ninguém ativo" de "não consegui contar", e o estrago não parava na
  //    fatura: o `PUT` do valor da assinatura (lá embaixo) é recalculado a partir DESTES
  //    itens, então o gateway passaria a debitar o valor menor **daí em diante**. Um blip
  //    de segundos apagava receita recorrente, em silêncio, e ela não volta sozinha.
  // 🔑 Contagem incerta ⇒ não emite. Fatura errada é irreversível na prática (o cliente já
  //    viu); fatura adiada um ciclo, não.
  if (usersErr) {
    console.error(JSON.stringify({ src: "billing", kind: "contagem-de-usuarios-falhou", tenant: tenantId, msg: usersErr.message }))
    return { error: `Falha ao contar usuários ativos: ${usersErr.message}` }
  }
  const users = activeUsers ?? 0

  const { data: charges, error: chargesErr } = await supabaseAdmin
    .from("tenant_charges").select("*").eq("tenant_id", tenantId).eq("active", true)
  // 🔴 MESMA CONSEQUÊNCIA PELOS ADICIONAIS (F1, 11/08). Erro descartado ⇒ lista vazia ⇒ o
  //    add-on RECORRENTE sumia da fatura e do valor da assinatura no gateway — e como o
  //    `PUT` recalcula do zero todo ciclo, o valor menor gravado por engano vira o novo
  //    normal. A avulsa, no mesmo silêncio, deixaria de ser sequer contada no aviso.
  if (chargesErr) {
    console.error(JSON.stringify({ src: "billing", kind: "leitura-de-cobrancas-falhou", tenant: tenantId, msg: chargesErr.message }))
    return { error: `Falha ao ler as cobranças do tenant: ${chargesErr.message}` }
  }

  const items: Array<{ kind: string; description: string; quantity: number; unit_price_cents: number; amount_cents: number }> = []
  items.push({ kind: "plan", description: `Plano ${plan.name}`, quantity: 1, unit_price_cents: plan.price_cents, amount_cents: plan.price_cents })

  const extra = Math.max(0, users - plan.user_quota)
  if (extra > 0 && plan.extra_user_price_cents > 0) {
    items.push({
      kind: "overage",
      // 🔑 A DESCRIÇÃO DIZ A FOTO E O PRAZO — decisão do dono (08/08): manter a defasagem
      //    de um ciclo e **explicar na tela**, em vez de mexer no valor no meio do período.
      //    Sem a data, o excedente vira o ticket clássico: *"eu tirei os usuários e
      //    continuei pagando"*. Com ela, a pessoa entende que a contagem é do dia do
      //    fechamento e que desativar antes do próximo já reduz.
      // ⚠️ `medido em` é a foto, não o intervalo: quem desativa depois desta data paga
      //    este ciclo e para no seguinte. É a regra que o dono escolheu por ser previsível
      //    e controlável — proporcional por dias exigiria histórico por usuário, que não
      //    existe, pra resolver um problema que ninguém levantou.
      description: `${extra} usuário(s) adicional(is) — cota ${plan.user_quota}, ativos ${users} (medido em ${period.start})`,
      quantity: extra, unit_price_cents: plan.extra_user_price_cents, amount_cents: extra * plan.extra_user_price_cents,
    })
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 🔴 A AVULSA SAI DA FATURA ATÉ EXISTIR COMO COBRAR (achado do QA, 09/08)
  // ══════════════════════════════════════════════════════════════════════════
  // Ela entrava na fatura, era marcada `active=false` ("consumida") e **nunca era cobrada
  // em lugar nenhum** — não existe `POST /payments` no repositório, e ela é excluída do
  // `PUT` do valor da assinatura de propósito (o que entra lá se repete todo mês).
  //
  // O QA viu o que eu não tinha visto: o problema não é "ainda não cobramos". É que o
  // CONSUMO torna a perda **definitiva** — ela sai da fila de `tenant_charges` e não volta
  // em ciclo nenhum. O operador cadastra R$ 150, a fatura afirma R$ 150 a mais, o cliente
  // nunca é cobrado, e a cobrança some. Ainda por cima a fatura ficava `partial` para
  // sempre, que era o gatilho do crítico nº 1.
  //
  // 🔑 Enquanto não existe caminho de cobrança, o comportamento honesto é: **não fatura e
  //    não consome**. A avulsa fica pendente e visível no god mode, o total da fatura passa
  //    a ser exatamente o que o gateway vai debitar, e nada é silenciosamente engolido.
  // ⚠️ Add-on RECORRENTE continua entrando: ele vai no valor da assinatura pelo `PUT`, ou
  //    seja, é cobrado de verdade. A assimetria é entre "cobrável" e "não cobrável", não
  //    entre tipos de cobrança.
  //
  // ⏳ PENDENTE — a peça que fecha isto de verdade: criar a cobrança no gateway
  //    (`POST /payments` com o token do cartão, idempotente por `externalReference`) e só
  //    então faturar e consumir. É código que debita cartão de cliente real e precisa de
  //    validação no sandbox antes de valer pra todo mundo.
  const avulsasPendentes: Array<{ id: string; amount_cents: number }> = []
  for (const c of (charges ?? []) as Array<{ id: string; kind: string; description: string; amount_cents: number }>) {
    if (c.kind !== "recurring_addon") {
      avulsasPendentes.push({ id: c.id, amount_cents: c.amount_cents })
      continue
    }
    items.push({
      kind: "addon",
      description: c.description, quantity: 1, unit_price_cents: c.amount_cents, amount_cents: c.amount_cents,
    })
  }
  if (avulsasPendentes.length > 0) {
    console.warn(JSON.stringify({
      src: "billing", kind: "avulsas-nao-faturadas-sem-caminho-de-cobranca",
      tenant: tenantId, quantas: avulsasPendentes.length,
      totalCents: avulsasPendentes.reduce((s, a) => s + a.amount_cents, 0),
    }))
  }

  const subtotal = items.reduce((s, i) => s + i.amount_cents, 0)

  const { data: inv, error } = await supabaseAdmin
    .from("invoices")
    .insert({
      tenant_id: tenantId, status: "open",
      period_start: period.start, period_end: period.end, due_date: period.due,
      subtotal_cents: subtotal, total_cents: subtotal, issued_at: new Date().toISOString(),
    })
    .select("id").single()
  if (error) {
    // 🔴 Rede de idempotência no BANCO (07/08). O count-check acima evita o trabalho na
    //    maioria dos casos, mas cron × pagamento podem ler `dup=0` juntos e inserir os dois.
    //    O índice único parcial `uq_invoices_tenant_period_active` transforma a 2ª inserção
    //    em 23505 — tratada aqui como o mesmo "já existe" do count path, não vaza erro cru.
    if ((error as { code?: string }).code === "23505") return { error: "Já existe uma fatura para este período", skipped: true }
    return { error: error.message }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 🔴 DAQUI PRA BAIXO, TUDO OU NADA (H-06 do pentest de 08/08)
  // ══════════════════════════════════════════════════════════════════════════
  // Eram três escritas independentes — cabeçalho, itens, consumo das avulsas — e uma falha
  // no meio deixava dois estados ruins, os DOIS irrecuperáveis pelo retry:
  //
  //   (a) fatura com `total_cents` certo e **zero linhas**. O PDF sai sem itens, e como o
  //       índice único `(tenant_id, period_start)` bloqueia recriar o cabeçalho, a própria
  //       função passa a responder "já existe uma fatura para este período" — para sempre.
  //   (b) o consumo das avulsas falhava **com o retorno descartado**: elas seguiam
  //       `active=true` e entravam DE NOVO na fatura do mês seguinte ⇒ **cobrança em dobro**.
  //
  // 🔑 Sem transação de verdade (o PostgREST não expõe uma), a saída é COMPENSAR: qualquer
  //    falha depois do cabeçalho apaga o cabeçalho. Os itens caem junto por
  //    `on delete cascade`. O retry recomeça do zero, que é o único estado de onde ele
  //    consegue recomeçar.
  // ⚠️ Apagar é seguro AQUI e só aqui: a fatura acabou de nascer, ninguém a viu, ninguém a
  //    pagou. Não é "apagar fatura" como operação de negócio.
  const desfazer = async (motivo: string) => {
    const { error: delErr } = await supabaseAdmin.from("invoices").delete().eq("id", inv.id)
    if (delErr) {
      // O caso irredutível: falhou e não conseguimos nem limpar. Grita com o id, porque
      // agora existe uma fatura pela metade que só a mão resolve.
      console.error(JSON.stringify({
        src: "billing", kind: "FATURA-PELA-METADE-limpar-a-mao",
        tenant: tenantId, invoice: inv.id, motivo, erroDaLimpeza: delErr.message,
      }))
    }
  }

  const { error: itemsErr } = await supabaseAdmin
    .from("invoice_items").insert(items.map((i) => ({ ...i, invoice_id: inv.id })))
  if (itemsErr) {
    await desfazer(`itens não inseridos: ${itemsErr.message}`)
    return { error: itemsErr.message }
  }

  // 🔴 O CONSUMO DAS AVULSAS SAIU DAQUI (QA, 09/08). Ele marcava `active=false` numa
  //    cobrança que ninguém nunca cobrava — e era o consumo, não a falta de cobrança, que
  //    tornava a perda DEFINITIVA: a avulsa saía da fila e não voltava em ciclo nenhum.
  //    Enquanto não existir caminho de cobrança, ela não é faturada nem consumida (ver o
  //    bloco de montagem dos itens). Consumir sem cobrar é apagar receita com um `update`.

  // ── O gateway passa a cobrar o que a fatura diz (H-02) ────────────────────
  //
  // 🔴 A assinatura nascia com o preço do plano e **nunca mais era tocada**. A fatura soma
  //    plano + excedente + adicionais; o cartão pagava só o plano. O excedente era
  //    entregue, virava linha no livro, era declarado quitado e sumia.
  //
  // 🔑 RECALCULADO DO ZERO, todo ciclo — é isso que o faz **descer** quando o cliente
  //    reduz a equipe (`setMemberActive` desativa, e a contagem acima já lê a mesma
  //    coluna). O risco desta abordagem nunca foi subir: é ficar preso em cima.
  //
  // ⚠️ AVULSA FICA DE FORA, de propósito. O que entra no valor da assinatura **se repete
  //    todo mês** — uma cobrança de setup viraria mensalidade eterna. Ela permanece só no
  //    nosso livro até existir cobrança separada; nada regride (hoje ela também não é
  //    cobrada), mas ninguém deve ler este código achando que ela passou a ser.
  //
  // ⚠️ Best-effort com log ALTO: a fatura acima já está correta e é ela que manda no nosso
  //    livro. Falhar aqui significa que o gateway seguirá cobrando o valor anterior — uma
  //    diferença de receita, não uma inconsistência de dado. Desfazer a fatura por causa
  //    disso seria pior.
  const recorrenteCents = items
    // 🔴 ALLOW-LIST, NUNCA DENY-LIST (§9.5 do livro-caixa, 11/08). Isto define o valor
    //    RECORRENTE que vai pro gateway — o que o cliente paga TODO MÊS. Com `!== "oneoff"`,
    //    qualquer tipo novo entrava por omissão, e o primeiro deles já seria desastre:
    //    `discount` (a cortesia que o dono escolheu em 11/08) é linha NEGATIVA de UM mês —
    //    somada aqui, ela viraria a mensalidade permanente. Cortesia de um mês baixaria o
    //    preço do cliente PARA SEMPRE, e ninguém perceberia até o fim do ano.
    // 🔑 A lista positiva obriga quem criar um tipo novo a decidir conscientemente se ele é
    //    recorrente. Esquecer passa a significar "fica de fora", que é o lado seguro.
    .filter((i) => ["plan", "overage", "addon"].includes(i.kind))
    .reduce((s, i) => s + i.amount_cents, 0)
  if (recorrenteCents > 0) {
    const r = await atualizarValorDaAssinatura(tenantId, recorrenteCents)
    if ("error" in r) {
      console.error(JSON.stringify({
        src: "billing", kind: "fatura-emitida-mas-assinatura-nao-atualizada",
        tenant: tenantId, invoice: inv.id, valorCents: recorrenteCents,
      }))
    }
  }

  return { id: inv.id }
}

/**
 * Geração mensal automática: para cada tenant ativo cujo billing_day == hoje
 * (UTC), com plano e assinatura não-cancelada, gera a fatura do período.
 * Idempotente (a guarda por período evita duplicar se rodar 2x).
 */
export async function runMonthlyBilling(): Promise<{ generated: number; skipped: number; failed: number; details: Array<{ tenantId: string; status: string; reason?: string }> }> {
  const todayDay = new Date().getUTCDate()

  const { data: tenants, error: varreduraErr } = await supabaseAdmin
    .from("tenants")
    .select("id, billing_day, subscription_status, plan_id")
    .eq("active", true)
    .eq("billing_day", todayDay)
    .not("plan_id", "is", null)
    .neq("subscription_status", "canceled")
    // 🔴 SÓ QUEM É COBRADO PELO GATEWAY (2026-08-05). A ausência deste filtro era um
    //    bug, e o próprio desenho já dizia por quê: *"`manual` → só o god mode governa,
    //    **nunca a automação**"* (docs/asaas-billing-design.md §2). Este cron é automação.
    // ⚠️ O estrago era silencioso e progressivo: cliente `manual` (cortesia, contrato
    //    especial, sócio) não tem cartão no gateway, então a fatura gerada aqui **nunca
    //    receberia pagamento**. Ela ficaria `open`, viraria `overdue` na tela em 7 dias, o
    //    degrau cairia pra `grace` e a plataforma passaria a acusar de inadimplente
    //    justamente quem foi isentado de propósito.
    // ⚠️ Faturar cliente manual continua POSSÍVEL — pela mão, no god mode
    //    (`admin-billing.ts`), que é onde a decisão dele mora. O que sai é a automação.
    .eq("billing_mode", "gateway")

  // 🔴 VARREDURA VAZIA ERA INDISTINGUÍVEL DE "NINGUÉM PRA FATURAR" (F1, 11/08). Com o
  //    `error` descartado, uma falha nesta leitura fazia o laço rodar ZERO vezes e o job
  //    responder `generated: 0, failed: 0` — status **ok** no livro de execuções e 200 na
  //    rota. Ou seja: o dia inteiro de vencimentos não é faturado e o sistema declara
  //    sucesso. Ninguém investiga um job que deu certo, e o mês só reaparece no caixa.
  // 🔑 Lançar é o único canal que este job tem pra dizer "não rodei": `executarJob` fecha a
  //    corrida como `failed` com a mensagem e relança, a rota devolve erro e o pg_cron
  //    enxerga. Devolver `failed: 1` seria contar um tenant que nem chegou a ser lido.
  if (varreduraErr) {
    console.error(JSON.stringify({ src: "billing", kind: "varredura-de-faturamento-falhou", dia: todayDay, msg: varreduraErr.message }))
    throw new Error(`Varredura de faturamento falhou: ${varreduraErr.message}`)
  }

  const details: Array<{ tenantId: string; status: string; reason?: string }> = []
  let generated = 0, skipped = 0, failed = 0

  for (const t of (tenants ?? []) as Array<{ id: string }>) {
    const r = await generateInvoiceForTenant(t.id)
    if (r.id)            { generated++; details.push({ tenantId: t.id, status: "generated" }) }
    else if (r.skipped)  { skipped++;   details.push({ tenantId: t.id, status: "skipped", reason: r.error }) }
    else                 { failed++;    details.push({ tenantId: t.id, status: "failed", reason: r.error }) }
  }

  return { generated, skipped, failed, details }
}
