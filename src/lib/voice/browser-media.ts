import type { VoiceMedia } from "./session"
import { VoiceRequestError, type BrowserCallOwner } from './ownership-contract'

export async function voiceRequest<T>(conversationId: string, action: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/voice/${encodeURIComponent(conversationId)}/${action}`, {
    method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(action === "dial" ? 50_000 : 20_000),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new VoiceRequestError(data.error ?? "A linha está indisponível. Tente novamente.", response.status,
    typeof data.code === 'string' ? data.code : undefined)
  return data as T
}

export class BrowserVoiceMedia implements VoiceMedia {
  private generation = 0
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private socket: WebSocket | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private silent: GainNode | null = null
  private local: AnalyserNode | null = null
  private remote: AnalyserNode | null = null
  private captureRate = 16000
  private previousSample = 0
  private nextPosition = 0
  private playbackAt = 0
  private cancelMicrophone: (() => void) | null = null
  private requestMicrophone(generation: number): Promise<MediaStream> {
    return new Promise((resolve, reject) => {
      let settled = false
      const clear = () => {
        clearTimeout(timeout)
        if (this.cancelMicrophone === cancel) this.cancelMicrophone = null
      }
      const fail = (message: string) => {
        if (settled) return
        settled = true; clear(); reject(new Error(message))
      }
      const cancel = () => fail('Preparação cancelada.')
      const timeout = setTimeout(() => fail('A permissão do microfone demorou para responder. Tente novamente.'), 60_000)
      this.cancelMicrophone = cancel
      try {
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
          .then(stream => {
            if (settled || generation !== this.generation) {
              stream.getTracks().forEach(track => track.stop())
              if (!settled) cancel()
              return
            }
            settled = true; clear(); resolve(stream)
          }, () => fail('Permita o microfone no navegador para iniciar a ligação.'))
      } catch { fail('Permita o microfone no navegador para iniciar a ligação.') }
    })
  }
  async prepare() {
    this.close()
    this.context = new AudioContext()
    await this.context.resume()
  }
  async open(conversationId: string, onCall: Parameters<VoiceMedia["open"]>[1], onDisconnect: () => void, owner?: BrowserCallOwner) {
    const preparedContext = this.context
    if (!preparedContext) this.close()
    const generation = this.generation
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador não disponibiliza o microfone.")
    // Create/resume in the click gesture, before awaiting network or microphone permission.
    const context = preparedContext ?? new AudioContext()
    this.context = context
    await context.resume()
    if (generation !== this.generation) throw new Error('Preparação cancelada.')
    const stream = await this.requestMicrophone(generation)
    if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); throw new Error("Preparação cancelada.") }
    this.stream = stream
    stream.getAudioTracks().forEach(track => track.addEventListener("ended", () => {
      if (generation === this.generation) onDisconnect()
    }, { once: true }))
    this.local = context.createAnalyser(); this.local.fftSize = 256
    this.remote = context.createAnalyser(); this.remote.fftSize = 256; this.remote.connect(context.destination)
    this.source = context.createMediaStreamSource(stream)
    this.source.connect(this.local)
    this.processor = context.createScriptProcessor(1024, 1, 1)
    this.silent = context.createGain(); this.silent.gain.value = 0
    this.source.connect(this.processor); this.processor.connect(this.silent); this.silent.connect(context.destination)
    this.processor.onaudioprocess = event => {
      if (this.socket?.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 128 * 1024) return
      const input = event.inputBuffer.getChannelData(0)
      const joined = new Float32Array(input.length + 1); joined[0] = this.previousSample; joined.set(input, 1)
      const step = context.sampleRate / this.captureRate
      const output: number[] = []
      while (this.nextPosition + 1 < joined.length) {
        const index = Math.floor(this.nextPosition), fraction = this.nextPosition - index
        output.push(joined[index] * (1 - fraction) + joined[index + 1] * fraction)
        this.nextPosition += step
      }
      this.nextPosition -= input.length; this.previousSample = joined[joined.length - 1]
      if (output.length) this.socket.send(Float32Array.from(output).buffer)
    }
    const { ticket, mediaUrl } = await voiceRequest<{ ticket: string; mediaUrl: string }>(conversationId, "media-ticket", owner ? { owner } : {})
    if (generation !== this.generation) throw new Error("Preparação cancelada.")
    const socket = new WebSocket(mediaUrl, ["voice", ticket]); socket.binaryType = "arraybuffer"; this.socket = socket
    socket.addEventListener("message", event => {
      if (generation !== this.generation) return
      if (event.data instanceof ArrayBuffer) {
        if (event.data.byteLength % 4 !== 0 || !event.data.byteLength || !this.remote) return
        const pcm = new Float32Array(event.data)
        const buffer = context.createBuffer(1, pcm.length, 16000); buffer.copyToChannel(pcm, 0)
        const source = context.createBufferSource(); source.buffer = buffer; source.connect(this.remote)
        if (this.playbackAt < context.currentTime + .04 || this.playbackAt > context.currentTime + .5) this.playbackAt = context.currentTime + .06
        source.start(this.playbackAt); this.playbackAt += buffer.duration
        source.onended = () => source.disconnect()
        return
      }
      try {
        const message = JSON.parse(event.data)
        if (message.type === "call" && typeof message.call?.id === "string" && typeof message.call.state === "string") onCall(message.call)
        else if (message.type === "capture-format" && message.format?.channels === 1 && Number.isInteger(message.format.sampleRate) && message.format.sampleRate >= 8000 && message.format.sampleRate <= 48000) {
          this.captureRate = message.format.sampleRate; this.previousSample = 0; this.nextPosition = 0
        } else if (message.type === "status" && !message.ready) onDisconnect()
      } catch { /* Ignore malformed media events. */ }
    })
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { reject(new Error("O canal de áudio demorou para responder.")); socket.close() }, 10000)
      socket.addEventListener("open", () => { clearTimeout(timeout); resolve() }, { once: true })
      socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Não foi possível abrir o canal de áudio.")) }, { once: true })
      socket.addEventListener("close", () => { clearTimeout(timeout); reject(new Error("O canal de áudio foi fechado.")); if (generation === this.generation) onDisconnect() }, { once: true })
    })
  }
  samples(side: "local" | "remote", values: Uint8Array<ArrayBuffer>) {
    const analyser = side === "local" ? this.local : this.remote
    if (analyser) analyser.getByteTimeDomainData(values); else values.fill(128)
  }
  mute(muted: boolean) { this.stream?.getAudioTracks().forEach(track => { track.enabled = !muted }) }
  close() {
    this.generation++
    this.cancelMicrophone?.(); this.cancelMicrophone = null
    const socket = this.socket; this.socket = null; socket?.close()
    if (this.processor) this.processor.onaudioprocess = null
    this.processor?.disconnect(); this.source?.disconnect(); this.silent?.disconnect(); this.local?.disconnect(); this.remote?.disconnect()
    this.processor = null; this.source = null; this.silent = null; this.local = null; this.remote = null
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null
    if (this.context && this.context.state !== "closed") void this.context.close().catch(() => {})
    this.context = null; this.playbackAt = 0; this.captureRate = 16000; this.previousSample = 0; this.nextPosition = 0
  }
}
