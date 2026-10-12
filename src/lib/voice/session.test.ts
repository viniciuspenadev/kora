import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { VoiceSession, callPhase, type VoiceMedia } from "./session"

const target = { conversationId: "conversation-a", name: "Contato de teste" }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((res) => { resolve = res }); return { promise, resolve } }
function setup() {
  let onCall!: Parameters<VoiceMedia["open"]>[1]
  let onDisconnect!: () => void
  const media = {
    open: vi.fn(async (_: string, call: typeof onCall, disconnect: () => void) => { onCall = call; onDisconnect = disconnect }),
    close: vi.fn(), mute: vi.fn(), samples: vi.fn(),
  }
  const request = vi.fn(async (_id: string, action: string): Promise<unknown> => action === "dial" ? { id: "call-a", state: "offering" } : action === "hangup" ? { id: "call-a", state: "ending" } : { ready: true, call: action.includes("callId=") ? { id: "call-a", state: "offering" } : null })
  const session = new VoiceSession(request as never, media)
  return { session, request, media, event: (state: string, id = "call-a") => onCall({ id, state }), disconnect: () => onDisconnect() }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it("abre sem ligar e impede troca de alvo/dupla discagem durante chamada", async () => {
  const { session, request } = setup()
  session.open(target); await vi.advanceTimersByTimeAsync(0)
  expect(request.mock.calls.every(([, action]) => action === "status")).toBe(true)
  await session.start(); await session.start()
  expect(request.mock.calls.filter(([, action]) => action === "dial")).toHaveLength(1)
  expect(session.open({ ...target, conversationId: "other" })).toBe(false)
  expect(session.getSnapshot().target).toEqual(target)
  expect(session.dismiss()).toBe(false)
  session.dispose()
})
it("traduz offering e preserva conexão ao receber um estado antigo", async () => {
  const { session, event } = setup()
  session.open(target); await vi.advanceTimersByTimeAsync(0); await session.start()
  expect(callPhase("offering")).toBe("dialing")
  event("connected"); const connectedAt = session.getSnapshot().connectedAt
  event("ringing"); event("connected", "another-call")
  expect(session.getSnapshot()).toMatchObject({ phase: "connected", connectedAt })
  session.dispose()
})
it("preserva eventos recebidos antes da resposta HTTP, incluindo chamada curta", async () => {
  const { session, event, request, media } = setup()
  const dial = deferred<unknown>()
  request.mockImplementation(async (_id, action) => action === "dial" ? dial.promise : { ready: true, call: null })
  session.open(target); await vi.advanceTimersByTimeAsync(0)
  const starting = session.start(); await vi.advanceTimersByTimeAsync(0)
  event("connected"); event("ended")
  dial.resolve({ id: "call-a", state: "offering" }); await starting
  expect(session.getSnapshot().phase).toBe("ended")
  expect(session.getSnapshot().connectedAt).not.toBeNull()
  expect(media.close).toHaveBeenCalled()
  session.dispose()
})
it("cancelar enquanto pede o microfone não disca depois que a permissão chega", async () => {
  const { session, media, request } = setup()
  const opening = deferred<void>(); media.open.mockReturnValue(opening.promise)
  session.open(target); await vi.advanceTimersByTimeAsync(0)
  const starting = session.start(); await session.hangup(); opening.resolve(); await starting
  expect(request.mock.calls.some(([, action]) => action === "dial")).toBe(false)
  expect(session.getSnapshot().phase).toBe("ended")
  session.dispose()
})
it("cancelar durante a discagem encerra o ID retornado mesmo com resposta tardia", async () => {
  const { session, request } = setup(); const dial = deferred<unknown>()
  request.mockImplementation(async (_id, action) => action === "dial" ? dial.promise : { ready: true, call: null })
  session.open(target); await vi.advanceTimersByTimeAsync(0)
  const starting = session.start(); await vi.advanceTimersByTimeAsync(0); await session.hangup()
  dial.resolve({ id: "call-a", state: "offering" }); await starting
  expect(request).toHaveBeenCalledWith(target.conversationId, "hangup", { callId: "call-a" })
  expect(session.getSnapshot().phase).toBe("ended")
  session.dispose()
})
it("silencia a captura e libera o microfone no término remoto", async () => {
  const { session, media, event } = setup()
  session.open(target); await vi.advanceTimersByTimeAsync(0); await session.start()
  session.mute(); expect(media.mute).toHaveBeenCalledWith(true)
  event("ended"); expect(media.close).toHaveBeenCalled(); expect(session.getSnapshot().muted).toBe(false)
  session.dispose()
})
it("falha de áudio fecha recursos e solicita encerramento da chamada", async () => {
  const { session, media, request, disconnect } = setup()
  session.open(target); await vi.advanceTimersByTimeAsync(0); await session.start()
  disconnect(); await vi.advanceTimersByTimeAsync(0)
  expect(media.close).toHaveBeenCalled()
  expect(request).toHaveBeenCalledWith(target.conversationId, "hangup", { callId: "call-a" })
  session.dispose()
})
it("confirma término por consulta quando o pedido de desligar falha", async () => {
  const { session, request, media } = setup()
  session.open(target); await vi.advanceTimersByTimeAsync(0); await session.start()
  await vi.advanceTimersByTimeAsync(0)
  request.mockImplementation(async (_id, action) => {
    if (action === "hangup") throw new Error("network")
    return { ready: true, call: null }
  })
  await session.hangup()
  expect(session.getSnapshot().phase).toBe("ended")
  expect(media.close).toHaveBeenCalled()
  session.dispose()
})
it("não encerra a chamada de outro atendente quando a linha muda de dono", async () => {
  const { session, request } = setup()
  session.open(target); await vi.advanceTimersByTimeAsync(0); await session.start()
  await vi.advanceTimersByTimeAsync(0)
  request.mockResolvedValue({ ready: true, call: { id: "", state: "busy" } })
  await session.refresh(); await session.start()
  expect(session.getSnapshot()).toMatchObject({ phase: "ended", busy: true })
  expect(request.mock.calls.filter(([, action]) => action === "dial")).toHaveLength(1)
  expect(request.mock.calls.some(([, action]) => action === "hangup")).toBe(false)
  session.dispose()
})
