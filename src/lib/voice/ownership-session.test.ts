import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VoiceSession, type VoiceMedia } from './session'
import { VoiceRequestError, type BrowserCallOwner } from './ownership-contract'

const target = { conversationId: 'conversation-a', name: 'Test contact' }
function setup() {
  const order: string[] = []
  let event!: Parameters<VoiceMedia['open']>[1]
  let released = false
  const request = vi.fn(async (_conversation: string, action: string, body?: unknown): Promise<unknown> => {
    const owner = (body as { owner?: BrowserCallOwner } | undefined)?.owner
    if (action === 'status') return { ready: true, ownershipRequired: true,
      call: owner && !released ? { id: 'call-a', state: 'connected' } : null, ...(owner ? { released } : {}) }
    order.push(action)
    if (action === 'reserve') return { attemptId: owner?.attemptId }
    if (action === 'dial') return { id: 'call-a', state: 'offering' }
    if (action === 'hangup') return { id: 'call-a', state: 'ending' }
    if (action === 'release') return { released }
    throw new Error('unexpected action')
  })
  const media = {
    prepare: vi.fn(async () => { order.push('prepare') }),
    open: vi.fn(async (_conversation: string, callback: typeof event, _disconnect: () => void, _owner?: BrowserCallOwner) => {
      void _disconnect; void _owner
      event=callback; order.push('media')
    }), close: vi.fn(), mute: vi.fn(), samples: vi.fn(),
  }
  const session = new VoiceSession(request as never, media)
  return { session, request, media, order, event: (state: string) => event({ id: 'call-a', state }), release: () => { released=true } }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
it('reserves before opening microphone/media and binds all commands to the same owner without URL secrets', async () => {
  const f=setup(); f.session.open(target); await vi.advanceTimersByTimeAsync(0); await f.session.start()
  expect(f.order.slice(0,4)).toEqual(['prepare','reserve','media','dial'])
  const owner=(f.request.mock.calls.find(([,action]) => action==='reserve')![2] as {owner: BrowserCallOwner}).owner
  expect(owner.ownerToken).toMatch(/^[0-9a-f]{64}$/)
  expect(f.media.open.mock.calls[0][3]).toEqual(owner)
  expect((f.request.mock.calls.find(([,action]) => action==='dial')![2] as {owner: BrowserCallOwner}).owner).toEqual(owner)
  expect(f.request.mock.calls.every(([,action]) => !action.includes(owner.ownerToken))).toBe(true)
  f.release(); f.session.dispose(); await vi.advanceTimersByTimeAsync(0)
})
it('a competing operator refusal never opens audio or leaves an owned cleanup loop', async () => {
  const f=setup(); f.request.mockImplementation(async (_id, action) => {
    if(action==='reserve') throw new VoiceRequestError('Operator busy',409,'OPERATOR_BUSY')
    return { ready:true,ownershipRequired:true,call:null }
  })
  f.session.open(target); await vi.advanceTimersByTimeAsync(0); await f.session.start()
  expect(f.media.open).not.toHaveBeenCalled()
  expect(f.request.mock.calls.some(([,a]) => a==='dial' || a==='release')).toBe(false)
  expect(f.session.getSnapshot().phase).toBe('error')
  f.session.dispose()
})
it('keeps the panel ending until the server confirms lease release; another target cannot start', async () => {
  const f=setup(); f.session.open(target); await vi.advanceTimersByTimeAsync(0); await f.session.start(); f.event('connected')
  await f.session.hangup(); await vi.advanceTimersByTimeAsync(0)
  expect(f.session.getSnapshot().phase).toBe('ending')
  expect(f.session.open({...target,conversationId:'another-line'})).toBe(false)
  f.release(); await f.session.refresh()
  expect(f.session.getSnapshot().phase).toBe('ended')
  f.session.dispose()
})
it('an ambiguous reserve response cancels that exact attempt and never proceeds to dialing', async () => {
  const f=setup(); const normal=f.request.getMockImplementation()!
  f.request.mockImplementation(async (id,action,body) => {
    if(action==='reserve') throw new Error('Response lost')
    if(action==='release') return {released:true}
    return normal(id,action,body)
  })
  f.session.open(target); await vi.advanceTimersByTimeAsync(0); await f.session.start(); await vi.advanceTimersByTimeAsync(0)
  const reserved=f.request.mock.calls.find(([,a]) => a==='reserve')![2]
  expect(f.request.mock.calls.find(([,a]) => a==='release')![2]).toEqual(reserved)
  expect(f.media.open).not.toHaveBeenCalled()
  expect(f.request.mock.calls.some(([,a]) => a==='dial')).toBe(false)
  expect(f.session.getSnapshot().phase).toBe('error')
  f.session.dispose()
})

it('cancel while microphone permission is pending releases the admitted owner before the prompt resolves', async () => {
  const f=setup()
  let resolve!: () => void
  f.media.open.mockImplementation(() => new Promise<void>(done => { resolve=done }))
  f.session.open(target); await vi.advanceTimersByTimeAsync(0)
  const starting=f.session.start(); await vi.advanceTimersByTimeAsync(0)
  f.release(); await f.session.hangup(); await vi.advanceTimersByTimeAsync(0)
  expect(f.request.mock.calls.some(([,action]) => action==='release')).toBe(true)
  expect(f.request.mock.calls.some(([,action]) => action==='dial')).toBe(false)
  resolve(); await starting
  expect(f.session.getSnapshot().phase).toBe('ended')
  f.session.dispose()
})
