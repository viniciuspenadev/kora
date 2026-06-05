import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

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
export async function runTrialHousekeeping(): Promise<{ suspended: number; purged: number }> {
  const nowIso = new Date().toISOString()

  // 1. Suspende trials vencidos.
  const { data: expired } = await supabaseAdmin
    .from("tenants")
    .update({ active: false, lifecycle_state: "suspended" })
    .eq("lifecycle_state", "trialing")
    .lt("trial_ends_at", nowIso)
    .select("id")
  const suspended = expired?.length ?? 0

  // 2. Purga PII: consumidas + expiradas (sequencial pra não dupla-contar a corrida).
  const { data: consumed } = await supabaseAdmin
    .from("signup_verifications").delete().not("consumed_at", "is", null).select("id")
  const { data: stale } = await supabaseAdmin
    .from("signup_verifications").delete().lt("expires_at", nowIso).select("id")
  const purged = (consumed?.length ?? 0) + (stale?.length ?? 0)

  return { suspended, purged }
}
