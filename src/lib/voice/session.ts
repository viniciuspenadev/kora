export type VoiceTarget = { conversationId: string; name: string; phone?: string }
export type VoicePhase = "idle" | "preparing" | "dialing" | "ringing" | "connected" | "ending" | "ended" | "error"
export type VoiceSnapshot = {
  target: VoiceTarget | null; phase: VoicePhase; ready: boolean; busy: boolean; checked: boolean
  muted: boolean; error: string | null; connectedAt: number | null; endedAt: number | null
}
type Call = { id: string; state: string }
type Status = { ready: boolean; call: Call | null }
export interface VoiceMedia {
  open: (conversationId: string, onCall: (call: Call) => void, onDisconnect: () => void) => Promise<void>
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
    this.update({ target, phase: "idle", ready: false, busy: false, checked: false, error: null, muted: false, connectedAt: null, endedAt: null })
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), 2500)
    return true
  }
  private stopPolling() { if (this.timer) clearInterval(this.timer); this.timer = null }
  async refresh() {
    const target = this.snapshot.target
    if (!target || this.refreshing) return
    const requestedCallId = this.callId
    this.refreshing = true
    try {
      const status = await this.request<Status>(target.conversationId, requestedCallId ? `status?callId=${encodeURIComponent(requestedCallId)}` : "status")
      if (this.snapshot.target !== target || requestedCallId !== this.callId) return
      this.update({ checked: true, ready: status.ready, busy: !!status.call && status.call.id !== this.callId, ...(this.snapshot.phase === "idle" ? { error: null } : {}) })
      if (requestedCallId && status.call?.id === requestedCallId) this.onCall(status.call)
      else if (requestedCallId) { this.finish(); this.update({ busy: !!status.call }) }
    } catch (error) {
      if (this.snapshot.target === target) this.update({ checked: true, ready: false, error: error instanceof Error ? error.message : "Não foi possível verificar a linha." })
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
  private finish() {
    this.callId = null
    this.media.close()
    this.update({ phase: "ended", endedAt: Date.now(), muted: false, busy: false })
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
    this.update({ phase: "preparing", error: null, connectedAt: null, endedAt: null, muted: false })
    try {
      await this.media.open(target.conversationId, this.onCall, this.disconnected)
      if (this.canceled) { this.finish(); return }
      this.update({ phase: "dialing" })
      const call = await this.request<Call>(target.conversationId, "dial", {})
      if (!call.id) throw new Error("A linha não confirmou o início da chamada.")
      this.callId = call.id
      if (this.canceled) { await this.hangup(); return }
      this.onCall(call)
      for (const event of [...this.pendingCalls]) this.onCall(event)
      void this.refresh()
    } catch (error) {
      this.media.close()
      this.update({ phase: this.canceled ? "ended" : "error", endedAt: Date.now(), error: this.canceled ? this.snapshot.error : error instanceof Error ? error.message : "Não foi possível iniciar a ligação." })
    } finally { this.starting = false; this.pendingCalls = []; this.update({}) }
  }
  async hangup() {
    const target = this.snapshot.target
    if (!target) return
    this.canceled = true
    this.update({ phase: "ending" })
    // If dial is pending, start() will hang up the returned call ID.
    if (!this.callId) { this.media.close(); if (!this.starting) this.finish(); return }
    const id = this.callId
    try {
      await this.request(target.conversationId, "hangup", { callId: id })
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
  dispose() { this.canceled = true; this.stopPolling(); this.media.close(); this.listeners.clear() }
}
