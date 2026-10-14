import { VoiceRequestError, type BrowserCallOwner } from './ownership-contract'

export type VoiceTarget = { conversationId: string; name: string; phone?: string }
export type VoicePhase = "idle" | "preparing" | "dialing" | "ringing" | "connected" | "ending" | "ended" | "error"
export type VoiceSnapshot = {
  target: VoiceTarget | null; phase: VoicePhase; ready: boolean; busy: boolean; checked: boolean
  muted: boolean; error: string | null; connectedAt: number | null; endedAt: number | null
}
type Call = { id: string; state: string }
type Status = { ready: boolean; call: Call | null; ownershipRequired?: boolean; released?: boolean }
export interface VoiceMedia {
  prepare?: () => Promise<void>
  open: (conversationId: string, onCall: (call: Call) => void, onDisconnect: () => void, owner?: BrowserCallOwner) => Promise<void>
  close: () => void
  mute: (muted: boolean) => void
  samples: (side: "local" | "remote", values: Uint8Array<ArrayBuffer>) => void
}
type Request = <T>(conversationId: string, action: string, body?: unknown) => Promise<T>
const activePhases = new Set<VoicePhase>(["preparing", "dialing", "ringing", "connected", "ending"])
export const voiceIsActive = (phase: VoicePhase) => activePhases.has(phase)
export const voicePhaseLabel: Record<VoicePhase, string> = {
  idle: "Pronto para ligar", preparing: "Preparando microfone…", dialing: "Chamando…",
  ringing: "Tocando…", connected: "Em ligação", ending: "Encerrando…", ended: "Ligação encerrada", error: "Não foi possível continuar",
}
export function callPhase(state: string): VoicePhase | null {
  if (state === "offering") return "dialing"
  return ["dialing", "ringing", "connected", "ending", "ended"].includes(state) ? state as VoicePhase : null
}

/** Lives above the route tree: opening/minimizing a view never owns the media lifetime. */
export class VoiceSession {
  private snapshot: VoiceSnapshot = { target: null, phase: "idle", ready: false, busy: false, checked: false, muted: false, error: null, connectedAt: null, endedAt: null }
  private listeners = new Set<() => void>()
  private callId: string | null = null
  private starting = false
  private canceled = false
  private refreshing = false
  private timer: ReturnType<typeof setInterval> | null = null
  private pendingCalls: Call[] = []
  private ownershipRequired = false
  private owner: BrowserCallOwner | null = null
  private browserSessionId: string | null = null
  private reserving = false
  private releasing = false
  private lastOwnedRefresh = 0
  private failedCleanup = false
  constructor(private request: Request, readonly media: VoiceMedia) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => this.snapshot
  private update(patch: Partial<VoiceSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach((listener) => listener())
  }
  open(target: VoiceTarget): boolean {
    if (voiceIsActive(this.snapshot.phase) || this.starting) return this.snapshot.target?.conversationId === target.conversationId
    this.stopPolling()
    this.callId = null
    this.ownershipRequired = false
    this.update({ target, phase: "idle", ready: false, busy: false, checked: false, error: null, muted: false, connectedAt: null, endedAt: null })
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), 2500)
    return true
  }
  private stopPolling() { if (this.timer) clearInterval(this.timer); this.timer = null }
  async refresh() {
    const target = this.snapshot.target
    if (!target || this.refreshing || this.reserving) return
    if (this.owner && this.snapshot.phase === 'connected' && Date.now() - this.lastOwnedRefresh < 10000) return
    const requestedCallId = this.callId
    const requestedOwner = this.owner
    this.refreshing = true
    try {
      const status = requestedOwner
        ? await this.request<Status>(target.conversationId, 'status', { owner: requestedOwner })
        : await this.request<Status>(target.conversationId, requestedCallId ? `status?callId=${encodeURIComponent(requestedCallId)}` : "status")
      if (this.snapshot.target !== target || requestedCallId !== this.callId || requestedOwner !== this.owner) return
      this.lastOwnedRefresh = Date.now()
      if (!requestedOwner) this.ownershipRequired = status.ownershipRequired === true
      this.update({ checked: true, ready: status.ready, busy: !!status.call && status.call.id !== this.callId, ...(this.snapshot.phase === "idle" ? { error: null } : {}) })
      if (requestedOwner && status.released && !this.starting) { this.finish(true); this.update({ busy: !!status.call }); return }
      if (requestedOwner && this.snapshot.phase === 'ending' && !this.starting) void this.releaseOwner()
      if (requestedCallId && status.call?.id === requestedCallId) this.onCall(status.call)
      else if (requestedCallId) { this.finish(); this.update({ busy: !!status.call }) }
    } catch (error) {
      if (this.snapshot.target === target) this.update({ checked: true, ready: false, error: error instanceof Error ? error.message : "Não foi possível verificar a linha." })
      if (this.owner && this.snapshot.phase === 'ending') void this.releaseOwner()
    } finally { this.refreshing = false }
  }
  private onCall = (call: Call) => {
    if (!this.callId) {
      if (this.starting && this.pendingCalls.length < 32) this.pendingCalls.push(call)
      return
    }
    if (call.id !== this.callId) return
    const phase = callPhase(call.state)
    if (!phase) return
    if (phase === "ended") { this.finish(); return }
    if (this.snapshot.phase === "ending" || this.canceled) return
    // Poll responses can arrive after a newer media event.
    const rank = { dialing: 1, ringing: 2, connected: 3, ending: 4 }
    if (rank[phase as keyof typeof rank] < (rank[this.snapshot.phase as keyof typeof rank] ?? 0)) return
    this.update({ phase, error: null, connectedAt: phase === "connected" ? this.snapshot.connectedAt ?? Date.now() : this.snapshot.connectedAt })
  }
  private finish(ownerReleased = false) {
    this.callId = null
    this.media.close()
    if (this.owner && !ownerReleased) { void this.releaseOwner(); return }
    this.owner = null
    this.update({ phase: this.failedCleanup ? 'error' : "ended", endedAt: Date.now(), muted: false, busy: false })
  }
  private async releaseOwner() {
    const target = this.snapshot.target, owner = this.owner
    if (!target || !owner || this.releasing) return
    this.releasing = true
    this.update({ phase: 'ending', muted: false })
    try {
      const result = await this.request<{ released: boolean }>(target.conversationId, 'release', { owner })
      if (this.owner !== owner) return
      if (result.released) this.finish(true)
      else this.update({ error: 'Confirmando encerramento na linha…' })
    } catch {
      if (this.owner === owner) this.update({ error: 'Confirmando encerramento na linha…' })
    } finally { this.releasing = false }
  }
  private disconnected = () => {
    if (!voiceIsActive(this.snapshot.phase)) return
    this.canceled = true
    this.media.close()
    this.update({ phase: this.starting ? "ending" : "error", ready: false, error: "O canal de áudio foi desconectado. Verifique a linha antes de tentar novamente.", endedAt: Date.now() })
    // Closing the media socket also asks Evolution to end its active call.
    if (this.callId) void this.hangup()
  }
  async start() {
    const target = this.snapshot.target
    if (!target || this.starting || voiceIsActive(this.snapshot.phase) || !this.snapshot.ready || this.snapshot.busy) return
    this.starting = true; this.canceled = false; this.callId = null; this.pendingCalls = []
    this.failedCleanup = false
    this.update({ phase: "preparing", error: null, connectedAt: null, endedAt: null, muted: false })
    try {
      if (this.ownershipRequired) {
        // Resume AudioContext in the click gesture; the microphone and socket open after admission.
        await this.media.prepare?.()
        if (this.canceled) { this.finish(); return }
        this.browserSessionId ??= crypto.randomUUID()
        const bytes = crypto.getRandomValues(new Uint8Array(32))
        this.owner = { attemptId: crypto.randomUUID(), browserSessionId: this.browserSessionId,
          ownerToken: Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('') }
        this.reserving = true
        try { await this.request(target.conversationId, 'reserve', { owner: this.owner }) }
        catch (error) {
          if (error instanceof VoiceRequestError && ['LINE_BUSY','OPERATOR_BUSY','NOT_ALLOWED','INVALID_OWNER',
            'ATTEMPT_CLOSED','ENGINE_NOT_READY','PROTOCOL_UNAVAILABLE','RATE_LIMITED'].includes(error.code ?? '')) this.owner = null
          throw error
        }
        finally { this.reserving = false }
        if (this.canceled) { this.finish(); return }
      }
      await this.media.open(target.conversationId, this.onCall, this.disconnected, this.owner ?? undefined)
      if (this.canceled) { this.finish(); return }
      this.update({ phase: "dialing" })
      const call = await this.request<Call>(target.conversationId, "dial", this.owner ? { owner: this.owner } : {})
      if (!call.id) throw new Error("A linha não confirmou o início da chamada.")
      this.callId = call.id
      if (this.canceled) { await this.hangup(); return }
      this.onCall(call)
      for (const event of [...this.pendingCalls]) this.onCall(event)
      void this.refresh()
    } catch (error) {
      this.media.close()
      this.failedCleanup = !this.canceled
      this.update({ phase: this.canceled ? "ended" : "error", endedAt: Date.now(), error: this.canceled ? this.snapshot.error : error instanceof Error ? error.message : "Não foi possível iniciar a ligação." })
      if (this.owner) void this.releaseOwner()
    } finally { this.starting = false; this.pendingCalls = []; this.update({}) }
  }
  async hangup() {
    const target = this.snapshot.target
    if (!target) return
    this.canceled = true
    this.update({ phase: "ending" })
    // If dial is pending, start() will hang up the returned call ID.
    if (!this.callId) {
      this.media.close()
      // A pending permission prompt or lost reserve response must not defer cancellation.
      if (this.owner) void this.releaseOwner()
      if (!this.starting) this.finish()
      return
    }
    const id = this.callId
    try {
      await this.request(target.conversationId, "hangup", { callId: id, ...(this.owner ? { owner: this.owner } : {}) })
      if (this.callId === id) this.finish()
    } catch {
      this.media.close()
      this.update({ phase: "ending", error: "Áudio fechado. Confirmando encerramento na linha…" })
      await this.refresh()
    }
  }
  mute() { const muted = !this.snapshot.muted; this.media.mute(muted); this.update({ muted }) }
  dismiss() {
    if (voiceIsActive(this.snapshot.phase) || this.starting) return false
    this.stopPolling(); this.media.close(); this.update({ target: null }); return true
  }
  dispose() { this.canceled = true; this.stopPolling(); this.media.close(); if (this.owner) void this.releaseOwner(); this.listeners.clear() }
}
