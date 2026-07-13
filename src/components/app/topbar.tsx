"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight, Home, Menu } from "lucide-react"
import { useAppShell } from "@/components/app/app-shell-context"
import { NotificationBell } from "@/components/app/notification-bell"
import { AccountMenu } from "@/components/app/account-menu"

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
        <AccountMenu userName={userName} userRole={userRole} userId={userId} />
      </div>
    </header>
  )
}
