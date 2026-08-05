import "server-only"
import { cache } from "react"
import { supabaseAdmin } from "@/lib/supabase"
import {
  isTenantBlockedForAccess,
  isTenantBlockedForSpend,
  normalizeState,
  PAST_DUE_GRACE_DAYS,
} from "@/lib/lifecycle-shared"

// ═══════════════════════════════════════════════════════════════════════════
// EM QUE PÉ ESTÁ ESTE CLIENTE — fonte ÚNICA do degrau da escada de cobrança
// ═══════════════════════════════════════════════════════════════════════════
// docs/access-revocation-design.md §2 (a escada ratificada pelo dono, 2026-08-03).
//
// Mesmo padrão de `visibility.ts`: UMA regra, UM módulo, todo mundo importa. Hoje a
// resposta "ele está em que degrau e o que parou?" só existia espalhada —
// `lifecycle_state`, `subscription_status`, `isTenantBlockedForSpend`,
// `checkTenantStatus`, faturas vencidas. Seis componentes de UI e quatro telas vão
// precisar dela. **Se cada um recalcular, divergem** — foi exatamente assim que o
// predicado de bloqueio virou duas cópias e criou o defeito da §3 do design (o
// mesmo `lifecycle_state` corrompido liberava o login e barrava o consumo).
//
// 🔴 ESTE MÓDULO NÃO É UM GATE. Ele não decide nada: produz TEXTO PRA TELA. Quem
//    decide se a mensagem entra / se a IA roda / se a campanha dispara continua sendo
//    `checkTenantStatus` (auth/tenant-serviceable.ts), e é ele que a política enforça.
//    Este módulo só DESCREVE, em português, o que aqueles gates já fazem.
//
// 🔴 POR ISSO O `degrau` DESCREVE O QUE É ENFORÇADO, NUNCA O QUE "DEVERIA" ESTAR.
//    Se a tela disser "IA pausada" e a IA responder, o cliente aprende em uma semana
//    que aviso da Kora é decorativo — e aí nenhum aviso vale (§7.5 do design; os dois
//    PMs do financeiro chegaram nisso de forma independente). A consequência prática
//    está no ramo `grace` mais abaixo: atraso além da carência SEM ninguém ter marcado
//    `past_due` continua sendo "grace", porque nada foi cortado de fato.
//
// 🔒 ZERO CÓPIA DA REGRA: os predicados vêm de `lifecycle-shared.ts` — os MESMOS que o
//    login, a revalidação de sessão, os 3 webhooks, os 4 crons e as 4 rotas do widget
//    usam. Este arquivo mapeia predicado → degrau → rótulo; ele não reimplementa
//    "está bloqueado?" em lugar nenhum. Mudou a política? Muda lá, e aqui só o rótulo.

/**
 * ⚠️ `"trial"` NÃO é um degrau da escada de inadimplência — é o estado ANTERIOR a ela:
 *    o cliente não deve nada, e mesmo assim tem um prazo que, vencido, corta o acesso.
 *    Entrou aqui (e não num campo à parte) porque as TRÊS superfícies de aviso que já
 *    existem — a frase da tela de assinatura, o banner do topo e o item do sino — todas
 *    despacham por `degrau`. Um campo separado obrigaria a ensinar as três de novo, e
 *    quem esquecesse uma criaria justamente o silêncio que este trabalho veio fechar.
 */
/**
 * ⚠️ `trial_ended` É UM DEGRAU PRÓPRIO, e não um apelido de `restricted` (correção do
 *    dono, 2026-08-05). A 1ª versão reusou `restricted` achando que o enforcement era o
 *    mesmo — não é, e a tela denunciou: o cliente em teste vencido lia *"Campanhas,
 *    automações e IA estão pausadas. Seu atendimento e seus dados seguem no ar"*, que é a
 *    linguagem de quem **já é cliente e atrasou uma fatura**.
 *    A diferença é de natureza: quem paga e atrasou tem **carência** (o produto segue de
 *    pé enquanto a régua roda); quem testou e não assinou **nunca comprou nada** — o teste
 *    acabou e o produto para até ativar. Tratar os dois igual dá carência a quem nunca
 *    pagou e soa como cobrança pra quem nem virou cliente.
 */
export type BillingDegrau = "trial" | "trial_ended" | "ok" | "grace" | "restricted" | "readonly" | "terminated"

export interface BillingStanding {
  degrau: BillingDegrau
  /**
   * A fatura em aberto mais ANTIGA (é a que ele tem que pagar). `daysOverdue = 0`
   * quando ainda não venceu — a fatura pendente também interessa pra tela ("vence
   * dia X"). `null` = nenhuma fatura em aberto **ou** a consulta falhou (ver log).
   */
  invoice: { id: string; totalCents: number; dueDate: string; daysOverdue: number } | null
  /** Rótulos PT-BR de RESULTADO do que parou. Nunca slug de módulo. */
  paused: string[]
  /** Rótulos do que continua funcionando — a metade que segura o cliente. */
  continues: string[]
  /** `YYYY-MM-DD` do próximo fechamento, ou `null` quando indeterminável (ver §nextClosing). */
  nextClosingAt: string | null
  /**
   * Preenchido SÓ no degrau `trial`.
   *
   * 🔴 POR QUE ISTO EXISTE (2026-08-04). A tela dizia **"Tudo certo. Sua assinatura está
   *    em dia"** pra uma conta em teste de 2 dias que seria SUSPENSA no vencimento, sem
   *    nenhum aviso antes. A tela que existe pra evitar surpresa era a que produzia a
   *    surpresa — e, como todo cliente novo entra por trial, isso valia pra 100% deles.
   * ⚠️ `podeAssinar` é o que separa "clique aqui e pague" de "você ainda NÃO CONSEGUE
   *    pagar": sem documento, CEP e número, a tokenização do cartão falha. Mandar a pessoa
   *    pro checkout num estado que a gente já sabe que quebra é queimar a única chance.
   */
  trial: { endsAt: string; diasRestantes: number; podeAssinar: boolean } | null
}

// ── Rótulos: derivados dos GATES que existem, não de opinião ────────────────────
//
// Cada item de `paused` foi conferido num gate real de `canSpend` (degrau 3):
//   • Campanhas ................ campaigns/engine.ts:314  (template pago da Meta)
//   • Inteligência artificial .. ai-v2/dispatch.ts:46      (LLM na nossa chave)
//   • Automações ............... automation/dispatch.ts:57 (boas-vindas/fora de horário)
//                                automation/keyword-engine.ts:93 (gatilho de palavra)
//                                api/studio/cron/resume:40 · ai-v2/flow/inactivity.ts:62
//   • Lembretes da agenda ...... agenda/reminders.ts:365
//   • Chat do site ............. api/site/config/[slug]:47 devolve `enabled:false`
//                                ⇒ o widget nem RENDERIZA no site do cliente.
//
// E cada item de `continues` idem, do lado do `canAccess`:
//   • Acesso ao sistema ........ login NUNCA olha assinatura (isTenantBlockedForAccess).
//   • Recebimento de mensagens . os 3 webhooks descartam por `canAccess`, não por gasto
//                                (foi o achado que inverteu a escada — §7.5 do design).
//   • Atendimento manual ....... `sendMessage`/`sendChatMedia` não têm gate de status:
//                                fronteira declarada do degrau 3 ("ele toca o negócio na mão").
//   • Histórico e relatórios ... nenhum caminho de LEITURA é gateado, de propósito
//                                (tenant-serviceable.ts:22 — cliente que não vê o histórico
//                                pra decidir se paga é churn garantido).
//   • Exportação dos seus dados  LGPD Art. 18 II — sempre liberada, em todo degrau.
/**
 * O que para, **por módulo**. A lista mostrada ao cliente é filtrada pelo que ele
 * realmente tem ligado.
 *
 * 🔴 ANTES ERA UM ARRAY FIXO (correção do dono, 2026-08-05). Todo cliente lia a mesma
 *    lista, tivesse ou não o módulo: a Calla via *"Inteligência artificial — PAUSADO"*
 *    sem nunca ter tido IA no plano. Anunciar a perda de algo que a pessoa não tem é
 *    duplamente ruim: mente sobre o produto dela e transforma o aviso em ruído, porque
 *    ela aprende que a lista não fala com ela.
 * ⚠️ Um rótulo pode depender de VÁRIOS módulos (basta UM pra ele existir): "Automações"
 *    cobre boas-vindas, palavra-chave e fluxos do Studio — quem tem qualquer um deles
 *    perde automação de verdade.
 */
const PAUSADO_POR_MODULO: { label: string; modulos: string[] }[] = [
  { label: "Campanhas",                          modulos: ["broadcasts"] },
  { label: "Inteligência artificial",            modulos: ["ai"] },
  { label: "Automações e respostas automáticas", modulos: ["welcome_message", "keyword_triggers", "ai_studio"] },
  { label: "Lembretes da agenda",                modulos: ["agenda_reminders"] },
  { label: "Chat do site",                       modulos: ["widget_site"] },
]
const CONTINUES_RESTRICTED = [
  "Acesso ao sistema",
  "Recebimento de mensagens",
  "Atendimento manual no WhatsApp",
  "Histórico e relatórios",
  "Exportação dos seus dados",
]

// 🔴 DIVERGÊNCIA CONHECIDA — degrau 4 na política × degrau 4 no código.
//    A política (§2) diz que "bloqueio" mantém **leitura + exportação**. O código NÃO
//    faz isso: `suspended` cai em `isTenantBlockedForAccess` ⇒ o login é negado e os 3
//    webhooks DESCARTAM o inbound. Ou seja, hoje o degrau 4 é enforçado como um corte
//    de acesso, não como somente-leitura.
//    Os rótulos abaixo descrevem o CÓDIGO, não a política, porque é a regra deste módulo
//    (ver o cabeçalho): prometer "você ainda pode ler seu histórico" pra quem não
//    consegue nem entrar é exatamente o aviso decorativo que a §7.5 manda evitar.
//    ⚠️ Isso é dívida de PRODUTO registrada, não bug deste arquivo: ou a política muda,
//    ou o enforcement de `suspended` passa a deixar entrar em modo leitura.
const PAUSADO_AO_BLOQUEAR = ["Entrada no sistema", "Recebimento de novas mensagens"]

const DAY_MS = 86_400_000

/**
 * Status de fatura que contam como "em aberto".
 *
 * ⚠️ `overdue` está no vocabulário do tipo (`InvoiceStatus`, admin-billing.ts:20) mas
 * **NENHUM caminho do código escreve esse valor** — só `open`, `paid` e `void` são
 * escritos de fato. Por isso o atraso é medido por `due_date`, nunca por status: quem
 * confiasse no status veria "0 faturas vencidas" para sempre.
 * `draft` fica de fora (não foi emitida); `void` e `paid` idem, pelo óbvio.
 */
const UNPAID_STATUSES = ["open", "overdue"]

/** Meia-noite UTC de hoje — mesma base de tempo de `currentPeriod`/`runMonthlyBilling`. */
function todayUtcMs(): number {
  const n = new Date()
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())
}

/** `YYYY-MM-DD[...]` → meia-noite UTC daquele dia. `null` se o formato não bater. */
function dateOnlyUtcMs(raw: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (!m) return null
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(ms) ? ms : null
}

/**
 * Próximo fechamento — a data em que `runMonthlyBilling` geraria a fatura deste cliente.
 *
 * 🔴 `null` é resposta honesta, não falha: sem `billing_day` **não existe** data de
 *    fechamento pra devolver, e chutar "daqui a 30 dias" seria inventar um compromisso
 *    comercial. Medido em 2026-08-04: **3 dos 4 clientes de produção têm `billing_day`
 *    NULO** — o `null` aqui é o caso comum, não a exceção. A tela precisa saber lidar.
 *
 * Elegibilidade espelha o filtro do próprio cron (billing.ts:167-172): tenant `active`,
 * COM plano e assinatura ≠ `canceled`. Sem plano não há o que faturar — e
 * `generateInvoiceForTenant` recusa com "Tenant sem plano atribuído".
 *
 * ⚠️ O clamp 1..28 é o de `currentPeriod` (billing.ts:72): dia 29-31 não existe em todo
 *    mês. Se algum dia entrar um `billing_day` fora da faixa (a action valida 1..28, o
 *    banco não), a data devolvida aqui é a mesma que o cron usaria — nunca outra.
 *
 * ⚠️ Base UTC, como todo o motor de cobrança. Entre 21h e 24h de Brasília a data vira
 *    um dia antes do que o calendário local mostra. Aceito pra não criar uma 2ª noção
 *    de "hoje" divergente da que gera a fatura (o erro seria de 1 dia, mas em 2 lugares).
 */
/** Dias inteiros até `iso`, chão em 0. Base UTC, como o resto do motor de cobrança. */
function diasAte(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now()
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000)
}

function nextClosing(billingDay: number | null, billable: boolean): string | null {
  if (!billable || billingDay == null) return null
  const day = Math.min(Math.max(billingDay, 1), 28)
  const now = new Date()
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate()
  // No próprio dia do fechamento o período de hoje já virou — o PRÓXIMO é o mês que vem.
  // Mesma fronteira de `currentPeriod` (`d < day` ⇒ o período corrente começou mês passado).
  return new Date(d < day ? Date.UTC(y, m, day) : Date.UTC(y, m + 1, day))
    .toISOString().slice(0, 10)
}

/**
 * Resposta neutra: "nada a dizer". Arrays NOVOS a cada chamada de propósito — o
 * retorno vai direto pra UI e uma constante de módulo compartilhada viraria estado
 * global se alguém desse `push` nela.
 */
function silentStanding(): BillingStanding {
  return { degrau: "ok", invoice: null, paused: [], continues: [], nextClosingAt: null, trial: null }
}

interface TenantBillingRow {
  active:              boolean | null
  lifecycle_state:     string | null
  subscription_status: string | null
  billing_day:         number | null
  trial_ends_at:       string | null
  asaas_subscription_id: string | null
  plan_id:             string | null
}
interface InvoiceRow {
  id:          string
  status:      string | null
  due_date:    string | null
  total_cents: number | null
}

/**
 * Em que degrau da escada este cliente está, e o que isso pausou.
 *
 * Memoizado por request (React `cache`, mesmo padrão de `hasModule`): banner do topo,
 * card da assinatura, aviso do Studio e a tela de cobrança na mesma renderização custam
 * **duas** consultas no total, não duas por componente.
 *
 * 🔴 FAIL-**OPEN** COM HONESTIDADE — e é o INVERSO do gate de gasto, de propósito.
 *    Erro de consulta ⇒ `degrau: "ok"` + `console.error`. Em `tenant-serviceable.ts` o
 *    fail-closed é obrigatório porque o resultado ali é DINHEIRO (mandar mensagem paga,
 *    chamar LLM): errar servindo custa centavos, mas errar bloqueando derruba o WhatsApp
 *    de quem paga. Aqui o resultado é **texto na tela**: um blip de banco viraria
 *    "sua conta foi restringida" pra um cliente adimplente — acusação falsa de
 *    inadimplência, que gera ticket, desconfiança e, com sorte, um print no Twitter.
 *    Nenhum acesso é concedido por este `"ok"`: quem concede são os gates, e eles
 *    continuam fail-closed. O custo do erro aqui é silêncio; lá é dinheiro.
 *    ⚠️ Silêncio não pode ser invisível pra NÓS — daí o `console.error` em todo ramo.
 */
export const getBillingStanding = cache(async (tenantId: string): Promise<BillingStanding> => {
  if (!tenantId) return silentStanding()

  const [tenantRes, perfilRes, modRes, invRes] = await Promise.all([
    supabaseAdmin
      .from("tenants")
      .select("active, lifecycle_state, subscription_status, billing_day, plan_id, trial_ends_at, asaas_subscription_id")
      .eq("id", tenantId)
      .maybeSingle(),
    // Mesmos 5 campos que `getTitularParaCobranca` exige — se divergirem, a tela promete
    // um botão de pagar que o gate recusa depois.
    supabaseAdmin
      .from("tenant_billing_profile")
      .select("legal_name, tax_id, billing_email, zip, number")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabaseAdmin
      .from("tenant_modules")
      .select("module_slug")
      .eq("tenant_id", tenantId)
      .eq("enabled", true),
    supabaseAdmin
      .from("invoices")
      .select("id, status, due_date, total_cents")
      .eq("tenant_id", tenantId)
      .in("status", UNPAID_STATUSES)
      // ASC = a mais antiga primeiro (é a que ele tem que pagar). NULL vai pro fim no
      // Postgres, então a primeira COM vencimento aparece antes de qualquer sem.
      .order("due_date", { ascending: true })
      .limit(24),
  ])

  if (tenantRes.error) {
    console.error("[billing-standing] consulta do tenant falhou:", tenantId, tenantRes.error.message)
    return silentStanding()
  }
  const row = tenantRes.data as TenantBillingRow | null
  if (!row) {
    // Não é blip: é id que não existe. Cala na tela, grita no log.
    console.error("[billing-standing] tenant inexistente:", tenantId)
    return silentStanding()
  }

  // ── A fatura ────────────────────────────────────────────────────────────────
  const today = todayUtcMs()
  let invoice: BillingStanding["invoice"] = null

  if (invRes.error) {
    // Degrada só o campo `invoice`; o degrau continua saindo do status do tenant.
    console.error("[billing-standing] consulta de faturas falhou:", tenantId, invRes.error.message)
  } else {
    let withoutDueDate = 0
    for (const r of (invRes.data ?? []) as InvoiceRow[]) {
      const raw = r.due_date
      const due = raw ? dateOnlyUtcMs(raw) : null
      if (!raw || due == null) { withoutDueDate++; continue }
      invoice = {
        id:          r.id,
        totalCents:  r.total_cents ?? 0,
        dueDate:     raw.slice(0, 10),
        daysOverdue: Math.max(0, Math.floor((today - due) / DAY_MS)),
      }
      break
    }
    // `due_date` é NULLABLE no banco. Toda fatura gerada por `generateInvoiceForTenant`
    // tem vencimento, então isto só aparece por linha manual/legada — e uma fatura sem
    // vencimento é invisível pra esta função (não dá pra dizer se atrasou).
    if (withoutDueDate > 0) {
      console.warn("[billing-standing] faturas em aberto SEM due_date, ignoradas:", tenantId, withoutDueDate)
    }
  }

  // ── O degrau ────────────────────────────────────────────────────────────────
  // Mesmos predicados de `checkTenantStatus` — importados, não recopiados.
  // Módulos LIGADOS — alimentam a lista do que realmente para pra este cliente.
  // ⚠️ Falha de consulta ⇒ conjunto vazio ⇒ a lista sai VAZIA em vez de genérica. Preferir
  //    não listar a listar errado: uma lista genérica volta a prometer perdas que a pessoa
  //    não tem, que é exatamente o defeito que este trecho veio consertar.
  const modulos = new Set<string>(
    modRes.error ? [] : ((modRes.data ?? []) as { module_slug: string }[]).map((m) => m.module_slug),
  )
  if (modRes.error) console.error("[billing-standing] consulta de módulos falhou:", tenantId, modRes.error.message)

  const perfil = (perfilRes.error ? null : perfilRes.data) as Record<string, string | null> | null
  if (perfilRes.error) {
    // Degrada só o `podeAssinar` (vira false ⇒ manda completar cadastro). Fail-closed é o
    // lado certo aqui: pior que pedir um cadastro já completo é mandar pro cartão quem
    // não consegue pagar.
    console.error("[billing-standing] consulta do perfil falhou:", tenantId, perfilRes.error.message)
  }

  // ⚠️ Teste é `trialing` **com data futura** — e SEM assinatura no gateway. Quem já pôs o
  //    cartão durante o teste não está mais "em teste que vai cortar": a cobrança já está
  //    armada pro dia do vencimento, e avisar "seu acesso será interrompido" seria mentira
  //    que faz o cliente que ACABOU de pagar achar que o pagamento não pegou.
  const emTrial =
    normalizeState(row.lifecycle_state) === "trialing" &&
    !!row.trial_ends_at &&
    new Date(row.trial_ends_at).getTime() > Date.now() &&
    !row.asaas_subscription_id

  const canAccess = row.active === true && !isTenantBlockedForAccess(row.lifecycle_state)
  const canSpend  = canAccess && !isTenantBlockedForSpend(row.lifecycle_state, row.subscription_status)

  let degrau: BillingDegrau
  if (!canAccess) {
    // `deactivated` = fim de relação (degrau 5). Todo o resto que nega acesso —
    // `suspended`, `pending_approval`, lifecycle desconhecido (fail-closed do
    // `normalizeState`) e o legado `active=false` — é degrau 4: reversível, a relação
    // não acabou. A distinção importa porque "Conta encerrada" afirma um fim que não
    // aconteceu, e o caminho de volta é diferente (reativar × recontratar).
    // ⚠️ `pending_approval` (cadastro ainda não aprovado) não tem degrau próprio na
    //    escada — cai em `readonly` por ser o mais próximo: sem acesso, nada gasta,
    //    dado intacto. É o único degrau atribuído por aproximação neste módulo.
    degrau = normalizeState(row.lifecycle_state) === "deactivated" ? "terminated" : "readonly"
  } else if (!canSpend) {
    // Degrau 3 — `past_due` OU `canceled`. São causas diferentes com o MESMO
    // enforcement (corta gasto, mantém acesso), e o degrau descreve enforcement.
    degrau = "restricted"
  } else if (invoice && invoice.daysOverdue > 0) {
    // Degrau 2 — venceu e **nada foi cortado**. É a verdade do sistema hoje: o único
    // escritor de `past_due` é a mão do admin (admin-billing.ts:52), porque o cron de
    // cobrança existe no código e nunca foi agendado.
    //
    // 🔴 NÃO escalo pra `restricted` quando `daysOverdue > PAST_DUE_GRACE_DAYS`, por
    //    mais tentador que seja: a IA, as campanhas e as automações continuariam
    //    rodando (nenhum gate olha `due_date`), e a tela estaria mentindo. Escalar aqui
    //    é trocar um problema de cobrança por um aviso que o cliente aprende a ignorar.
    //    O lugar de escalar é a TRANSIÇÃO pra `past_due` — no job de cobrança, onde a
    //    carência mora por decisão (lifecycle-shared.ts:106).
    degrau = "grace"
    if (invoice.daysOverdue > PAST_DUE_GRACE_DAYS) {
      // Sinal pra NÓS: passou da carência e ninguém cortou. Sem o cron, este log é o
      // único lugar onde isso aparece.
      console.warn(
        "[billing-standing] atraso além da carência sem past_due:",
        tenantId, `${invoice.daysOverdue}d > ${PAST_DUE_GRACE_DAYS}d`,
      )
    }
  } else if (normalizeState(row.lifecycle_state) === "trial_ended") {
    degrau = "trial_ended"
  } else if (emTrial) {
    // ── Degrau 0 — o teste ────────────────────────────────────────────────────
    // Vem DEPOIS de toda a escada de inadimplência de propósito: se por algum caminho
    // um tenant em teste tiver fatura vencida ou gasto cortado, esse fato é mais
    // urgente que o prazo do teste e deve vencer a frase da tela.
    degrau = "trial"
  } else {
    degrau = "ok"
  }

  // ── Rótulos ─────────────────────────────────────────────────────────────────
  // `ok` e `grace` devolvem as DUAS listas vazias: no degrau 2 nada mudou de fato
  // ("aviso no app, tudo funciona" — §2), e listar o que continua sugeriria que algo
  // parou. `paused.length === 0` é o sinal de "nada foi cortado ainda".
  let paused: string[] = []
  let continues: string[] = []
  // Só o que o tenant REALMENTE tem — ver `PAUSADO_POR_MODULO`.
  const paraDeVerdade = PAUSADO_POR_MODULO
    .filter((p) => p.modulos.some((m) => modulos.has(m)))
    .map((p) => p.label)

  if (degrau === "trial_ended") {
    // 🔴 TESTE ACABOU: para TUDO que o produto faz, e não há carência — carência é pra
    //    quem já pagou e atrasou. O que "continua" aqui é só o mínimo pra ele decidir:
    //    entrar pra ativar, e levar os dados embora se não quiser (LGPD Art. 18, sempre).
    paused = [...paraDeVerdade, "Atendimento pelo WhatsApp"]
    continues = ["Ativar sua assinatura", "Exportação dos seus dados"]
  } else if (degrau === "restricted") {
    paused = paraDeVerdade
    continues = [...CONTINUES_RESTRICTED]
  } else if (degrau === "readonly") {
    paused = [...PAUSADO_AO_BLOQUEAR, ...paraDeVerdade]
    continues = ["Seus dados continuam guardados"]
  } else if (degrau === "terminated") {
    paused = [...PAUSADO_AO_BLOQUEAR, ...paraDeVerdade]
    continues = ["Seus dados continuam guardados pelo prazo de retenção"]
  }

  return {
    degrau,
    invoice,
    paused,
    continues,
    // 🔴 OS DOIS degraus (correção 2026-08-05). Vinha só no `trial`, e o efeito bateu na
    //    tela: com o teste JÁ ENCERRADO o campo era `null`, `podeAssinar` virava
    //    `undefined`, e o modal mandava TODO MUNDO completar cadastro — inclusive quem
    //    já tinha o cadastro completo. Justo no degrau em que a pessoa mais precisa do
    //    caminho curto pro pagamento, ela levava um desvio inútil.
    trial: (degrau === "trial" || degrau === "trial_ended") && row.trial_ends_at
      ? {
          endsAt: row.trial_ends_at,
          diasRestantes: diasAte(row.trial_ends_at),
          // ⚠️ MESMOS 5 campos de `getTitularParaCobranca`. Se um dia divergirem, a tela
          //    oferece "Ativar assinatura" e o gate do pagamento recusa na cara da pessoa.
          podeAssinar: Boolean(perfil?.legal_name && perfil?.tax_id && perfil?.billing_email && perfil?.zip && perfil?.number),
        }
      : null,
    nextClosingAt: nextClosing(
      row.billing_day,
      row.active === true && !!row.plan_id && row.subscription_status !== "canceled",
    ),
  }
})
