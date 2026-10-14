import { beforeEach, expect, it, vi } from 'vitest'
import type { VoiceAttempt, BrowserCallOwner } from './ownership-contract'
import type { VoiceConfig, VoiceStatus } from './blue'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/visibility', () => ({ getViewerScope: vi.fn() }))
vi.mock('./blue', () => ({ voiceStatus: vi.fn(), voiceConfigForInstance: vi.fn() }))
vi.mock('./ownership-store', async () => {
  const actual = await vi.importActual<typeof import('./ownership-store')>('./ownership-store')
  return { ...actual, claimVoiceCall: vi.fn(), finishReconciledVoiceCall: vi.fn(), refreshVoiceAttempt: vi.fn(),
    updateOwnedVoiceCall: vi.fn(), occupiedVoiceLine: vi.fn(), ownedVoiceCall: vi.fn(), cancelPendingVoiceClaim: vi.fn() }
})
const store = await import('./ownership-store')
const { voiceStatus } = await import('./blue')
const { prepareOwnedVoiceCall, reconcileVoiceAttempt, ownedVoiceStatus, dialOwnedVoiceCall } = await import('./ownership')
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
let attempt: VoiceAttempt
let status: VoiceStatus
const config = { url: new URL('https://fixture.example'), key: 'synthetic-key', instanceName: 'fixture-line', instanceId: id(3) } as VoiceConfig
const context = { config, scope: { tenantId: id(2), userId: id(4) }, conversationId: id(5) }
const owner: BrowserCallOwner = { attemptId: id(1), browserSessionId: id(6), ownerToken: 'a'.repeat(64) }

beforeEach(() => {
  vi.resetAllMocks()
  attempt = { id: id(1), tenant_id: id(2), instance_id: id(3), operator_id: id(4), conversation_id: id(5),
    browser_session_id: id(6), owner_token_hash: 'b'.repeat(64), fence: '9007199254740996', state: 'preparing',
    backend_origin: config.url.origin, backend_instance_name: config.instanceName, backend_line_key: 'c'.repeat(64),
    backend_boot_id: id(7), backend_call_id: null, created_at: new Date().toISOString(),
    lease_expires_at: new Date(Date.now()+90_000).toISOString(), prepare_deadline_at: new Date(Date.now()+120_000).toISOString(),
    finished_at: null, dial_requested_at: null }
  status = { enabled: true, ready: true, call: null, ownership: { protocol: 1, bootId: id(7),
    mediaConnected: false, dialing: false, dialAttempted: false, reservation: {
      id: attempt.id, fence: attempt.fence, expiresAt: Date.parse(attempt.lease_expires_at) } } }
  vi.mocked(voiceStatus).mockImplementation(async () => structuredClone(status))
  vi.mocked(store.refreshVoiceAttempt).mockImplementation(async () => ({...attempt}))
  vi.mocked(store.claimVoiceCall).mockImplementation(async () => ({...attempt}))
  vi.mocked(store.updateOwnedVoiceCall).mockImplementation(async (_row, action) => {
    if (action === 'recovering') attempt.state='recovering'
    if (action === 'dialing') { attempt.state='dialing'; attempt.dial_requested_at=new Date().toISOString() }
    return {...attempt}
  })
  vi.mocked(store.finishReconciledVoiceCall).mockImplementation(async (_row, outcome) => {
    attempt.state=outcome; attempt.finished_at=new Date().toISOString(); return {...attempt}
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ownership: {...status.ownership,reservation:null}, call:null }), {status:200})))
})

it('native pending dialing retains expired ownership instead of releasing the line', async () => {
  attempt.lease_expires_at=new Date(0).toISOString(); status.ownership!.dialing=true
  const result=await reconcileVoiceAttempt(attempt,config)
  expect(result.attempt.finished_at).toBeNull()
  expect(store.finishReconciledVoiceCall).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})
it('a different native owner cannot be released or finalized by stale reconciliation', async () => {
  status.ownership!.reservation!.id=id(8)
  await expect(reconcileVoiceAttempt(attempt,config)).rejects.toMatchObject({code:'RECOVERY_REQUIRED'})
  expect(store.finishReconciledVoiceCall).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})
it('a missing unconfirmed native claim is retained until its late request can no longer enter', async () => {
  attempt.backend_boot_id=null; status.ownership!.reservation=null
  await reconcileVoiceAttempt(attempt,config,undefined,true)
  expect(store.finishReconciledVoiceCall).not.toHaveBeenCalled()
  attempt.lease_expires_at=new Date(0).toISOString()
  const result=await reconcileVoiceAttempt(attempt,config)
  expect(result.attempt.state).toBe('cancelled')
})
it('backend restart produces an interrupted result, not a normal ended duration', async () => {
  attempt.state='connected'; attempt.backend_call_id='fixture-call'; attempt.dial_requested_at=new Date().toISOString()
  status.ownership!.bootId=id(8); status.ownership!.reservation=null
  const result=await reconcileVoiceAttempt(attempt,config)
  expect(result.attempt.state).toBe('interrupted')
})
it('background timeline observers cannot renew a vanished browser lease', async () => {
  attempt.state='connected'; attempt.backend_call_id='fixture-call'; status.call={id:'fixture-call',state:'connected'}
  await ownedVoiceStatus(attempt,config,false)
  expect(store.updateOwnedVoiceCall).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})
it('revoked permission requests native hangup and never sends a native renewal', async () => {
  attempt.state='connected'; attempt.backend_call_id='fixture-call'; status.call={id:'fixture-call',state:'connected'}
  vi.mocked(store.updateOwnedVoiceCall).mockRejectedValue(new store.VoiceOwnershipError('PERMISSION_REVOKED',403))
  await expect(ownedVoiceStatus(attempt,config)).rejects.toMatchObject({code:'PERMISSION_REVOKED'})
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain('/voice/hangup/')
})
it('lost backend admission response marks the persisted attempt recovering without re-admitting it', async () => {
  attempt.backend_boot_id=null; status.ownership!.reservation=null
  vi.mocked(fetch).mockRejectedValue(new Error('Response lost'))
  await expect(prepareOwnedVoiceCall(context,owner)).rejects.toThrow('Response lost')
  expect(store.claimVoiceCall).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(attempt.state).toBe('recovering')
})
it('a rejected duplicate dial cannot create another bubble or issue a native call', async () => {
  vi.mocked(store.updateOwnedVoiceCall).mockRejectedValue(new store.VoiceOwnershipError('DIAL_NOT_ALLOWED'))
  const bubble=vi.fn()
  await expect(dialOwnedVoiceCall(attempt,config,'5500000000000',bubble)).rejects.toMatchObject({code:'DIAL_NOT_ALLOWED'})
  expect(bubble).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})
