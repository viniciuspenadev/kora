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
  | "active"
  | "suspended"
  | "deactivated"

export type LifecycleAction =
  | "approve"      // pendente → trialing|active (inicia o relógio do trial)
  | "reject"       // pendente → deactivated
  | "extend"       // trialing → trialing (+N dias)
  | "start_trial"  // active|suspended|deactivated → trialing (N dias de acesso)
  | "activate"     // trialing|suspended|deactivated → active (pago, sem prazo)
  | "suspend"      // trialing|active → suspended
  | "reactivate"   // suspended|deactivated → active
  | "deactivate"   // active|suspended → deactivated

/** Os 5 estados conhecidos — fonte do parse (não repetir a lista em switch). */
const KNOWN_STATES: ReadonlySet<string> = new Set<LifecycleState>([
  "pending_approval", "trialing", "active", "suspended", "deactivated",
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

/** `true` se o valor cru do banco é um dos 5 estados que este código entende. */
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

  const sub = subscriptionStatus ?? "active"   // coluna é NOT NULL DEFAULT 'active'
  if (BLOCKED_SUBSCRIPTION.has(sub)) return true
  if (!KNOWN_SUBSCRIPTION.has(sub) && !warnedSubs.has(sub)) {
    warnedSubs.add(sub)
    console.warn(`[lifecycle] subscription_status desconhecido "${sub}" — NÃO bloqueia (ver BLOCKED_SUBSCRIPTION)`)
  }
  return false
}

/**
 * Variante de GASTO ciente do tempo — aplica PAST_DUE_GRACE_DAYS **no gate**.
 *
 * Use no dia em que existir o carimbo de quando o cliente entrou em atraso
 * (`tenants.past_due_since` ou `invoices.due_date` da fatura vencida): aí o job de
 * cobrança pode marcar `past_due` no dia 1 e a carência passa a ser reavaliada aqui,
 * em vez de ficar escondida na regra de quem escreve. Sem carimbo, é idêntica a
 * `isTenantBlockedForSpend` (fail-closed: sem data, o atraso já passou da carência).
 */
export function isTenantBlockedForSpendAt(
  lifecycleState:     string | null,
  subscriptionStatus: string | null,
  pastDueSince:       string | null,
  now:                number = Date.now(),
): boolean {
  if (isTenantBlockedForAccess(lifecycleState)) return true
  if ((subscriptionStatus ?? "active") === "past_due" && pastDueSince) {
    const elapsedMs = now - new Date(pastDueSince).getTime()
    if (Number.isFinite(elapsedMs) && elapsedMs < PAST_DUE_GRACE_DAYS * 86_400_000) return false
    return true
  }
  return isTenantBlockedForSpend(lifecycleState, subscriptionStatus)
}

export const STATE_META: Record<LifecycleState, { label: string; badge: string; dot: string; hint: string }> = {
  pending_approval: { label: "Aguardando", badge: "bg-amber-50 text-amber-700 border-amber-200",       dot: "bg-amber-500",   hint: "Precisa da sua aprovação" },
  trialing:         { label: "Trial",      badge: "bg-sky-50 text-sky-700 border-sky-200",             dot: "bg-sky-500",     hint: "Em período de teste" },
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
