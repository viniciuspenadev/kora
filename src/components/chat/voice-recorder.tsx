"use client"

import { useEffect, useRef, useState } from "react"
import { Mic, Trash2, Send, Play, Pause, Loader2 } from "lucide-react"

/**
 * VoiceRecorder — gravação de voice note via MediaRecorder API.
 *
 * Estados:
 *   - "asking":     pedindo permissão de mic
 *   - "denied":     permissão negada (ou indisponível)
 *   - "recording":  capturando áudio, mostra timer + waveform
 *   - "preview":    parou, pode ouvir antes de mandar
 *   - "sending":    enviando, UI bloqueada
 *
 * Saída: `onSend(blob, mime)` quando aceita; `onCancel()` quando descarta.
 *
 * Formato: tenta `audio/ogg;codecs=opus` (Firefox), fallback `audio/webm;codecs=opus`
 * (Chrome/Edge), por último o default do MediaRecorder (Safari = mp4).
 */

interface Props {
  /** Chamado quando o usuário aperta enviar. Recebe o blob gravado. */
  onSend: (blob: Blob, mimeType: string) => Promise<void> | void
  /** Chamado quando o usuário descarta a gravação. */
  onCancel: () => void
}

const PREFERRED_MIMES = [
  "audio/ogg;codecs=opus",
  "audio/webm;codecs=opus",
  "audio/mp4",
] as const

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined
  for (const m of PREFERRED_MIMES) {
    if (MediaRecorder.isTypeSupported(m)) return m
  }
  return undefined
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function VoiceRecorder({ onSend, onCancel }: Props) {
  const [phase, setPhase]   = useState<"asking" | "denied" | "recording" | "preview" | "sending">("asking")
  const [elapsed, setElapsed] = useState(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isPlaying, setIsPlaying]   = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef        = useRef<MediaStream | null>(null)
  const audioCtxRef      = useRef<AudioContext | null>(null)
  const analyserRef      = useRef<AnalyserNode | null>(null)
  const canvasRef        = useRef<HTMLCanvasElement | null>(null)
  const audioRef         = useRef<HTMLAudioElement | null>(null)
  const chunksRef        = useRef<Blob[]>([])
  const blobRef          = useRef<Blob | null>(null)
  const mimeRef          = useRef<string>("")
  const startedAtRef     = useRef<number>(0)
  const rafRef           = useRef<number>(0)
  const tickerRef        = useRef<NodeJS.Timeout | null>(null)

  // ── Inicializa: pede mic + começa a gravar imediatamente ────
  useEffect(() => {
    let cancelled = false

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl:  true,
          },
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream

        const mime = pickMime()
        const rec  = mime
          ? new MediaRecorder(stream, { mimeType: mime })
          : new MediaRecorder(stream)
        mediaRecorderRef.current = rec
        mimeRef.current = rec.mimeType || mime || "audio/webm"

        rec.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
        }
        rec.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: mimeRef.current })
          blobRef.current = blob
          chunksRef.current = []
          const url = URL.createObjectURL(blob)
          setPreviewUrl(url)
          setPhase("preview")
        }

        chunksRef.current = []
        rec.start()
        startedAtRef.current = Date.now()
        setPhase("recording")

        // Timer
        tickerRef.current = setInterval(() => {
          setElapsed((Date.now() - startedAtRef.current) / 1000)
        }, 100)

        // Waveform (FFT do mic em tempo real). Apenas prepara o analyser —
        // o draw começa via useEffect quando o canvas é montado (phase=recording).
        const ctx = new AudioContext()
        const src = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        src.connect(analyser)
        audioCtxRef.current = ctx
        analyserRef.current = analyser
      } catch (e) {
        const err = e as Error
        if (err.name === "NotAllowedError") {
          setError("Permissão de microfone negada. Habilite nas configurações do navegador.")
        } else if (err.name === "NotFoundError") {
          setError("Nenhum microfone detectado.")
        } else {
          setError(err.message || "Erro ao acessar microfone.")
        }
        setPhase("denied")
      }
    }

    start()

    return () => {
      cancelled = true
      cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Dispara o desenho do waveform somente depois que phase=recording for
  // renderizado (canvas existe no DOM) E o analyser tá pronto.
  useEffect(() => {
    if (phase !== "recording") return
    if (!canvasRef.current || !analyserRef.current) return
    drawWaveform()
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  function cleanup() {
    if (tickerRef.current) clearInterval(tickerRef.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    audioCtxRef.current?.close().catch(() => {})
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop() } catch {}
    }
    streamRef.current = null
    audioCtxRef.current = null
    analyserRef.current = null
    mediaRecorderRef.current = null
  }

  function drawWaveform() {
    const canvas   = canvasRef.current
    const analyser = analyserRef.current
    if (!canvas || !analyser) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const data = new Uint8Array(analyser.frequencyBinCount)
    const W = canvas.width  = canvas.clientWidth  * window.devicePixelRatio
    const H = canvas.height = canvas.clientHeight * window.devicePixelRatio
    ctx.scale(1, 1)

    function loop() {
      if (!analyserRef.current) return
      analyserRef.current.getByteFrequencyData(data)

      ctx?.clearRect(0, 0, W, H)
      const bars = 32
      const step = Math.floor(data.length / bars)
      const barW = W / bars * 0.5
      const gap  = W / bars * 0.5

      for (let i = 0; i < bars; i++) {
        let sum = 0
        for (let j = 0; j < step; j++) sum += data[i * step + j]
        const avg = sum / step
        const h = Math.max(2 * window.devicePixelRatio, (avg / 255) * H * 0.9)
        const y = (H - h) / 2

        ctx!.fillStyle = "#004add"
        ctx!.fillRect(i * (barW + gap), y, barW, h)
      }

      rafRef.current = requestAnimationFrame(loop)
    }
    loop()
  }

  function handleStop() {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop()
    }
    // Para o stream pra liberar mic icon do browser
    streamRef.current?.getTracks().forEach((t) => t.stop())
    if (tickerRef.current) clearInterval(tickerRef.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    audioCtxRef.current?.close().catch(() => {})
  }

  function handleDiscard() {
    cleanup()
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    onCancel()
  }

  async function handleSend() {
    const blob = blobRef.current
    if (!blob) return
    if (blob.size < 1000) {
      setError("Gravação muito curta.")
      return
    }
    setPhase("sending")
    try {
      await onSend(blob, mimeRef.current)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    } catch {
      setPhase("preview")
    }
  }

  function togglePlay() {
    const a = audioRef.current
    if (!a) return
    if (a.paused) {
      a.play().catch(() => {})
    } else {
      a.pause()
    }
  }

  // ── Render ─────────────────────────────────────────────────

  if (phase === "asking") {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-t border-slate-200">
        <Loader2 className="size-4 text-slate-400 animate-spin" />
        <span className="text-sm text-slate-500">Aguardando permissão de microfone…</span>
      </div>
    )
  }

  if (phase === "denied") {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-red-50 border-t border-red-100">
        <span className="text-sm text-red-700">{error}</span>
        <button
          type="button"
          onClick={handleDiscard}
          className="text-xs font-semibold text-red-700 hover:text-red-900 underline"
        >
          Fechar
        </button>
      </div>
    )
  }

  if (phase === "preview") {
    return (
      <div className="flex items-center gap-2 px-3 py-3 bg-slate-50 border-t border-slate-200">
        <button
          type="button"
          onClick={handleDiscard}
          title="Descartar"
          className="size-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
        >
          <Trash2 className="size-5" />
        </button>

        <div className="flex-1 flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white border border-slate-200">
          <button
            type="button"
            onClick={togglePlay}
            className="size-8 flex items-center justify-center rounded-full bg-primary text-white hover:bg-primary-700 transition-colors"
          >
            {isPlaying ? <Pause className="size-4" /> : <Play className="size-4 ml-0.5" />}
          </button>
          <span className="text-xs font-mono text-slate-600 tabular-nums">
            {formatTime(elapsed)}
          </span>
          <audio
            ref={audioRef}
            src={previewUrl ?? undefined}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            preload="metadata"
            className="hidden"
          />
          <div className="flex-1 h-6 flex items-center gap-0.5">
            {Array.from({ length: 24 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 rounded-full bg-primary/60"
                style={{ height: `${30 + Math.sin(i * 0.7) * 30 + Math.cos(i * 0.3) * 20}%` }}
              />
            ))}
          </div>
        </div>

        {error && (
          <span className="text-xs text-red-600 px-2">{error}</span>
        )}

        <button
          type="button"
          onClick={handleSend}
          title="Enviar"
          className="size-10 flex items-center justify-center rounded-xl bg-primary hover:bg-primary-700 text-white shadow-sm shadow-primary/30 transition-colors"
        >
          <Send className="size-4" />
        </button>
      </div>
    )
  }

  if (phase === "sending") {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-t border-slate-200">
        <Loader2 className="size-4 text-primary animate-spin" />
        <span className="text-sm text-slate-500">Enviando áudio…</span>
      </div>
    )
  }

  // recording
  return (
    <div className="flex items-center gap-2 px-3 py-3 bg-slate-50 border-t border-slate-200">
      <button
        type="button"
        onClick={handleDiscard}
        title="Descartar"
        className="size-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
      >
        <Trash2 className="size-5" />
      </button>

      <div className="flex-1 flex items-center gap-3 px-3 py-2 rounded-xl bg-white border border-red-200">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping" />
          <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
        </span>
        <span className="text-xs font-mono text-slate-700 tabular-nums shrink-0">
          {formatTime(elapsed)}
        </span>
        <canvas
          ref={canvasRef}
          className="flex-1 h-6"
        />
      </div>

      <button
        type="button"
        onClick={handleStop}
        title="Parar e revisar"
        className="size-10 flex items-center justify-center rounded-xl bg-primary hover:bg-primary-700 text-white shadow-sm shadow-primary/30 transition-colors"
      >
        <Mic className="size-4" />
      </button>
    </div>
  )
}
