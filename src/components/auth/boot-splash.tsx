"use client"

import { useEffect, useState } from "react"
import { EnteringSplash } from "@/components/auth/entering-splash"
import { clearEntering, ENTERING_DONE_HOLD_MS, ENTERING_MAX_MS, ENTERING_MIN_MS } from "@/lib/auth/entering"

// Camada da tela de entrada POR CIMA do sistema nascendo (logo após o login). O layout (servidor)
// só a monta quando o cookie de entrada é válido — então ela já vem no HTML da primeira pintura,
// sem o sistema aparecer e depois ser coberto.
//
// Sai em 3 tempos: ESPERA (frases, barra até 90%) → PRONTO (barra 100% + "Tudo pronto") → FADE.
// "Pronto" = fontes carregadas + 2 quadros pintados + tempo mínimo desde o acesso confirmado +
// CONTEÚDO carregado: nenhum esqueleto de carregamento (`[data-skeleton]`, a peça `Pulse` dos
// loading.tsx) na página por 2 leituras seguidas. Antes (v2) ela saía com o menu e o topo
// prontos, mas o Inbox ainda carregava as conversas — a tela sumia no meio e a barra nem
// completava (relato do dono, 29/09/2026).
// Nunca prende: teto de 8s depois de montar e, sem JavaScript, some sozinha por CSS
// (.kora-boot-failsafe, 12s).
const POLL_MS = 120

function contentLoaded(): boolean {
  for (const el of document.querySelectorAll("[data-skeleton]")) if (!el.closest("[data-boot-splash]")) return false
  return true
}

export function BootSplash({ startedAt, initialIndex, name }: { startedAt: number; initialIndex: number; name: string | null }) {
  const [phase, setPhase] = useState<"waiting" | "done" | "leaving" | "off">("waiting")

  useEffect(() => {
    clearEntering()   // uma entrada = uma tela; recarregar a página não repete
    let cancelled = false
    let poll: ReturnType<typeof setInterval> | undefined
    const finish = () => { if (!cancelled) setPhase((p) => (p === "waiting" ? "done" : p)) }

    const fonts = document.fonts?.ready ?? Promise.resolve()
    const painted = fonts.then(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
    const minimum = new Promise<void>((r) => setTimeout(r, Math.max(0, startedAt + ENTERING_MIN_MS - Date.now())))
    const loaded = new Promise<void>((resolve) => {
      let streak = 0
      poll = setInterval(() => {
        streak = contentLoaded() ? streak + 1 : 0
        if (streak >= 2) { clearInterval(poll); resolve() }
      }, POLL_MS)
    })
    Promise.all([painted, minimum, loaded]).then(finish, finish)
    const cap = setTimeout(finish, ENTERING_MAX_MS)
    return () => { cancelled = true; clearTimeout(cap); if (poll) clearInterval(poll) }
  }, [startedAt])

  useEffect(() => {
    if (phase === "done") { const t = setTimeout(() => setPhase("leaving"), ENTERING_DONE_HOLD_MS); return () => clearTimeout(t) }
    if (phase === "leaving") { const t = setTimeout(() => setPhase("off"), 450); return () => clearTimeout(t) }
  }, [phase])

  if (phase === "off") return null
  return <EnteringSplash startedAt={startedAt} initialIndex={initialIndex} name={name} done={phase !== "waiting"} leaving={phase === "leaving"} failsafe />
}
