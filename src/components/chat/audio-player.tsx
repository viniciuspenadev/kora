"use client"

import { useState, useRef, useEffect } from "react"
import { Play, Pause, Loader2, AlertCircle, Download } from "lucide-react"

interface Props {
  src:      string
  incoming: boolean
  mimeType?: string | null
}

const SPEEDS = [1, 1.5, 2]

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00"
  const min = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${min}:${sec.toString().padStart(2, "0")}`
}

export function AudioPlayer({ src, incoming, mimeType }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying]   = useState(false)
  const [loading, setLoading]   = useState(false)
  const [duration, setDuration] = useState(0)
  const [current, setCurrent]   = useState(0)
  const [speedIdx, setSpeedIdx] = useState(0)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onLoaded   = () => { setDuration(audio.duration); setError(null) }
    const onTime     = () => setCurrent(audio.currentTime)
    const onEnded    = () => { setPlaying(false); setCurrent(0); audio.currentTime = 0 }
    const onWaiting  = () => setLoading(true)
    const onPlaying  = () => { setLoading(false); setError(null) }
    const onError    = () => {
      const code = audio.error?.code
      const map: Record<number, string> = {
        1: "Download cancelado",
        2: "Falha de rede",
        3: "Erro ao decodificar áudio",
        4: "Formato não suportado neste navegador",
      }
      setError(map[code ?? 4] ?? "Erro desconhecido")
      setLoading(false)
      setPlaying(false)
    }
    const onStalled  = () => setLoading(true)

    audio.addEventListener("loadedmetadata", onLoaded)
    audio.addEventListener("timeupdate",    onTime)
    audio.addEventListener("ended",         onEnded)
    audio.addEventListener("waiting",       onWaiting)
    audio.addEventListener("playing",       onPlaying)
    audio.addEventListener("canplay",       onPlaying)
    audio.addEventListener("error",         onError)
    audio.addEventListener("stalled",       onStalled)

    return () => {
      audio.removeEventListener("loadedmetadata", onLoaded)
      audio.removeEventListener("timeupdate",    onTime)
      audio.removeEventListener("ended",         onEnded)
      audio.removeEventListener("waiting",       onWaiting)
      audio.removeEventListener("playing",       onPlaying)
      audio.removeEventListener("canplay",       onPlaying)
      audio.removeEventListener("error",         onError)
      audio.removeEventListener("stalled",       onStalled)
    }
  }, [])

  // Se a src mudar (refresh de signed URL), limpa erro e força reload
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    setError(null)
    audio.load()
  }, [src])

  function toggle() {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      setLoading(true)
      audio.play()
        .then(() => { setPlaying(true); setLoading(false) })
        .catch((err: DOMException) => {
          setPlaying(false)
          setLoading(false)
          setError(err.name === "NotAllowedError" ? "Clique novamente pra tocar" : `Falha ao tocar: ${err.message}`)
        })
    }
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current
    const track = trackRef.current
    if (!audio || !track || !duration) return
    const rect = track.getBoundingClientRect()
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    audio.currentTime = duration * pct
    setCurrent(audio.currentTime)
  }

  function cycleSpeed() {
    const audio = audioRef.current
    if (!audio) return
    const next = (speedIdx + 1) % SPEEDS.length
    audio.playbackRate = SPEEDS[next]
    setSpeedIdx(next)
  }

  const pct = duration > 0 ? (current / duration) * 100 : 0

  // Bubbles agora são bg-primary-100 nos dois lados; player usa fundo neutro
  const colors = incoming
    ? {
        bg:       "bg-slate-50",
        track:    "bg-slate-200",
        progress: "bg-primary",
        thumb:    "bg-primary",
        playBg:   "bg-primary hover:bg-primary-700 text-white",
        text:     "text-slate-500",
        speedBg:  "bg-white text-slate-600 hover:bg-slate-100 border-slate-200",
      }
    : {
        bg:       "bg-white/70",
        track:    "bg-primary-200",
        progress: "bg-primary",
        thumb:    "bg-primary",
        playBg:   "bg-primary hover:bg-primary-700 text-white",
        text:     "text-slate-500",
        speedBg:  "bg-white text-slate-600 hover:bg-slate-50 border-slate-200",
      }

  if (error) {
    return (
      <div className={`flex items-center gap-2 ${colors.bg} rounded-xl px-3 py-2 min-w-[240px] -mx-1 mb-1`}>
        <AlertCircle className="size-4 text-red-500 shrink-0" />
        <span className="text-xs text-slate-600 flex-1 min-w-0 truncate">{error}</span>
        <a
          href={src}
          download
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-primary-700 hover:underline shrink-0 inline-flex items-center gap-1"
        >
          <Download className="size-3" />
          Baixar
        </a>
      </div>
    )
  }

  return (
    <div className={`flex items-center gap-3 ${colors.bg} rounded-xl px-3 py-2 min-w-[240px] -mx-1 mb-1`}>
      <audio ref={audioRef} preload="metadata">
        <source src={src} type={mimeType ?? "audio/ogg; codecs=opus"} />
        <source src={src} />
      </audio>

      <button
        type="button"
        onClick={toggle}
        className={`size-9 rounded-full shrink-0 flex items-center justify-center transition-colors ${colors.playBg}`}
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : playing ? (
          <Pause className="size-4 fill-current" strokeWidth={0} />
        ) : (
          <Play className="size-4 fill-current ml-0.5" strokeWidth={0} />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div
          ref={trackRef}
          onClick={seek}
          className={`relative h-1 rounded-full cursor-pointer ${colors.track}`}
        >
          <div
            className={`absolute left-0 top-0 h-full rounded-full ${colors.progress}`}
            style={{ width: `${pct}%` }}
          />
          <div
            className={`absolute top-1/2 -translate-y-1/2 size-3 rounded-full shadow-sm ${colors.thumb}`}
            style={{ left: `calc(${pct}% - 6px)` }}
          />
        </div>
        <div className={`flex items-center justify-between mt-1 text-[10px] tabular-nums ${colors.text}`}>
          <span>{formatTime(current)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={cycleSpeed}
        className={`text-[10px] font-bold border rounded-full px-1.5 py-0.5 shrink-0 transition-colors ${colors.speedBg}`}
      >
        {SPEEDS[speedIdx]}x
      </button>
    </div>
  )
}
