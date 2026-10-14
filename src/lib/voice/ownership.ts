import 'server-only'
import { supabaseAdmin } from '@/lib/supabase'
import { getViewerScope } from '@/lib/visibility'
import { voiceConfigForInstance, voiceStatus, type VoiceConfig, type VoiceStatus } from './blue'
import { backendOwner, parseBackendOwnershipStatus, sameBackendReservation, terminalVoiceOutcome, type BrowserCallOwner, type VoiceAttempt } from './ownership-contract'
import { claimVoiceCall, finishReconciledVoiceCall, occupiedVoiceLine, ownedVoiceCall, updateOwnedVoiceCall,
  cancelPendingVoiceClaim, refreshVoiceAttempt, voiceOwnershipEnabled, VoiceOwnershipError } from './ownership-store'

type Context = { config: VoiceConfig; scope: { tenantId: string; userId: string }; conversationId: string }
type BackendReply = { status: number; data: Record<string, unknown> }
async function backendRequest(config: VoiceConfig, action: string, body: object, timeoutMs = 15_000): Promise<BackendReply> {
  const response = await fetch(new URL(`/voice/${action}/${encodeURIComponent(config.instanceName)}`, config.url), {
    method: 'POST', headers: { apikey: config.key, 'content-type': 'application/json' }, body: JSON.stringify(body),
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
  })
  const data = await response.json().catch(() => null)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new VoiceOwnershipError('BACKEND_UNAVAILABLE', 502)
  return { status: response.status, data }
}
function assertProtocol(status: VoiceStatus) {
  if (!status.ownership) throw new VoiceOwnershipError('PROTOCOL_UNAVAILABLE', 503)
  return status.ownership
}
function ownerBody(attempt: VoiceAttempt, bootId = attempt.backend_boot_id) {
  if (!bootId) throw new VoiceOwnershipError('BACKEND_CHANGED')
  return { owner: backendOwner(attempt), bootId }
}
async function markUncertain(attempt: VoiceAttempt) {
  try { await updateOwnedVoiceCall(attempt, 'recovering') }
  catch { /* Persisted nonterminal ownership still prevents another admission. */ }
}
export async function configForVoiceAttempt(attempt: VoiceAttempt): Promise<VoiceConfig> {
  const { data, error } = await supabaseAdmin.from('whatsapp_instances')
    .select('id,instance_name,provider,evolution_url,evolution_key').eq('id', attempt.instance_id).eq('tenant_id', attempt.tenant_id).abortSignal(AbortSignal.timeout(10000)).maybeSingle()
  const config = !error && data ? voiceConfigForInstance(data) : null
  if (!config || config.url.origin !== attempt.backend_origin || config.instanceName !== attempt.backend_instance_name) {
    throw new VoiceOwnershipError('BACKEND_CHANGED')
  }
  return config
}
/** Existing owners may end their call after a grant changes; this path cannot start a new call. */
export async function ownedVoiceContext(conversationId: string, owner: BrowserCallOwner) {
  const scope = await getViewerScope()
  const attempt = await ownedVoiceCall({ userId: scope.userId, conversationId }, owner)
  if (!voiceOwnershipEnabled(attempt.instance_id)) throw new VoiceOwnershipError('PROTOCOL_UNAVAILABLE', 503)
  return { scope, config: await configForVoiceAttempt(attempt), attempt }
}
export async function cancelOwnedVoicePreparation(conversationId: string, owner: BrowserCallOwner) {
  const scope = await getViewerScope()
  let owned: VoiceAttempt | null = null
  try { owned = await ownedVoiceCall({ userId: scope.userId, conversationId }, owner) }
  catch (error) { if (!(error instanceof VoiceOwnershipError) || error.code !== 'INVALID_OWNER') throw error }
  let attempt: VoiceAttempt | null
  try {
    attempt = await cancelPendingVoiceClaim({ tenantId: owned?.tenant_id ?? scope.tenantId, userId: scope.userId, conversationId }, owner)
  } catch (error) {
    // A claim may commit while the operator switches company. Retry only after
    // reading the same authenticated user's exact capability-bound attempt.
    if (owned || !(error instanceof VoiceOwnershipError) || error.code !== 'INVALID_OWNER') throw error
    owned = await ownedVoiceCall({ userId: scope.userId, conversationId }, owner)
    attempt = await cancelPendingVoiceClaim({ tenantId: owned.tenant_id, userId: scope.userId, conversationId }, owner)
  }
  if (!attempt) return { released: true }
  if (!voiceOwnershipEnabled(attempt.instance_id)) throw new VoiceOwnershipError('PROTOCOL_UNAVAILABLE', 503)
  return releaseOwnedVoiceCall(attempt, await configForVoiceAttempt(attempt))
}
export async function prepareOwnedVoiceCall(context: Context, owner: BrowserCallOwner) {
  const status = await voiceStatus(context.config)
  const native = assertProtocol(status)
  if (!status.enabled || !status.ready) throw new VoiceOwnershipError('ENGINE_NOT_READY')
  let attempt = await claimVoiceCall({ tenantId: context.scope.tenantId, userId: context.scope.userId,
    instanceId: context.config.instanceId, conversationId: context.conversationId,
    backendOrigin: context.config.url.origin, instanceName: context.config.instanceName }, owner)
  try {
    const result = await backendRequest(context.config, 'reserve', ownerBody(attempt, native.bootId))
    if (result.status !== 200) throw new VoiceOwnershipError('RECOVERY_REQUIRED')
    const acknowledged = parseBackendOwnershipStatus(result.data.ownership)
    if (!acknowledged || !sameBackendReservation(attempt, acknowledged) || acknowledged.bootId !== native.bootId) {
      throw new VoiceOwnershipError('BACKEND_CHANGED')
    }
    attempt = await updateOwnedVoiceCall(attempt, 'confirm-backend', { bootId: acknowledged.bootId })
    return { attemptId: attempt.id, expiresAt: attempt.lease_expires_at }
  } catch (error) {
    await markUncertain(attempt)
    throw error
  }
}

/** No expiration-only release: the authenticated backend must prove no pending or active call. */
export async function reconcileVoiceAttempt(attempt: VoiceAttempt, config: VoiceConfig, suppliedStatus?: VoiceStatus,
  cancelPreparation = false): Promise<{ attempt: VoiceAttempt; status: VoiceStatus }> {
  let status = suppliedStatus ?? await voiceStatus(config)
  const native = assertProtocol(status)
  attempt = await refreshVoiceAttempt(attempt)
  if (attempt.finished_at) return { attempt, status }
  if (status.call || native.dialing) return { attempt, status }
  if (native.reservation && !sameBackendReservation(attempt, native)) throw new VoiceOwnershipError('RECOVERY_REQUIRED')
  const expired = Date.parse(attempt.lease_expires_at) <= Date.now()
  if (!native.reservation && !attempt.backend_boot_id && !expired) return { attempt, status }
  if (native.reservation && !native.dialAttempted && !expired && !cancelPreparation) return { attempt, status }
  // When dialing is ambiguous, a late HTTP request must not race a premature release.
  if (attempt.state !== 'preparing' && native.reservation && !native.dialAttempted && !expired) return { attempt, status }
  if (native.reservation) {
    const result = await backendRequest(config, 'release', ownerBody(attempt, native.bootId))
    if (result.status !== 200) return { attempt, status }
    const released = parseBackendOwnershipStatus(result.data.ownership)
    if (!released || released.reservation || released.dialing || result.data.call) return { attempt, status }
    status = { ...status, call: null, ownership: released }
  }
  const restarted = !!attempt.backend_boot_id && native.bootId !== attempt.backend_boot_id
  const outcome = restarted || !status.ready ? 'interrupted' : !attempt.dial_requested_at && !native.dialAttempted ? 'cancelled'
    : attempt.backend_call_id ? 'ended' : 'unknown'
  attempt = await finishReconciledVoiceCall(attempt, outcome, restarted ? 'backend-restarted' : !status.ready ? 'engine-disconnected'
    : outcome === 'cancelled' ? 'preparation-released' : 'backend-confirmed-idle')
  return { attempt, status }
}
export async function publicOwnedVoiceStatus(context: Context) {
  let status = await voiceStatus(context.config)
  if (!status.ownership) return { enabled: status.enabled, ready: false, call: null, ownershipRequired: true }
  let occupied = await occupiedVoiceLine(context.scope.tenantId, context.config.instanceId)
  if (occupied) {
    const reconciled = await reconcileVoiceAttempt(occupied, context.config, status)
    occupied = reconciled.attempt.finished_at ? null : reconciled.attempt
    status = reconciled.status
  }
  const busy = !!occupied || !!status.call || !!status.ownership?.reservation || !!status.ownership?.dialing
  return { enabled: status.enabled, ready: status.ready, ownershipRequired: true,
    call: busy ? { id: '', state: 'busy' } : null }
}
export async function ownedVoiceStatus(attempt: VoiceAttempt, config: VoiceConfig, renewLease = true) {
  let status = await voiceStatus(config)
  let native = assertProtocol(status)
  const reconciled = await reconcileVoiceAttempt(attempt, config, status)
  attempt = reconciled.attempt; status = reconciled.status; native = assertProtocol(status)
  if (attempt.finished_at) return { ready: status.ready,
    call: status.call || native.reservation ? { id: '', state: 'busy' } : null, released: true, outcome: terminalVoiceOutcome(attempt.state) }
  if (!sameBackendReservation(attempt, native)) throw new VoiceOwnershipError('RECOVERY_REQUIRED')
  if (status.call) {
    if (attempt.backend_call_id && status.call.id !== attempt.backend_call_id) throw new VoiceOwnershipError('CALL_CHANGED')
    if (attempt.state !== 'recovering' && (attempt.backend_call_id !== status.call.id ||
      (status.call.state === 'offering' ? 'dialing' : status.call.state) !== attempt.state)) {
      attempt = await updateOwnedVoiceCall(attempt, 'observe', { bootId: native.bootId, callId: status.call.id, state: status.call.state })
    }
  }
  // A background observer must not keep a disappeared browser's lease alive.
  if (renewLease && attempt.state !== 'recovering') {
    try { attempt = await updateOwnedVoiceCall(attempt, 'renew') }
    catch (error) {
      if (error instanceof VoiceOwnershipError && error.code === 'PERMISSION_REVOKED') {
        try { await backendRequest(config, 'hangup', ownerBody(attempt)) } catch { /* The expiring media lease still fences access. */ }
      }
      throw error
    }
    const renewed = await backendRequest(config, 'renew', ownerBody(attempt))
    if (renewed.status !== 200) { await markUncertain(attempt); throw new VoiceOwnershipError('RECOVERY_REQUIRED') }
  }
  return { ready: status.ready, call: status.call, released: false }
}
export async function ownedMediaTicket(attempt: VoiceAttempt, config: VoiceConfig) {
  if (attempt.state !== 'preparing' || attempt.finished_at) throw new VoiceOwnershipError('DIAL_NOT_ALLOWED')
  attempt = await updateOwnedVoiceCall(attempt, 'renew')
  const response = await backendRequest(config, 'media-ticket', ownerBody(attempt))
  if (response.status !== 200 || typeof response.data.ticket !== 'string') throw new VoiceOwnershipError('RECOVERY_REQUIRED')
  const mediaUrl = new URL(`/voice/media/${encodeURIComponent(config.instanceName)}`, config.url)
  mediaUrl.protocol = 'wss:'
  return { ticket: response.data.ticket, mediaUrl: mediaUrl.toString() }
}
export async function dialOwnedVoiceCall(attempt: VoiceAttempt, config: VoiceConfig, number: string,
  beforeDial?: (claimed: VoiceAttempt) => Promise<void>) {
  attempt = await updateOwnedVoiceCall(attempt, 'dialing')
  try {
    await beforeDial?.(attempt)
    const response = await backendRequest(config, 'dial', { ...ownerBody(attempt), number }, 45_000)
    if (response.status !== 202 || typeof response.data.id !== 'string' || typeof response.data.state !== 'string') {
      throw new VoiceOwnershipError('RECOVERY_REQUIRED')
    }
    attempt = await updateOwnedVoiceCall(attempt, 'observe', { bootId: attempt.backend_boot_id!,
      callId: response.data.id, state: response.data.state })
    return { id: response.data.id, state: response.data.state, attempt }
  } catch (error) { await markUncertain(attempt); throw error }
}
export async function hangupOwnedVoiceCall(attempt: VoiceAttempt, config: VoiceConfig) {
  if (attempt.finished_at) return { id: attempt.backend_call_id, state: 'ended' }
  const current = await voiceStatus(config)
  const native = assertProtocol(current)
  if (!sameBackendReservation(attempt, native)) {
    const reconciled = await reconcileVoiceAttempt(attempt, config, current, true)
    if (reconciled.attempt.finished_at) return { id: attempt.backend_call_id, state: 'ended' }
    throw new VoiceOwnershipError('RECOVERY_REQUIRED')
  }
  if (!current.call) {
    const reconciled = await reconcileVoiceAttempt(attempt, config, current, true)
    return { id: attempt.backend_call_id, state: reconciled.attempt.finished_at ? 'ended' : 'ending' }
  }
  const response = await backendRequest(config, 'hangup', ownerBody(attempt))
  if (response.status !== 202) throw new VoiceOwnershipError('RECOVERY_REQUIRED')
  return { id: current.call.id, state: 'ending' }
}
export async function releaseOwnedVoiceCall(attempt: VoiceAttempt, config: VoiceConfig) {
  if (attempt.finished_at) return { released: true }
  // Release closes only this owner's media; if native teardown is pending, keep the DB lease.
  const status = await voiceStatus(config)
  const native = assertProtocol(status)
  if (sameBackendReservation(attempt, native)) {
    const result = await backendRequest(config, 'release', ownerBody(attempt))
    if (result.status !== 200) { await markUncertain(attempt); return { released: false } }
  }
  const result = await reconcileVoiceAttempt(attempt, config, undefined, true)
  return { released: !!result.attempt.finished_at }
}
