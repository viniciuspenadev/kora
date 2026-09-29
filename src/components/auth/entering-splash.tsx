"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { Check } from "lucide-react"
import { AnimatedLogoKoraVetor } from "@/components/app/logo-kora-vetor"
import { ENTERING_DONE, ENTERING_PHRASES, enteringPhraseIndex } from "@/lib/auth/entering"

// "Reduzir movimento" do aparelho — assinatura (sem estado duplicado); no servidor, false.
const REDUCED = "(prefers-reduced-motion: reduce)"
function subscribeReduced(onChange: () => void) {
  const media = window.matchMedia(REDUCED)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}
const usePrefersReducedMotion = () =>
  useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED).matches, () => false)

// Tela de entrada (dono, 29/09/2026): logo animado + frases enquanto o ambiente abre.
// A MESMA tela aparece no login (depois de o acesso ser confirmado) e por cima do sistema
// nascendo (boot-splash.tsx) — mesmo `startedAt`, então a frase continua de onde parou.
// `initialIndex` vem de quem renderiza primeiro (servidor ou login) para não divergir na hidratação.
const STUCK_MS = 20_000

export function EnteringSplash({ startedAt, initialIndex = 0, name = null, done = false, leaving = false, failsafe = false, stuckHelp = false }: {
  startedAt: number
  initialIndex?: number
  /** Primeiro nome — só dentro do sistema (sessão já validada no servidor). */
  name?: string | null
  /** Conteúdo carregado: a barra completa e aparece "Tudo pronto" (antes do fade). */
  done?: boolean
  /** Saindo (o sistema está pronto): some em fade. */
  leaving?: boolean
  /** Camada sobre o sistema: some sozinha por CSS mesmo sem JavaScript. */
  failsafe?: boolean
  /** No login: se a abertura travar, oferece tentar de novo. */
  stuckHelp?: boolean
}) {
  const [index, setIndex] = useState(initialIndex)
  const [stuck, setStuck] = useState(false)
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    const step = setInterval(() => setIndex(enteringPhraseIndex(startedAt, Date.now())), 250)
    const guard = stuckHelp ? setTimeout(() => setStuck(true), STUCK_MS) : undefined
    return () => { clearInterval(step); if (guard) clearTimeout(guard) }
  }, [startedAt, stuckHelp])

  // Enquanto espera, a barra avança até 90% e para; só completa quando o conteúdo carregou.
  const progress = done ? 100 : Math.round(((index + 1) / ENTERING_PHRASES.length) * 90)
  return (
    <div role="status" aria-live="polite" aria-busy={!done && !leaving} data-boot-splash=""
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-canvas px-6 transition-opacity duration-400 ${leaving ? "pointer-events-none opacity-0" : "opacity-100"} ${failsafe ? "kora-boot-failsafe" : ""}`}>
      <AnimatedLogoKoraVetor className="h-12 w-auto sm:h-14" animated={!reduced} gradientId="koraEnteringShimmer" />
      {/* Altura reservada: a saudação entra sem empurrar o resto (login → sistema sem salto). */}
      <p className="mt-6 h-5 text-sm font-semibold text-slate-700">{name ? `Olá, ${name}` : ""}</p>
      <div className="mt-1 h-6 overflow-hidden text-center">
        {done
          ? <p key="done" className={`inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 ${reduced ? "" : "animate-in fade-in slide-in-from-bottom-2 duration-300"}`}><Check className="size-4" />{ENTERING_DONE}</p>
          : stuck
            ? <p className="text-sm text-slate-600">Está demorando mais que o normal. <button type="button" onClick={() => window.location.assign("/")} className="font-semibold text-primary hover:underline">Tentar de novo</button></p>
            : <p key={index} className={`text-sm text-slate-500 ${reduced ? "" : "animate-in fade-in slide-in-from-bottom-2 duration-500"}`}>{ENTERING_PHRASES[index]}</p>}
      </div>
      <div className="mt-5 h-1 w-40 overflow-hidden rounded-full bg-slate-200" aria-hidden>
        <div className={`h-full rounded-full bg-primary ${reduced ? "" : done ? "transition-[width] duration-500 ease-out" : "transition-[width] duration-[1400ms] ease-out"}`} style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}
