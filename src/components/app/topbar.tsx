"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight, Home, Menu } from "lucide-react"
import { useAppShell } from "@/components/app/app-shell-context"
import { MyAvatar } from "@/components/app/my-avatar"
import { NotificationBell } from "@/components/app/notification-bell"

const ROUTE_LABELS: Record<string, string> = {
  "/inbox":         "Inbox",
  "/atendimentos":  "Departamentos",
  "/kanban":        "Pipelines",
  "/contatos":      "Contatos",
  "/configuracoes": "Configurações",
}

function getLabel(pathname: string): string {
  if (ROUTE_LABELS[pathname]) return ROUTE_LABELS[pathname]
  const parent = "/" + pathname.split("/")[1]
  return ROUTE_LABELS[parent] ?? ""
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  agent: "Atendente",
}

export function Topbar({
  userName, userRole, userId, supabaseToken,
}: {
  userName: string; userRole: string
  userId: string; supabaseToken: string
}) {
  const pathname = usePathname()
  const label    = getLabel(pathname)
  const { setNavOpen } = useAppShell()

  return (
    <header className="h-14 bg-nav border-b border-nav-line flex items-center justify-between px-4 sm:px-6 shrink-0">
      <div className="flex items-center gap-1.5 text-sm">
        {/* Hambúrguer — só no mobile, abre o drawer de navegação */}
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          aria-label="Abrir menu"
          className="md:hidden -ml-1 mr-1 size-9 flex items-center justify-center rounded-lg text-nav-dim hover:bg-nav-hover hover:text-nav-strong transition-colors"
        >
          <Menu className="size-5" />
        </button>
        <Link href="/inbox" className="hidden md:inline-flex text-nav-dim hover:text-nav-text transition-colors">
          <Home className="size-4" />
        </Link>
        {label && (
          <>
            <ChevronRight className="hidden md:inline size-3.5 text-nav-dim" />
            <span className="font-medium text-nav-text">{label}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        <NotificationBell userId={userId} supabaseToken={supabaseToken} />
        <Link
          href="/configuracoes/perfil"
          title="Meu perfil"
          className="group/me flex items-center gap-2.5 rounded-lg px-1.5 py-1 -mr-1 hover:bg-nav-hover transition-colors"
        >
          <div className="text-right hidden sm:block">
            <p className="text-xs font-semibold text-nav-text leading-none group-hover/me:text-nav-strong">{userName}</p>
            <p className="text-[11px] text-nav-dim leading-none mt-0.5">{ROLE_LABELS[userRole] ?? userRole}</p>
          </div>
          <MyAvatar name={userName} className="size-8" />
        </Link>
      </div>
    </header>
  )
}
