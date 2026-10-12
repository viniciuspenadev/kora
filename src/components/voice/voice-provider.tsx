"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import Link from "next/link"
import { ArrowUpRight, GripHorizontal, Maximize2, Mic, MicOff, Minus, Phone, PhoneOff, X } from "lucide-react"
import { toast } from "sonner"
import { BrowserVoiceMedia, voiceRequest } from "@/lib/voice/browser-media"
import { VoiceSession, voiceIsActive, voicePhaseLabel, type VoiceTarget, type VoiceMedia } from "@/lib/voice/session"

const VoiceContext = createContext<{ openVoice: (target: VoiceTarget) => void } | null>(null)
export function useVoice() {
  const value = useContext(VoiceContext)
  if (!value) throw new Error("VoiceProvider ausente")
  return value
}
const timeLabel = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`

function Waveform({ media, side, muted }: { media: VoiceMedia; side: "local" | "remote"; muted: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current, context = element?.getContext("2d")
    if (!element || !context) return
    const values = new Uint8Array(256)
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    let frame = 0, last = 0
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      if (now - last < 50) return
      last = now
      media.samples(side, values)
      context.clearRect(0, 0, 240, 40)
      context.fillStyle = muted ? "#64748b" : side === "local" ? "#a5b4fc" : "#5eead4"
      for (let bar = 0; bar < 24; bar++) {
        let peak = 0
        for (let i = bar * 10; i < bar * 10 + 10; i++) peak = Math.max(peak, Math.abs(values[i] - 128) / 128)
        const height = muted || reducedMotion.matches ? 2 : Math.max(2, Math.min(36, peak * 100))
        context.beginPath(); context.roundRect(bar * 10 + 2, (40 - height) / 2, 5, height, 2.5); context.fill()
      }
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [media, side, muted])
  return <canvas ref={canvas} width={240} height={40} className="h-10 w-full" aria-hidden="true" />
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => new VoiceSession(voiceRequest, new BrowserVoiceMedia()))
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  const [minimized, setMinimized] = useState(false)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const [now, setNow] = useState(0)
  const panel = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null)
  const active = voiceIsActive(state.phase)
  const duration = state.connectedAt ? Math.max(0, Math.floor(((state.endedAt ?? now) - state.connectedAt) / 1000)) : 0
  const clamp = (x: number, y: number) => ({
    x: Math.max(12, Math.min(x, window.innerWidth - (panel.current?.offsetWidth ?? 360) - 12)),
    y: Math.max(12, Math.min(y, window.innerHeight - (panel.current?.offsetHeight ?? 320) - 12)),
  })
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    const warn = (event: BeforeUnloadEvent) => { if (voiceIsActive(session.getSnapshot().phase)) { event.preventDefault(); event.returnValue = "" } }
    const leave = () => session.dispose()
    window.addEventListener("beforeunload", warn); window.addEventListener("pagehide", leave)
    return () => { clearInterval(timer); window.removeEventListener("beforeunload", warn); window.removeEventListener("pagehide", leave); session.dispose() }
  }, [session])
  useEffect(() => {
    if (!state.target || !panel.current) return
    const reposition = () => setPosition(previous => previous ? clamp(previous.x, previous.y) : null)
    const observer = new ResizeObserver(reposition); observer.observe(panel.current)
    window.addEventListener("resize", reposition)
    return () => { observer.disconnect(); window.removeEventListener("resize", reposition) }
  }, [state.target])
  const openVoice = useCallback((target: VoiceTarget) => {
    if (!session.open(target)) toast.info("Encerre a chamada atual antes de ligar para outro contato.")
    setMinimized(false)
  }, [session])
  const contextValue = useMemo(() => ({ openVoice }), [openVoice])
  const close = () => { if (active) setMinimized(true); else session.dismiss() }
  const button = "grid size-9 shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
  return <VoiceContext.Provider value={contextValue}>
    {children}
    {state.target && <div ref={panel} role="dialog" aria-label={`Ligação com ${state.target.name}`} aria-modal="false"
      className={`fixed z-[80] max-h-[calc(100dvh-24px)] max-w-[calc(100vw-24px)] overflow-auto rounded-2xl border border-slate-700 bg-slate-950 text-white shadow-2xl ${minimized ? "w-[320px]" : "w-[360px]"}`}
      style={position ? { left: position.x, top: position.y } : { right: 16, bottom: 16 }}
      onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close() } }}>
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <button type="button" aria-label="Mover painel de ligação" title="Arraste para mover. Use as setas do teclado para ajustar."
          className="touch-none cursor-grab rounded p-1.5 text-slate-400 hover:text-white focus-visible:ring-2 focus-visible:ring-indigo-300 active:cursor-grabbing"
          onPointerDown={event => {
            if (event.button !== 0 || !panel.current) return
            const rect = panel.current.getBoundingClientRect()
            drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={event => {
            const origin = drag.current
            if (!origin || origin.pointerId !== event.pointerId) return
            setPosition(clamp(origin.left + event.clientX - origin.x, origin.top + event.clientY - origin.y))
          }}
          onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
          onPointerCancel={() => { drag.current = null }}
          onKeyDown={event => {
            const steps: Record<string, [number, number]> = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }
            const step = steps[event.key], rect = panel.current?.getBoundingClientRect()
            if (!step || !rect) return
            event.preventDefault(); setPosition(clamp(rect.left + step[0], rect.top + step[1]))
          }}><GripHorizontal className="size-4" /></button>
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">WhatsApp · ligação de saída</span>
        <button type="button" className="rounded p-1.5 text-slate-400 hover:text-white" aria-label={minimized ? "Expandir ligação" : "Minimizar ligação"} onClick={() => setMinimized(!minimized)}>
          {minimized ? <Maximize2 className="size-4" /> : <Minus className="size-4" />}
        </button>
        {!minimized && <button type="button" className="rounded p-1.5 text-slate-400 hover:text-white" aria-label={active ? "Minimizar ligação ativa" : "Fechar painel de ligação"} onClick={close}><X className="size-4" /></button>}
      </div>
      <div className={minimized ? "p-3" : "p-5"}>
        <div className="flex items-center gap-3">
          {!minimized && <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-indigo-500/20 text-xl font-bold text-indigo-200">{state.target.name.slice(0, 1).toUpperCase()}</div>}
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{state.target.name}</p>
            {!minimized && state.target.phone && <p className="mt-0.5 text-xs text-slate-400">{state.target.phone}</p>}
            <p role="status" className="mt-1 flex items-center gap-1.5 text-xs text-slate-300">
              <span className={`size-1.5 shrink-0 rounded-full ${state.phase === "connected" ? "bg-emerald-400" : active ? "bg-amber-400" : "bg-slate-500"}`} />
              {state.phase === "idle" ? state.busy ? "Linha ocupada" : state.ready ? "Pronto para ligar" : state.checked ? "Linha indisponível" : "Verificando a linha…" : voicePhaseLabel[state.phase]}
            </p>
          </div>
          <span className="font-mono text-sm tabular-nums text-slate-300" aria-label="Duração da conversa">{timeLabel(duration)}</span>
        </div>
        {!minimized && <>
          <div className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-white/5 px-3 py-2">
            <div><p className="text-[10px] font-medium text-indigo-200">{state.muted ? "Seu microfone · mudo" : "Seu microfone"}</p><Waveform media={session.media} side="local" muted={state.muted} /></div>
            <div><p className="text-[10px] font-medium text-teal-200">Áudio do cliente</p><Waveform media={session.media} side="remote" muted={false} /></div>
          </div>
          {state.phase === "idle" && <p className="mt-3 text-xs leading-relaxed text-slate-400">Clique em Ligar e permita o microfone. Você pode minimizar este painel e continuar navegando.</p>}
        </>}
        {state.error && <p role="alert" className="mt-3 rounded-lg bg-rose-400/10 p-2 text-xs leading-relaxed text-rose-200">{state.error}</p>}
        <div className={`flex items-center gap-2 ${minimized ? "mt-3" : "mt-5"}`}>
          <Link href={`/inbox?conversation=${encodeURIComponent(state.target.conversationId)}`} onClick={() => setMinimized(true)}
            className="mr-auto inline-flex items-center gap-1 text-xs text-slate-300 hover:text-white">Conversa <ArrowUpRight className="size-3.5" /></Link>
          {active ? <>
            <button type="button" aria-label={state.muted ? "Ativar microfone" : "Silenciar microfone"} aria-pressed={state.muted}
              disabled={state.phase === "preparing" || state.phase === "ending"} onClick={() => session.mute()}
              className={`${button} ${state.muted ? "bg-amber-400/20 text-amber-200" : "bg-white/10 text-white"} disabled:opacity-40`}>
              {state.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
            </button>
            <button type="button" aria-label="Desligar ligação" onClick={() => void session.hangup()} disabled={state.phase === "ending"}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-red-600 px-4 text-xs font-bold hover:bg-red-500 disabled:opacity-50"><PhoneOff className="size-4" /> Desligar</button>
          </> : <button type="button" onClick={() => void session.start()} disabled={!state.ready || state.busy}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-indigo-500 px-5 text-xs font-bold hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"><Phone className="size-4" /> Ligar</button>}
        </div>
      </div>
    </div>}
  </VoiceContext.Provider>
}
