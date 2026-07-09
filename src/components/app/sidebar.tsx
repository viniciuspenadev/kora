"use client"

import { useState, useCallback } from "react"
import { SidebarBody, type PipelineMini } from "@/components/app/sidebar-body"

interface Props {
  userName:        string
  userEmail:       string
  tenantName:      string
  userRole:        string
  enabledModules:  string[]   // slugs habilitados (vem do server layout)
  selfPause:      { paused: boolean; paused_until: string | null }
  hasOfficial?:   boolean     // tenant tem instância WhatsApp API Oficial
  pipelines?:      PipelineMini[]   // pipelines ativos → sub-menu de Pipelines
  dealPipelines?:  PipelineMini[]   // funis de venda → switcher em Negócios
  /** Estado inicial vindo do cookie (server) — evita flash de largura no load. */
  initialCollapsed?: boolean
}

const COOKIE = "kora_sb_collapsed"

function persist(collapsed: boolean) {
  document.cookie = `${COOKIE}=${collapsed ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`
}

/**
 * Sidebar desktop — travável (não mais hover). Rail de 56px (recolhido) ou 256px
 * (expandido), controlado por botão e persistido em cookie. Escondida no mobile
 * (`hidden md:flex`); abaixo de md a navegação vem do <MobileSidebar/>.
 */
export function Sidebar({ initialCollapsed = false, ...props }: Props) {
  const [collapsed, setCollapsed] = useState(initialCollapsed)

  const toggle = useCallback(() => {
    setCollapsed((c) => { const n = !c; persist(n); return n })
  }, [])

  const expand = useCallback(() => {
    setCollapsed(false); persist(false)
  }, [])

  return (
    <aside className={`hidden md:flex flex-col bg-nav shrink-0 h-dvh overflow-hidden z-20
      transition-[width] duration-200 ease-in-out ${collapsed ? "w-14" : "w-64"}`}>
      <SidebarBody
        {...props}
        expanded={!collapsed}
        collapsed={collapsed}
        onToggleCollapse={toggle}
        onExpand={expand}
      />
    </aside>
  )
}
