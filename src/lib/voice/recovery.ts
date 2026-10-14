import 'server-only'
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import type { VoiceAttempt } from './ownership-contract'
import { configForVoiceAttempt, reconcileVoiceAttempt } from './ownership'
import { VoiceOwnershipError } from './ownership-store'

export async function recoverExpiredVoiceCalls() {
  const enabled = process.env.VOICE_RESERVATIONS_RECOVERY_ENABLED === 'true'
  const instanceIds = (process.env.VOICE_RESERVATIONS_RECOVERY_INSTANCE_IDS ?? process.env.VOICE_RESERVATIONS_INSTANCE_IDS ?? '')
    .split(',').map(id => id.trim()).filter(id => /^[0-9a-f-]{36}$/i.test(id))
  if (!enabled || !instanceIds.length) return { enabled: false, claimed: 0, finished: 0, deferred: 0 }
  const workerId = randomUUID()
  const { data, error } = await supabaseAdmin.rpc('voice_claim_recovery_batch', {
    p_worker_id: workerId, p_instance_ids: instanceIds, p_limit: 4,
  }).abortSignal(AbortSignal.timeout(10000))
  if (error || !Array.isArray(data)) throw new VoiceOwnershipError('STORE_UNAVAILABLE', 503)
  const attempts = data as VoiceAttempt[]
  const summary = { enabled: true, claimed: attempts.length, finished: 0, deferred: 0 }
  async function processAttempt(attempt: VoiceAttempt) {
    let delay = 10
    try {
      const result = await reconcileVoiceAttempt(attempt, await configForVoiceAttempt(attempt))
      if (result.attempt.finished_at) { summary.finished++; return }
    } catch { delay = 60 }
    summary.deferred++
    const { error: retryError } = await supabaseAdmin.rpc('voice_defer_recovery', {
      p_attempt_id: attempt.id, p_tenant_id: attempt.tenant_id, p_fence: attempt.fence,
      p_worker_id: workerId, p_delay_seconds: delay,
    }).abortSignal(AbortSignal.timeout(10000))
    if (retryError) console.warn('voice_recovery_defer_failed', { attemptId: attempt.id })
  }
  // Bounded parallelism, with a DB claim shared by all recovery runners.
  for (let offset=0; offset<attempts.length; offset+=2) {
    await Promise.all(attempts.slice(offset,offset+2).map(processAttempt))
  }
  return summary
}
