// ═══════════════════════════════════════════════════════════════
// Ciclo de vida do cliente (tenant) — máquina de estados ÚNICA.
// ═══════════════════════════════════════════════════════════════
// Fonte compartilhada UI ↔ backend: a UI renderiza botões a partir de
// TRANSITIONS e o backend (lifecycle-admin.ts) valida contra o MESMO mapa.
// Zero drift — nunca aparece um botão que o servidor recusa.
//
// Estados (tenants.lifecycle_state):
//   pending_approval → trialing → active → (suspended ↔) → deactivated
//   NULL legado = tratado como 'active' (clientes pré-trial / pagos).

export type LifecycleState =
  | "pending_approval"
  | "trialing"
  /**
   * Teste terminou e ninguém pagou — **a porta de pagar fica ABERTA** (2026-08-05).
   *
   * 🔴 O QUE ISTO CONSERTA. Antes, o fim do teste ia direto pra `suspended`, e
   *    `suspended` nega login. Efeito medido no código: `login-core` devolvia `null`, que
   *    a tela mostra como **erro genérico de credencial** — a pessoa que queria pagar
   *    recebia exatamente a mesma resposta de quem digitou a senha errada. Sem aviso, sem
   *    plano, sem botão. O momento de maior intenção de compra do funil terminava numa
   *    porta sem maçaneta, e o único caminho de volta era ligar pro suporte.
   *    Isso contrariava a própria política ratificada (*"a tela onde ele paga fica DENTRO
   *    do sistema"*), que tinha sido aplicada só ao `subscription_status` — o fim do trial
   *    escapava por `lifecycle_state`, a alavanca que corta acesso.
   *
   * ⚠️ **NÃO entra em `BLOCKED_LIFECYCLE`**: quem decide quem entra aqui é o PAPEL, e
   *    `BLOCKED_LIFECYCLE` é sobre o tenant, não sobre a pessoa. Ver `isTenantBlockedForAccessAs`.
   */
  | "trial_ended"
  | "active"
  | "suspended"
  | "deactivated"

export type LifecycleAction =
  | "approve"      // pendente → trialing|active (inicia o relógio do trial)
  | "reject"       // pendente → deactivated
  | "extend"       // trialing → trialing (+N dias)
  | "end_trial"    // trialing → trial_ended (teste venceu; porta de pagar segue aberta)
  | "start_trial"  // active|suspended|deactivated → trialing (N dias de acesso)
  | "activate"     // trialing|suspended|deactivated → active (pago, sem prazo)
  | "suspend"      // trialing|active → suspended
  | "reactivate"   // suspended|deactivated → active
  | "deactivate"   // active|suspended → deactivated

/**
 * Os 6 estados conhecidos — fonte do parse (não repetir a lista em switch).
 *
 * 🔴 ESTA LISTA É RUNTIME, o `type LifecycleState` é compile-time — e a diferença
 *    morde. Ao adicionar `trial_ended` eu mexi só no tipo; o `tsc` ficou verde e o
 *    comportamento ficou **invertido**: `normalizeState("trial_ended")` caía no
 *    fail-closed e devolvia `suspended`, ou seja, o estado criado pra MANTER o dono
 *    dentro trancava todo mundo pra fora. Peguei rodando a matriz de acesso de verdade
 *    (owner/admin/agent × cada estado) — nenhum typecheck acusaria isso.
 * ⚠️ Estado novo entra AQUI e no `type`, sempre nos dois.
 */
const KNOWN_STATES: ReadonlySet<string> = new Set<LifecycleState>([
  "pending_approval", "trialing", "trial_ended", "active", "suspended", "deactivated",
])

/**
 * Estado usado quando o banco traz um valor que este código NÃO conhece.
 *
 * 🔒 Fail-CLOSED (era `active` até 2026-08-03 — fail-OPEN). Um estado desconhecido
 * (typo, migration parcial, estado novo gravado ANTES do deploy do código que o
 * entende) virava "Ativo" e passava em todo gate derivado. Numa máquina de estados
 * que decide acesso, o desconhecido tem que NEGAR.
 *
 * Por que `suspended` e não `deactivated`: os dois negam acesso igualmente
 * (ambos em BLOCKED_LIFECYCLE), mas "Suspenso / Acesso bloqueado" é honesto pra um
 * dado que não entendemos, enquanto "Desativado / Conta encerrada" afirma um fim de
 * relação que não aconteceu. E o conjunto de transições de `suspended` é o mais rico
 * (reativar / trial / desativar), então o god mode tem saída pra qualquer lado.
 */
export const UNKNOWN_LIFECYCLE_FALLBACK: LifecycleState = "suspended"

/** `true` se o valor cru do banco é um dos 6 estados que este código entende. */
export function isKnownLifecycleState(s: string | null | undefined): s is LifecycleState {
  return typeof s === "string" && KNOWN_STATES.has(s)
}

const warnedStates = new Set<string>()

/**
 * Normaliza o valor cru do banco.
 *
 *  • Estado conhecido → ele mesmo.
 *  • NULL / "" → `active`. **Legado documentado, NÃO é o default do desconhecido:**
 *    são os tenants criados antes da coluna existir. ⚠️ Verificado em produção
 *    (2026-08-03): `Blue Digital Hub` está exatamente assim. Fechar este ramo
 *    tranca um cliente real — e o dono — pra fora.
 *  • Qualquer outro valor → UNKNOWN_LIFECYCLE_FALLBACK (bloqueia).
 *
 * Não LANÇA de propósito: `normalizeState` roda por LINHA na lista do god mode
 * (client component, `admin/tenants/client.tsx:82,88,144,214`). Lançar transformaria
 * uma única linha corrompida em tela branca pro admin — trocar um fail-open por um
 * DoS de painel não é upgrade. O `console.warn` (uma vez por valor) é o sinal.
 */
export function normalizeState(s: string | null | undefined): LifecycleState {
  if (isKnownLifecycleState(s)) return s
  if (s === null || s === undefined || s === "") return "active"   // legado pré-coluna
  if (!warnedStates.has(s)) {
    warnedStates.add(s)
    console.warn(`[lifecycle] estado desconhecido "${s}" — tratado como ${UNKNOWN_LIFECYCLE_FALLBACK} (fail-closed)`)
  }
  return UNKNOWN_LIFECYCLE_FALLBACK
}

// ═══════════════════════════════════════════════════════════════
// Gate de acesso — lifecycle ✕ assinatura
// ═══════════════════════════════════════════════════════════════

/** Estados de lifecycle que NEGAM acesso/serviço. Fonte ÚNICA (login-core reexporta). */
export const BLOCKED_LIFECYCLE: ReadonlySet<string> = new Set<LifecycleState>([
  "pending_approval", "suspended", "deactivated",
])

/**
 * Papéis que ainda entram com o teste encerrado — **os que podem PAGAR** (decisão do dono,
 * 2026-08-05). Atendente não entra: ele não resolve a assinatura e ficaria olhando um
 * produto travado sem nada a fazer.
 */
const PAPEIS_QUE_PAGAM: ReadonlySet<string> = new Set(["owner", "admin"])

/**
 * Acesso levando o PAPEL em conta. É a pergunta certa para `trial_ended`, onde o tenant
 * não está bloqueado — **a pessoa é que pode estar**.
 *
 * ⚠️ Função separada em vez de um parâmetro novo em `isTenantBlockedForAccess`: aquela é
 *    chamada em 8 lugares, vários deles sem papel à mão (webhook, cron, gate de gasto).
 *    Parâmetro opcional ali significaria "sem papel = libera", e um chamador que
 *    esquecesse de passar abriria o acesso em silêncio. Aqui o papel é obrigatório.
 */
export function isTenantBlockedForAccessAs(
  lifecycleState: string | null | undefined,
  role: string | null | undefined,
): boolean {
  if (isTenantBlockedForAccess(lifecycleState ?? null)) return true
  if (normalizeState(lifecycleState) === "trial_ended") {
    return !PAPEIS_QUE_PAGAM.has(role ?? "")
  }
  return false
}

/**
 * Lifecycle que corta GASTO sem cortar acesso. `trial_ended` é o único hoje: o dono entra
 * pra pagar, mas campanha, IA e automação param — senão o teste vira produto de graça por
 * tempo indeterminado, que é exatamente o que o prazo existe pra impedir.
 */
export const SPEND_BLOCKED_LIFECYCLE: ReadonlySet<string> = new Set<LifecycleState>([
  "trial_ended",
])

/**
 * Dias que o cliente tem, depois do teste vencer, antes de a conta ser suspensa de vez.
 * Decisão do dono (2026-08-05): **2 dias**, o mesmo número do próprio teste.
 */
export const TRIAL_ENDED_GRACE_DAYS = 2

/** Vocabulário de `tenants.subscription_status` (20260531_billing.sql:7). */
export type SubscriptionStatus = "active" | "past_due" | "canceled"

/**
 * ⚠️ DECISÃO DE PRODUTO — carência de inadimplência: **7 dias**.
 *
 * Por que 7: é uma semana inteira de régua de cobrança (e-mail no vencimento, lembrete,
 * aviso de corte) antes de puxar o acesso. Menos que isso corta quem só esqueceu o boleto
 * na sexta; mais que isso é mês de produto de graça — a cota de IA e o WhatsApp oficial
 * saem do nosso bolso todo dia.
 *
 * 🔴 ONDE A CARÊNCIA MORA — leia antes de mudar: na **transição** para `past_due`, não
 * neste gate. O job de cobrança só escreve `past_due` depois de PAST_DUE_GRACE_DAYS do
 * vencimento; a partir daí `past_due` significa uma coisa só, em todo lugar: *"atrasou
 * além da carência"*. Duas razões:
 *   1. Só o job tem a data de vencimento (`invoices.due_date`). Não existe coluna
 *      `tenants.past_due_since`, e criar uma é migration — fora do meu escopo aqui.
 *   2. `isTenantBlocked` é PURA (dois campos, zero I/O, zero noção de tempo) porque roda
 *      em caminho quente — webhook, cron, cada request da extensão. Contrato fechado.
 * Quando a coluna de carimbo existir, `isTenantBlockedAt` abaixo já aplica a carência
 * aqui e o job pode marcar `past_due` no dia 1.
 *
 * 🔴 Hoje o único escritor de `past_due` é a MÃO do admin (`admin-billing.ts:52`) — o cron
 * de cobrança existe no código mas nunca foi agendado (entitlements-design §3.3 H-7).
 * Marcou à mão = decidiu cortar. Bloqueia na hora, e é o comportamento certo.
 */
export const PAST_DUE_GRACE_DAYS = 7

/**
 * Status de assinatura que NEGAM acesso/serviço.
 *
 * ⚠️ Fail-OPEN pra valor DESCONHECIDO — e é deliberado, ao contrário do lifecycle.
 * `lifecycle_state` é máquina NOSSA, vocabulário fechado: desconhecido = corrupção,
 * bloqueia. `subscription_status` é ESPELHO de gateway (o dia que plugarmos Stripe/Asaas,
 * chegam `incomplete`, `unpaid`, `trialing`…). Fail-closed aqui significa que um único
 * status não mapeado, escrito pelo webhook do gateway antes do deploy que o entende,
 * derruba **100% da base de uma vez**. Desconhecido não bloqueia e grita no log; quem
 * plugar o gateway adiciona o valor AQUI, conscientemente.
 */
export const BLOCKED_SUBSCRIPTION: ReadonlySet<string> = new Set<SubscriptionStatus>([
  "past_due", "canceled",
])

const KNOWN_SUBSCRIPTION: ReadonlySet<string> = new Set<SubscriptionStatus>([
  "active", "past_due", "canceled",
])
const warnedSubs = new Set<string>()

// ═══════════════════════════════════════════════════════════════
// 🔒 DUAS PERGUNTAS DIFERENTES — nunca uma função só
// ═══════════════════════════════════════════════════════════════
// Política ratificada pelo dono em 2026-08-03 (docs/access-revocation-design.md §2):
//
//   `lifecycle_state`     = A RELAÇÃO.  suspenso/desativado ⇒ corta ACESSO.
//   `subscription_status` = O DINHEIRO. atrasado/cancelado  ⇒ corta GASTO, mantém acesso.
//
// 🔴 POR QUE SÃO DUAS FUNÇÕES E NÃO UMA COM FLAG: existia uma só, chamada
//    `isTenantBlocked`, que misturava as duas perguntas. O nome convidava ao erro — quem
//    lesse "o login não usa isto" concluiria que era bug e ligaria numa linha, derrubando
//    o login de TODO cliente em atraso. E a tela onde ele paga fica DENTRO do sistema:
//    cortar o login de quem está atrasado é impedir que ele te pague. Nome que se explica
//    sozinho vale mais que comentário — por isso a separação é por NOME, não por parâmetro.

/**
 * 🚪 "Este cliente ainda pode ENTRAR?" — **só ciclo de vida**, nunca assinatura.
 *
 * Consumidores: login (`login-core.ts`), revalidação de sessão a cada 5min (`auth.ts`),
 * e a extensão a cada request (`ext-auth.ts`).
 *
 * ⚠️ **Fail-CLOSED via `normalizeState`, e isso é a correção de 2026-08-03.** Antes, o
 * `login-core` mantinha uma 2ª cópia do `BLOCKED_LIFECYCLE` e comparava a string CRUA:
 * um estado desconhecido não estava na lista ⇒ `false` ⇒ **deixava entrar**. O mesmo
 * estado, no caminho de consumo, era normalizado e **bloqueava**. Resultado: lifecycle
 * corrompido liberava o login e barrava o consumo — assimetria silenciosa. Agora há uma
 * definição só, e desconhecido nega dos dois lados. (`null`/"" segue servível: é o legado
 * pré-coluna, estado real da *Blue Digital Hub* em produção.)
 *
 * NÃO cobre `tenants.active` (booleano legado, anterior à máquina de estados): quem lê a
 * linha do tenant continua checando `active === false ||` isto — os dois convivem.
 */
export function isTenantBlockedForAccess(lifecycleState: string | null): boolean {
  return BLOCKED_LIFECYCLE.has(normalizeState(lifecycleState))
}

/**
 * 💸 "Este cliente ainda pode GASTAR?" — ciclo de vida **E** assinatura.
 *
 * Consumidor único: o guarda de status (`auth/tenant-serviceable.ts`), que roda nos 3
 * webhooks, nos 4 crons que gastam e nas 3 rotas públicas do widget.
 *
 * 🔴 **NÃO ligue isto no login.** Inadimplência para o que CUSTA (campanha, IA, automação);
 * atendimento manual, leitura e exportação continuam. É a política do degrau 3, e ela
 * existe porque cliente atrasado que não consegue entrar não consegue pagar — e porque
 * cortar o atendimento dele transforma o problema de cobrança dele em reclamação nossa.
 */
export function isTenantBlockedForSpend(
  lifecycleState:     string | null,
  subscriptionStatus: string | null,
): boolean {
  if (isTenantBlockedForAccess(lifecycleState)) return true

  // 🔴 `trial_ended` MORA AQUI DESDE 05/08 — antes ficava do lado de fora, e o custo foi
  //    dinheiro saindo. `checkTenantStatus` aplicava `SPEND_BLOCKED_LIFECYCLE` por conta
  //    própria; `serviceableFromRow` (o caminho em LOTE, usado pelos crons) chamava só
  //    esta função e não sabia do estado. Resultado medido na auditoria: conta com teste
  //    vencido seguia disparando template pago da Meta (`campaigns/engine.ts`), lembrete
  //    de agenda (`agenda/reminders.ts`) e re-engajamento por IA na nossa chave
  //    (`ai-v2/flow/inactivity.ts`) — exatamente os três crons que mais gastam — enquanto
  //    a tela do cliente listava os três como PAUSADOS.
  // 🔑 Regra de gasto mora na função de gasto. Quem chama vira casca; casca não diverge.
  if (SPEND_BLOCKED_LIFECYCLE.has(normalizeState(lifecycleState))) return true

  const sub = subscriptionStatus ?? "active"   // coluna é NOT NULL DEFAULT 'active'
  if (BLOCKED_SUBSCRIPTION.has(sub)) return true
  if (!KNOWN_SUBSCRIPTION.has(sub) && !warnedSubs.has(sub)) {
    warnedSubs.add(sub)
    console.warn(`[lifecycle] subscription_status desconhecido "${sub}" — NÃO bloqueia (ver BLOCKED_SUBSCRIPTION)`)
  }
  return false
}

/**
 * 🔴 REMOVIDA EM 2026-08-08 — `isTenantBlockedForSpendAt`.
 *
 *    Ela existia, tinha o nome certo, a assinatura certa, ZERO chamadores, e um docblock
 *    dizendo *"use no dia em que existir o carimbo `past_due_since`"*. Parecia a peça
 *    esperando o encaixe. **O comportamento dela era o INVERSO da escada nova.**
 *
 *    Ela foi escrita para a escada de 03/08, onde o degrau 2 *avisava e não cortava*:
 *    durante a carência devolvia `false` = **não bloqueia gasto**. Na escada de 08/08 a
 *    carência **É** o corte de gasto — ela começa no dia 1 do atraso.
 *
 *    O acidente que isso ia causar: quem implementasse ligaria a coluna, trocaria
 *    `isTenantBlockedForSpend` por esta nos 3 motores e no lote, o `tsc` passaria verde
 *    (mesma assinatura, mesmo retorno), e o degrau 2 passaria a **liberar** IA, campanhas
 *    e automações justamente nos N dias em que deveria cortá-las. Sem erro, sem log — o
 *    único sinal seria a fatura da OpenAI e da Meta no mês seguinte.
 *
 * 🔑 Na escada nova a carência NÃO mora no gate de gasto. Ela decide OUTRA coisa: quando
 *    o degrau 2 vira degrau 3 (paywall). Quem responde isso é `passouDaCarencia` abaixo,
 *    e quem corta gasto continua sendo `isTenantBlockedForSpend` — que já trata `past_due`
 *    como bloqueio desde o primeiro dia, que é exatamente o que a escada nova quer.
 */

/**
 * O atraso deste tenant já passou da carência? — é o que promove degrau 2 → 3 (paywall).
 *
 * @param pastDueSince  `tenants.past_due_since` — quando o atraso começou.
 * @param graceDays     `tenants.past_due_grace_days` — carência DESTE tenant. `null` = padrão.
 *
 * ⚠️ FAIL-CLOSED PELA DATA, FAIL-OPEN PELO PRAZO, e a assimetria é deliberada:
 *    • sem `pastDueSince` não dá pra contar ⇒ trata como **passou** (o atraso existe, a
 *      data é que se perdeu; presumir "acabou de começar" daria carência infinita a quem
 *      tem carimbo faltando);
 *    • sem `graceDays` cai no padrão do sistema, nunca em zero.
 * ⚠️ Não sabe nada de acesso nem de gasto: só responde sobre o RELÓGIO. Quem combina isso
 *    com estado é `isTenantInPaywall`.
 */
export function passouDaCarencia(
  pastDueSince: string | null | undefined,
  graceDays:    number | null | undefined,
  now:          number = Date.now(),
): boolean {
  if (!pastDueSince) return true
  const inicio = new Date(pastDueSince).getTime()
  if (!Number.isFinite(inicio)) return true
  const dias = typeof graceDays === "number" && graceDays >= 0 ? graceDays : PAST_DUE_GRACE_DAYS
  return now - inicio >= dias * 86_400_000
}

/**
 * O tenant está no PAYWALL (degrau 3)? — "pague para continuar".
 *
 * Duas origens, um estado: o teste que acabou e a fatura que passou da carência. Mesma
 * tela, mesmos gates, mesma regra de papel — só a copy difere.
 *
 * 🔴 POR QUE É PREDICADO E NÃO UM `lifecycle_state` NOVO (mapeamento 08/08). A tentação
 *    era rotear a inadimplência para `trial_ended` e reusar o paywall inteiro de graça.
 *    Isso quebraria em dois pontos, medidos:
 *      1. `trial-housekeeping` suspende quem está em `trial_ended` com `trial_ends_at`
 *         vencido há 2 dias. Um inadimplente roteado pra lá **herdaria o `trial_ends_at`
 *         antigo** — e quem tem data velha (medido: um tenant com 12/07) seria suspenso no
 *         PRIMEIRO tick do cron, pulando o degrau 3 inteiro e perdendo o login que a
 *         política diz que ele deve ter pra pagar.
 *      2. `lifecycle_state` é a RELAÇÃO; inadimplência é DINHEIRO. Misturar as duas é o
 *         erro que a própria política de 03/08 nomeia como a coisa a não fazer.
 * 🔑 Como predicado, o estado do trial continua sendo do trial, o relógio do atraso é o
 *    do atraso, e o paywall passa a ser uma pergunta — não um lugar onde se guarda gente.
 */
export function isTenantInPaywall(
  lifecycleState:     string | null | undefined,
  subscriptionStatus: string | null | undefined,
  pastDueSince:       string | null | undefined,
  graceDays:          number | null | undefined,
  now:                number = Date.now(),
): boolean {
  if (normalizeState(lifecycleState ?? null) === "trial_ended") return true
  if ((subscriptionStatus ?? "active") !== "past_due") return false
  return passouDaCarencia(pastDueSince, graceDays, now)
}

export const STATE_META: Record<LifecycleState, { label: string; badge: string; dot: string; hint: string }> = {
  pending_approval: { label: "Aguardando", badge: "bg-amber-50 text-amber-700 border-amber-200",       dot: "bg-amber-500",   hint: "Precisa da sua aprovação" },
  trialing:         { label: "Trial",      badge: "bg-sky-50 text-sky-700 border-sky-200",             dot: "bg-sky-500",     hint: "Em período de teste" },
  trial_ended:      { label: "Teste encerrado", badge: "bg-amber-50 text-amber-700 border-amber-200",  dot: "bg-amber-500",   hint: "Aguardando pagamento — só owner/admin entra" },
  active:           { label: "Ativo",      badge: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500", hint: "Cliente ativo" },
  suspended:        { label: "Suspenso",   badge: "bg-red-50 text-red-700 border-red-200",             dot: "bg-red-500",     hint: "Acesso bloqueado" },
  deactivated:      { label: "Desativado", badge: "bg-slate-100 text-slate-600 border-slate-200",      dot: "bg-slate-400",   hint: "Conta encerrada" },
}

export interface TransitionDef {
  action:    LifecycleAction
  label:     string
  intent:    "primary" | "default" | "danger"
  needsDays?:    boolean   // abre o modal de dias (extend / start_trial)
  confirm?:      string    // texto do modal de confirmação (destrutivas)
  modalTitle?:   string    // título do modal
  confirmLabel?: string    // rótulo do botão de confirmar
}

const SUSPEND  = "Suspender este cliente? Ele perde o acesso imediatamente."
const DEACT    = "Desativar este cliente? A conta será encerrada (reversível depois)."

/** Ações VÁLIDAS a partir de cada estado (ordem = ordem de exibição). */
export const TRANSITIONS: Record<LifecycleState, TransitionDef[]> = {
  pending_approval: [
    { action: "approve", label: "Habilitar", intent: "primary" },
    { action: "reject",  label: "Recusar",   intent: "danger", confirm: "Recusar este cadastro? A conta será encerrada.", modalTitle: "Recusar cadastro", confirmLabel: "Recusar" },
  ],
  // Teste encerrado: as mesmas saídas do trial. Estender devolve o cliente ao teste
  // (é a ação de "dá mais um prazo pra ele"), ativar confirma o pagamento por fora,
  // e suspender é o que o cron faz sozinho depois da carência.
  trial_ended: [
    { action: "extend",   label: "Estender teste", intent: "default", needsDays: true, modalTitle: "Estender teste", confirmLabel: "Estender" },
    { action: "activate", label: "Ativar (pago)",  intent: "primary" },
    { action: "suspend",  label: "Suspender",      intent: "danger", confirm: SUSPEND, modalTitle: "Suspender cliente", confirmLabel: "Suspender" },
  ],
  trialing: [
    { action: "extend",   label: "Estender",      intent: "default", needsDays: true, modalTitle: "Estender trial", confirmLabel: "Estender" },
    { action: "activate", label: "Ativar (pago)", intent: "primary" },
    { action: "suspend",  label: "Suspender",     intent: "danger", confirm: SUSPEND, modalTitle: "Suspender cliente", confirmLabel: "Suspender" },
  ],
  active: [
    { action: "start_trial", label: "Colocar em trial", intent: "default", needsDays: true, modalTitle: "Colocar em trial", confirmLabel: "Iniciar trial" },
    { action: "suspend",     label: "Suspender",        intent: "danger", confirm: SUSPEND, modalTitle: "Suspender cliente", confirmLabel: "Suspender" },
    { action: "deactivate",  label: "Desativar",        intent: "danger", confirm: DEACT,   modalTitle: "Desativar cliente", confirmLabel: "Desativar" },
  ],
  suspended: [
    { action: "reactivate",  label: "Reativar (pago)",   intent: "primary" },
    { action: "start_trial", label: "Reativar em trial", intent: "default", needsDays: true, modalTitle: "Reativar em trial", confirmLabel: "Iniciar trial" },
    { action: "deactivate",  label: "Desativar",         intent: "danger", confirm: DEACT, modalTitle: "Desativar cliente", confirmLabel: "Desativar" },
  ],
  deactivated: [
    { action: "reactivate",  label: "Reativar (pago)",   intent: "primary" },
    { action: "start_trial", label: "Reativar em trial", intent: "default", needsDays: true, modalTitle: "Reativar em trial", confirmLabel: "Iniciar trial" },
  ],
}

/** Dias restantes do trial (arredonda pra cima). null se não há prazo. */
export function trialDaysLeft(trialEndsAt: string | null | undefined): number | null {
  if (!trialEndsAt) return null
  return Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000)
}

/** Rótulo curto do countdown ("2d rest." / "vence hoje" / "vencido"). */
export function trialCountdownLabel(trialEndsAt: string | null | undefined): string | null {
  const d = trialDaysLeft(trialEndsAt)
  if (d === null) return null
  if (d < 0)  return "vencido"
  if (d === 0) return "vence hoje"
  if (d === 1) return "1d rest."
  return `${d}d rest.`
}

/** Ordem canônica dos estados pra KPIs/tabs/filtros. */
export const STATE_ORDER: LifecycleState[] = [
  "pending_approval", "trialing", "active", "suspended", "deactivated",
]
