"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { getUnreadTotal } from "@/lib/actions/chat"

interface AppShell {
  /** Drawer de navegação mobile (md:hidden) aberto. */
  navOpen: boolean
  setNavOpen: (v: boolean) => void
  /** Total de não-lidas — fonte única pro badge (desktop sidebar + drawer). */
  unread: number
}

const Ctx = createContext<AppShell | null>(null)

/**
 * Estado compartilhado do shell do app: abre/fecha o drawer mobile e mantém
 * UM polling de não-lidas (antes a sidebar fazia o seu; agora desktop e drawer
 * consomem o mesmo número, sem duplicar requests).
 */
export function AppShellProvider({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false)
  const [unread, setUnread]   = useState(0)

  useEffect(() => {
    let cancelled = false
    async function tick() {
      try {
        const n = await getUnreadTotal()
        if (!cancelled) setUnread(n)
      } catch {
        /* silencioso — polling não bloqueia UI */
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

  return <Ctx.Provider value={{ navOpen, setNavOpen, unread }}>{children}</Ctx.Provider>
}

export function useAppShell() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useAppShell deve ser usado dentro de AppShellProvider")
  return ctx
}
