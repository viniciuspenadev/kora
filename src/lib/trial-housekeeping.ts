import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { transitionLifecycle } from "@/lib/actions/lifecycle-admin"

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

  // 1. Suspende trials vencidos — via a transição ÚNICA (audita cada suspensão
  //    no histórico do cliente; `system:true` pula o gate de platform-admin).
  const { data: expired } = await supabaseAdmin
    .from("tenants")
    .select("id")
    .eq("lifecycle_state", "trialing")
    .lt("trial_ends_at", nowIso)
  let suspended = 0
  for (const t of expired ?? []) {
    const r = await transitionLifecycle(t.id as string, "suspend", { system: true })
    if (!r.error) suspended++
  }

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
