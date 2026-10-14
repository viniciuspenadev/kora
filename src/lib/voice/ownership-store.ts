import 'server-only'
import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import type { BrowserCallOwner, VoiceAttempt } from './ownership-contract'
import { ownershipErrors } from './ownership-contract'

export class VoiceOwnershipError extends Error {
  constructor(readonly code: string, readonly status = 409) {
    super(ownershipErrors[code] ?? 'Não foi possível confirmar a reserva da ligação.')
  }
}
type RpcResult = { ok: true; attempt: VoiceAttempt } | { ok: false; code: string }
export const voiceAttemptColumns = 'id,tenant_id,instance_id,conversation_id,operator_id,browser_session_id,owner_token_hash,fence::text,state,backend_origin,backend_instance_name,backend_line_key,backend_boot_id,backend_call_id,created_at,prepare_deadline_at,lease_expires_at,finished_at,dial_requested_at'
function unpack(data: unknown, error: unknown): VoiceAttempt {
  if (error || !data || typeof data !== 'object' || !('ok' in data)) throw new VoiceOwnershipError('STORE_UNAVAILABLE', 503)
  const result = data as RpcResult
  if (!result.ok) throw new VoiceOwnershipError(result.code, result.code === 'RATE_LIMITED' ? 429
    : ['NOT_ALLOWED','INVALID_OWNER','PERMISSION_REVOKED'].includes(result.code) ? 403 : 409)
  if (!result.attempt || !/^[1-9][0-9]{0,18}$/.test(String(result.attempt.fence))) throw new VoiceOwnershipError('STORE_UNAVAILABLE', 503)
  return { ...result.attempt, fence: String(result.attempt.fence) }
}
export const ownerTokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
export function voiceOwnershipEnabled(instanceId: string): boolean {
  return process.env.VOICE_RESERVATIONS_ENABLED === 'true' &&
    (process.env.VOICE_RESERVATIONS_INSTANCE_IDS ?? '').split(',').map(id => id.trim()).includes(instanceId)
}
export async function claimVoiceCall(context: { tenantId: string; userId: string; instanceId: string; conversationId: string; backendOrigin: string; instanceName: string }, owner: BrowserCallOwner) {
  const { data, error } = await supabaseAdmin.rpc('voice_claim_call', {
    p_tenant_id: context.tenantId, p_instance_id: context.instanceId, p_conversation_id: context.conversationId,
    p_operator_id: context.userId, p_browser_session_id: owner.browserSessionId,
    p_attempt_id: owner.attemptId, p_owner_token_hash: ownerTokenHash(owner.ownerToken),
    p_backend_origin: context.backendOrigin, p_backend_instance_name: context.instanceName,
  }).abortSignal(AbortSignal.timeout(10000))
  return unpack(data, error)
}
export async function ownedVoiceCall(context: { userId: string; conversationId: string }, owner: BrowserCallOwner) {
  // For an existing call, tenant comes from this capability-bound row, never the browser.
  // This allows its owner to end it even after switching their active company.
  const { data, error } = await supabaseAdmin.from('voice_call_attempts').select(voiceAttemptColumns)
    .eq('id', owner.attemptId).eq('operator_id', context.userId)
    .eq('conversation_id', context.conversationId).eq('browser_session_id', owner.browserSessionId)
    .eq('owner_token_hash', ownerTokenHash(owner.ownerToken)).abortSignal(AbortSignal.timeout(10000)).maybeSingle()
  if (error) throw new VoiceOwnershipError('STORE_UNAVAILABLE', 503)
  if (!data) throw new VoiceOwnershipError('INVALID_OWNER', 403)
  return { ...data, fence: String(data.fence) } as VoiceAttempt
}
export async function occupiedVoiceLine(tenantId: string, instanceId: string): Promise<VoiceAttempt | null> {
  const { data, error } = await supabaseAdmin.from('voice_call_attempts').select(voiceAttemptColumns)
    .eq('tenant_id', tenantId).eq('instance_id', instanceId).is('finished_at', null).abortSignal(AbortSignal.timeout(10000)).maybeSingle()
  if (error) throw new VoiceOwnershipError('STORE_UNAVAILABLE', 503)
  return data ? { ...data, fence: String(data.fence) } as VoiceAttempt : null
}
export async function refreshVoiceAttempt(attempt: VoiceAttempt): Promise<VoiceAttempt> {
  const { data, error } = await supabaseAdmin.from('voice_call_attempts').select(voiceAttemptColumns)
    .eq('id', attempt.id).eq('tenant_id', attempt.tenant_id).eq('operator_id', attempt.operator_id)
    .eq('browser_session_id', attempt.browser_session_id).eq('owner_token_hash', attempt.owner_token_hash)
    .eq('fence', attempt.fence).abortSignal(AbortSignal.timeout(10000)).maybeSingle()
  if (error) throw new VoiceOwnershipError('STORE_UNAVAILABLE', 503)
  if (!data) throw new VoiceOwnershipError('INVALID_OWNER', 403)
  return { ...data, fence: String(data.fence) } as VoiceAttempt
}
export async function cancelPendingVoiceClaim(context: { tenantId: string; userId: string; conversationId: string }, owner: BrowserCallOwner) {
  const { data, error } = await supabaseAdmin.rpc('voice_cancel_pending_claim', {
    p_attempt_id: owner.attemptId, p_tenant_id: context.tenantId, p_conversation_id: context.conversationId,
    p_operator_id: context.userId, p_browser_session_id: owner.browserSessionId, p_owner_token_hash: ownerTokenHash(owner.ownerToken),
  }).abortSignal(AbortSignal.timeout(10000))
  if (error || !data || typeof data !== 'object') throw new VoiceOwnershipError('STORE_UNAVAILABLE', 503)
  if (!data.ok) throw new VoiceOwnershipError(data.code, data.code === 'RATE_LIMITED' ? 429 : 403)
  return data.released ? null : { ...data.attempt, fence: String(data.attempt.fence) } as VoiceAttempt
}
export async function updateOwnedVoiceCall(attempt: VoiceAttempt, action: 'confirm-backend' | 'renew' | 'dialing' | 'observe' | 'recovering',
  observed?: { bootId?: string; callId?: string; state?: string }) {
  const { data, error } = await supabaseAdmin.rpc('voice_update_owned_call', {
    p_tenant_id: attempt.tenant_id, p_operator_id: attempt.operator_id, p_browser_session_id: attempt.browser_session_id,
    p_attempt_id: attempt.id, p_owner_token_hash: attempt.owner_token_hash, p_fence: attempt.fence,
    p_action: action, p_boot_id: observed?.bootId ?? null, p_call_id: observed?.callId ?? null, p_call_state: observed?.state ?? null,
  }).abortSignal(AbortSignal.timeout(10000))
  return unpack(data, error)
}
export async function finishReconciledVoiceCall(attempt: VoiceAttempt,
  outcome: 'ended' | 'cancelled' | 'failed' | 'interrupted' | 'unknown', reason: string) {
  const { data, error } = await supabaseAdmin.rpc('voice_finish_reconciled_call', {
    p_attempt_id: attempt.id, p_tenant_id: attempt.tenant_id, p_fence: attempt.fence,
    p_outcome: outcome, p_reason: reason,
  }).abortSignal(AbortSignal.timeout(10000))
  return unpack(data, error)
}
