import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
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
  const [{ data: tenants }, { data: plans }, { data: activeUsers }, { data: recurring }] = await Promise.all([
    supabaseAdmin.from("tenants").select("id, plan_id, subscription_status").eq("active", true),
    supabaseAdmin.from("plans").select("id, name, price_cents, user_quota, extra_user_price_cents"),
    supabaseAdmin.from("tenant_users").select("tenant_id").eq("active", true),
    supabaseAdmin.from("tenant_charges").select("tenant_id, amount_cents").eq("kind", "recurring_addon").eq("active", true),
  ])

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
export async function generateInvoiceForTenant(tenantId: string): Promise<{ error?: string; id?: string; skipped?: boolean }> {
  const { data: tenant } = await supabaseAdmin
    // As 4 colunas extras alimentam a guarda de paywall logo abaixo — a linha já era lida.
    .from("tenants")
    .select("id, plan_id, billing_day, lifecycle_state, subscription_status, past_due_since, past_due_grace_days")
    .eq("id", tenantId).maybeSingle()
  if (!tenant)         return { error: "Tenant não encontrado" }
  if (!tenant.plan_id) return { error: "Tenant sem plano atribuído" }

  const { data: plan } = await supabaseAdmin.from("plans").select("*").eq("id", tenant.plan_id).maybeSingle()
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
  )
  if (emPaywall) {
    return { skipped: true, error: "Tenant no paywall — período não servido não gera fatura" }
  }

  const period = currentPeriod(tenant.billing_day)

  const { count: dup } = await supabaseAdmin
    .from("invoices").select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("period_start", period.start).neq("status", "void")
  if ((dup ?? 0) > 0) return { error: "Já existe uma fatura para este período", skipped: true }

  const { count: activeUsers } = await supabaseAdmin
    .from("tenant_users").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("active", true)
  const users = activeUsers ?? 0

  const { data: charges } = await supabaseAdmin
    .from("tenant_charges").select("*").eq("tenant_id", tenantId).eq("active", true)

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
    .filter((i) => i.kind !== "oneoff")
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

  const { data: tenants } = await supabaseAdmin
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
