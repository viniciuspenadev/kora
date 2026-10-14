export type BrowserCallOwner = { attemptId: string; browserSessionId: string; ownerToken: string }
export class VoiceRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message) }
}
export type VoiceAttemptState = 'preparing' | 'dialing' | 'ringing' | 'connected' | 'ending' | 'recovering'
  | 'ended' | 'cancelled' | 'failed' | 'interrupted' | 'unknown'
export type VoiceAttempt = {
  id: string; tenant_id: string; instance_id: string; conversation_id: string; operator_id: string
  browser_session_id: string; owner_token_hash: string; fence: string; state: VoiceAttemptState
  backend_origin: string; backend_instance_name: string; backend_line_key: string
  backend_boot_id: string | null; backend_call_id: string | null; created_at: string
  prepare_deadline_at: string; lease_expires_at: string; finished_at: string | null
  dial_requested_at: string | null
}
export type VoiceTerminalOutcome = 'ended' | 'cancelled' | 'failed' | 'interrupted' | 'unknown'
export function terminalVoiceOutcome(state: VoiceAttemptState): VoiceTerminalOutcome {
  return ['ended','cancelled','failed','interrupted','unknown'].includes(state) ? state as VoiceTerminalOutcome : 'unknown'
}
export type BackendCallOwner = {
  reservationId: string; tenantId: string; instanceId: string; operatorId: string
  browserSessionId: string; tokenHash: string; fence: string; expiresAt: number
}
export type BackendOwnershipStatus = {
  protocol: 1; bootId: string; mediaConnected: boolean; dialing: boolean; dialAttempted: boolean
  reservation: { id: string; fence: string; expiresAt: number } | null
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function parseBrowserCallOwner(value: unknown): BrowserCallOwner | null {
  if (!value || typeof value !== 'object') return null
  const owner = value as Partial<BrowserCallOwner>
  if (typeof owner.attemptId !== 'string' || !uuid.test(owner.attemptId) ||
    typeof owner.browserSessionId !== 'string' || !uuid.test(owner.browserSessionId) ||
    typeof owner.ownerToken !== 'string' || !/^[0-9a-f]{64}$/.test(owner.ownerToken)) return null
  return { attemptId: owner.attemptId, browserSessionId: owner.browserSessionId, ownerToken: owner.ownerToken }
}
export function backendOwner(attempt: VoiceAttempt): BackendCallOwner {
  return { reservationId: attempt.id, tenantId: attempt.tenant_id, instanceId: attempt.instance_id,
    operatorId: attempt.operator_id, browserSessionId: attempt.browser_session_id,
    tokenHash: attempt.owner_token_hash, fence: attempt.fence, expiresAt: Date.parse(attempt.lease_expires_at) }
}
export function sameBackendReservation(attempt: VoiceAttempt, status: BackendOwnershipStatus): boolean {
  return status.reservation?.id === attempt.id && status.reservation.fence === attempt.fence &&
    (!attempt.backend_boot_id || status.bootId === attempt.backend_boot_id)
}
export function parseBackendOwnershipStatus(value: unknown): BackendOwnershipStatus | null {
  if (!value || typeof value !== 'object') return null
  const status = value as BackendOwnershipStatus
  if (status.protocol !== 1 || typeof status.bootId !== 'string' || !uuid.test(status.bootId) ||
    typeof status.mediaConnected !== 'boolean' || typeof status.dialing !== 'boolean' || typeof status.dialAttempted !== 'boolean') return null
  if (status.reservation !== null && (!status.reservation || typeof status.reservation.id !== 'string' || !uuid.test(status.reservation.id) ||
    typeof status.reservation.fence !== 'string' || !/^[1-9][0-9]{0,18}$/.test(status.reservation.fence) || !Number.isSafeInteger(status.reservation.expiresAt))) return null
  return { protocol: 1, bootId: status.bootId, mediaConnected: status.mediaConnected, dialing: status.dialing,
    dialAttempted: status.dialAttempted, reservation: status.reservation ? { ...status.reservation } : null }
}
export const ownershipErrors: Record<string, string> = {
  RATE_LIMITED: 'Aguarde alguns instantes antes de iniciar outra tentativa.',
  PERMISSION_REVOKED: 'A permissão de ligação foi alterada. A chamada está sendo encerrada.',
  LINE_BUSY: 'Este número já está reservado para outra ligação.',
  OPERATOR_BUSY: 'Você já tem uma ligação em outra aba ou número.',
  RECOVERY_REQUIRED: 'Estamos confirmando o encerramento da ligação anterior. Tente novamente em instantes.',
  INVALID_OWNER: 'Esta aba não é a proprietária da ligação.',
  ATTEMPT_CLOSED: 'Esta tentativa já foi encerrada. Inicie uma nova ligação.',
  NOT_ALLOWED: 'Ligação não habilitada para este atendente.',
  BACKEND_CHANGED: 'A sessão de voz foi reiniciada. Aguarde a recuperação da linha.',
  DIAL_NOT_ALLOWED: 'A reserva expirou ou a discagem já foi solicitada.',
  CALL_CHANGED: 'A ligação ativa não corresponde a esta tentativa.',
  INVALID_STATE: 'O estado da ligação mudou. Atualize o painel.',
  STALE_FENCE: 'Esta tentativa foi substituída.',
}
