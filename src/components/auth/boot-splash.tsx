"use client"

import { useEffect, useState } from "react"
import { EnteringSplash } from "@/components/auth/entering-splash"
import { clearEntering, ENTERING_MAX_MS, ENTERING_MIN_MS } from "@/lib/auth/entering"

// Camada da tela de entrada POR CIMA do sistema nascendo (logo após o login). O layout (servidor)
// só a monta quando o cookie de entrada é válido — então ela já vem no HTML da primeira pintura,
// sem o sistema aparecer e depois ser coberto. Sai quando: fontes carregadas + 2 quadros
// pintados + tempo mínimo desde o acesso confirmado. Nunca prende: teto de 8s depois de montar
// e, sem JavaScript, some sozinha por CSS (.kora-boot-failsafe, 12s).
export function BootSplash({ startedAt, initialIndex, name }: { startedAt: number; initialIndex: number; name: string | null }) {
  const [phase, setPhase] = useState<"on" | "leaving" | "off">("on")

  useEffect(() => {
    clearEntering()   // uma entrada = uma tela; recarregar a página não repete
    let cancelled = false
    const leave = () => { if (!cancelled) setPhase((p) => (p === "on" ? "leaving" : p)) }
    const fonts = document.fonts?.ready ?? Promise.resolve()
    const painted = fonts.then(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
    const minimum = new Promise<void>((r) => setTimeout(r, Math.max(0, startedAt + ENTERING_MIN_MS - Date.now())))
    Promise.all([painted, minimum]).then(leave, leave)
    const cap = setTimeout(leave, ENTERING_MAX_MS)
    return () => { cancelled = true; clearTimeout(cap) }
  }, [startedAt])

  useEffect(() => {
    if (phase !== "leaving") return
    const t = setTimeout(() => setPhase("off"), 450)
    return () => clearTimeout(t)
  }, [phase])

  if (phase === "off") return null
  return <EnteringSplash startedAt={startedAt} initialIndex={initialIndex} name={name} leaving={phase === "leaving"} failsafe />
}
