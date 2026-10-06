"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { getNavigationUnread } from "@/lib/actions/navigation-unread"
import { touchPresence } from "@/lib/actions/presence"

interface AppShell {
  /** Drawer de navegação mobile (md:hidden) aberto. */
  navOpen: boolean
  setNavOpen: (v: boolean) => void
  /** Total de não-lidas — fonte única pro badge (desktop sidebar + drawer). */
  unread: number
  unreadByPipeline: Record<string, number>
  unreadWithoutPipeline: number
}

const Ctx = createContext<AppShell | null>(null)

/**
 * Estado compartilhado do shell do app: abre/fecha o drawer mobile e mantém
 * UM polling de não-lidas (antes a sidebar fazia o seu; agora desktop e drawer
 * consomem o mesmo número, sem duplicar requests).
 */
export function AppShellProvider({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false)
  const [messages, setMessages] = useState({ unread: 0, unreadByPipeline: {} as Record<string, number>, unreadWithoutPipeline: 0 })

  useEffect(() => {
    let cancelled = false
    async function tick() {
      try {
        const summary = await getNavigationUnread()
        if (!cancelled) setMessages(summary)
      } catch {
        if (!cancelled) setMessages({ unread: 0, unreadByPipeline: {}, unreadWithoutPipeline: 0 })
      }
    }
    tick()
    const id = setInterval(tick, 10_000)
    const onVisible = () => { if (document.visibilityState === "visible") tick() }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  // Presença (avisos: com o Kora em uso, toca o sininho e o celular fica quieto). Marca a cada
  // minuto só se a aba está à vista ou a pessoa mexeu nos últimos 10 min — aba esquecida
  // aberta à noite não "segura" o aviso do celular. Leitura em lib/atendimento/presence.ts.
  useEffect(() => {
    let lastActivity = Date.now()
    const mark = () => { lastActivity = Date.now() }
    const beat = () => {
      if (document.visibilityState === "visible" || Date.now() - lastActivity < 10 * 60_000) touchPresence().catch(() => {})
    }
    for (const ev of ["pointerdown", "keydown", "scroll"] as const) window.addEventListener(ev, mark, { passive: true })
    beat()
    const id = setInterval(beat, 60_000)
    const onVisible = () => { if (document.visibilityState === "visible") { mark(); beat() } }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", onVisible)
      for (const ev of ["pointerdown", "keydown", "scroll"] as const) window.removeEventListener(ev, mark)
    }
  }, [])

  return <Ctx.Provider value={{ navOpen, setNavOpen, ...messages }}>{children}</Ctx.Provider>
}

export function useAppShell() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useAppShell deve ser usado dentro de AppShellProvider")
  return ctx
}
