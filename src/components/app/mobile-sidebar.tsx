"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { SidebarBody, type PipelineMini } from "@/components/app/sidebar-body"
import { useAppShell } from "@/components/app/app-shell-context"

interface Props {
  userName:        string
  userEmail:       string
  tenantName:      string
  userRole:        string
  enabledModules:  string[]
  selfPause:      { paused: boolean; paused_until: string | null }
  hasOfficial?:   boolean
  pipelines?:      PipelineMini[]
  dealPipelines?:  PipelineMini[]
}

/**
 * Drawer de navegação mobile (md:hidden). Abre pelo hambúrguer do topbar
 * (estado em <AppShellProvider/>), desliza da esquerda com backdrop, e fecha ao
 * clicar fora, ao navegar, ou ao trocar de rota. Reusa o <SidebarBody/> em modo
 * expandido (labels sempre visíveis).
 */
export function MobileSidebar(props: Props) {
  const { navOpen, setNavOpen } = useAppShell()
  const pathname = usePathname()

  // Fecha ao trocar de rota (cobre navegação que não passa pelo onNavigate).
  useEffect(() => { setNavOpen(false) }, [pathname, setNavOpen])

  // Trava o scroll do body enquanto o drawer está aberto.
  useEffect(() => {
    if (!navOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = prev }
  }, [navOpen])

  return (
    <div className="md:hidden" aria-hidden={!navOpen}>
      {/* Backdrop */}
      <div
        onClick={() => setNavOpen(false)}
        className={`fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-200 ${
          navOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      />
      {/* Painel */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[82%] flex-col bg-white border-r border-slate-200 shadow-2xl transition-transform duration-200 ease-out ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <SidebarBody {...props} expanded onNavigate={() => setNavOpen(false)} />
      </aside>
    </div>
  )
}
