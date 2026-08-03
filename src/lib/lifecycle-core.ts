import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { logAudit } from "@/lib/audit"
import { TRANSITIONS, normalizeState, type LifecycleAction, type LifecycleState } from "@/lib/lifecycle-shared"

const DAY = 86_400_000

/**
 * CORE da transição de ciclo de vida — server-only, **NÃO é Server Action** (de propósito).
 *
 * ⚠️ Corrigido 2026-07-30 (crítico C-01): antes esta lógica vivia numa Server Action
 * exportada (`transitionLifecycle`) com um flag `opts.system` que PULAVA o gate de platform
 * admin. Como toda export de "use server" é chamável publicamente, qualquer um forjava a
 * chamada com `{system:true}` + tenantId alheio → suspendia/desativava qualquer cliente.
 *
 * Agora o `system` (usado pelo cron de trial) vive AQUI, num módulo server-only que só código
 * do servidor importa — inalcançável por RSC. A action pública ([lifecycle-admin.ts]) é um
 * wrapper que SEMPRE exige platform admin antes de chamar isto. (ver database-rules §2)
 *
 * @param opts.system  chamado pelo cron (sem sessão) — relaxa a máquina de estados p/ 'suspend'.
 * @param opts.actorId/actorEmail  identidade pro audit (admin no caminho UI; null/cron no system).
 */
export async function transitionLifecycleCore(
  tenantId: string,
  action: LifecycleAction,
  opts?: { days?: number; system?: boolean; actorId?: string | null; actorEmail?: string | null },
): Promise<{ error?: string; to?: LifecycleState }> {
  const { data: t } = await supabaseAdmin
    .from("tenants")
    .select("id, name, lifecycle_state, active, trial_ends_at, activated_at, plan_id, plans:plan_id ( trial_days )")
    .eq("id", tenantId)
    .maybeSingle()
  if (!t) return { error: "Cliente não encontrado." }

  const from = normalizeState(t.lifecycle_state as string | null)
  const def  = TRANSITIONS[from].find((d) => d.action === action)
  // O cron usa 'suspend' (trial vencido) — permitido a partir de trialing/active.
  if (!def && !opts?.system) return { error: `Transição inválida: "${action}" a partir de "${from}".` }

  const planRel  = (t as { plans?: { trial_days?: number } | { trial_days?: number }[] | null }).plans
  const trialDays = (Array.isArray(planRel) ? planRel[0]?.trial_days : planRel?.trial_days) ?? 0
  const now    = Date.now()
  const nowIso = new Date(now).toISOString()
  const keepActivatedAt = (t.activated_at as string | null) ?? nowIso

  const patch: Record<string, unknown> = {}
  let to: LifecycleState

  switch (action) {
    case "approve": {
      const hasTrial = trialDays > 0
      to = hasTrial ? "trialing" : "active"
      patch.active = true
      patch.lifecycle_state = to
      patch.activated_at = keepActivatedAt
      patch.trial_ends_at = hasTrial ? new Date(now + trialDays * DAY).toISOString() : null
      break
    }
    case "activate":
      to = "active"
      patch.active = true; patch.lifecycle_state = "active"; patch.trial_ends_at = null
      patch.activated_at = keepActivatedAt
      break
    case "extend": {
      to = "trialing"
      const cur = t.trial_ends_at ? new Date(t.trial_ends_at).getTime() : 0
      const base = cur > now ? cur : now   // estende a partir do fim atual, ou de hoje se já venceu
      const days = Math.max(1, Math.min(365, Math.round(opts?.days ?? 7)))
      patch.active = true; patch.lifecycle_state = "trialing"
      patch.trial_ends_at = new Date(base + days * DAY).toISOString()
      break
    }
    case "start_trial": {
      // Coloca/reativa em trial com prazo a partir de HOJE (active/suspended/deactivated → trialing).
      to = "trialing"
      const days = Math.max(1, Math.min(365, Math.round(opts?.days ?? (trialDays > 0 ? trialDays : 7))))
      patch.active = true; patch.lifecycle_state = "trialing"; patch.activated_at = keepActivatedAt
      patch.trial_ends_at = new Date(now + days * DAY).toISOString()
      break
    }
    case "suspend":
      to = "suspended"; patch.active = false; patch.lifecycle_state = "suspended"
      break
    case "reactivate":
      to = "active"; patch.active = true; patch.lifecycle_state = "active"
      patch.activated_at = keepActivatedAt
      break
    case "reject":
    case "deactivate":
      to = "deactivated"; patch.active = false; patch.lifecycle_state = "deactivated"
      break
    default:
      return { error: "Ação desconhecida." }
  }

  const { error } = await supabaseAdmin.from("tenants").update(patch).eq("id", tenantId)
  if (error) return { error: error.message }

  await logAudit({
    tenantId,
    actorId:    opts?.actorId ?? null,
    actorEmail: opts?.actorEmail ?? (opts?.system ? "system:cron" : null),
    action:     `tenant.lifecycle.${action}`,
    targetType: "tenant",
    targetId:   tenantId,
    metadata:   { from, to, name: t.name, days: opts?.days ?? null, trial_ends_at: patch.trial_ends_at ?? null },
  })

  return { to }
}
