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

/** Normaliza o valor cru do banco (NULL/legado/desconhecido → 'active'). */
export function normalizeState(s: string | null | undefined): LifecycleState {
  switch (s) {
    case "pending_approval":
    case "trialing":
    case "active":
    case "suspended":
    case "deactivated":
      return s
    default:
      return "active"
  }
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
