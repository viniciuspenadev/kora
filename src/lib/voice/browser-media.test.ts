import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BrowserVoiceMedia } from './browser-media'

let grant: (stream: MediaStream) => void
let track: { stop: ReturnType<typeof vi.fn> }
beforeEach(() => {
  vi.useFakeTimers()
  track={stop:vi.fn()}
  vi.stubGlobal('navigator', {mediaDevices:{getUserMedia:vi.fn(() => new Promise<MediaStream>(resolve => { grant=resolve }))}})
  vi.stubGlobal('AudioContext', class {
    state='running'
    resume=async () => {}
    close=async () => { this.state='closed' }
  })
  vi.stubGlobal('fetch',vi.fn())
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
const lateStream=() => ({getTracks:() => [track]}) as unknown as MediaStream

it('close cancels an unresolved microphone prompt; a late grant stops its tracks and cannot obtain a ticket', async () => {
  const media=new BrowserVoiceMedia(); await media.prepare()
  const opening=media.open('fixture-conversation',vi.fn(),vi.fn())
  const rejected=expect(opening).rejects.toThrow('Preparação cancelada.')
  await vi.advanceTimersByTimeAsync(0); media.close(); await rejected
  grant(lateStream()); await vi.advanceTimersByTimeAsync(0)
  expect(track.stop).toHaveBeenCalledTimes(1)
  expect(fetch).not.toHaveBeenCalled()
})
it('an unanswered prompt has a finite deadline and a later grant cannot revive media', async () => {
  const media=new BrowserVoiceMedia(); await media.prepare()
  const opening=media.open('fixture-conversation',vi.fn(),vi.fn())
  const rejected=expect(opening).rejects.toThrow('permissão do microfone demorou')
  await vi.advanceTimersByTimeAsync(60_000); await rejected
  media.close(); grant(lateStream()); await vi.advanceTimersByTimeAsync(0)
  expect(track.stop).toHaveBeenCalledTimes(1)
  expect(fetch).not.toHaveBeenCalled()
})
