"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight, Home, Menu } from "lucide-react"
import { useAppShell } from "@/components/app/app-shell-context"

const ROUTE_LABELS: Record<string, string> = {
  "/inbox":         "Inbox",
  "/kanban":        "Kanban",
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

export function Topbar({ userName, userRole }: { userName: string; userRole: string }) {
  const pathname = usePathname()
  const label    = getLabel(pathname)
  const initial  = userName?.[0]?.toUpperCase() ?? "U"
  const { setNavOpen } = useAppShell()

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-6 shrink-0">
      <div className="flex items-center gap-1.5 text-sm">
        {/* Hambúrguer — só no mobile, abre o drawer de navegação */}
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          aria-label="Abrir menu"
          className="md:hidden -ml-1 mr-1 size-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
        >
          <Menu className="size-5" />
        </button>
        <Link href="/inbox" className="hidden md:inline-flex text-slate-400 hover:text-slate-600 transition-colors">
          <Home className="size-4" />
        </Link>
        {label && (
          <>
            <ChevronRight className="hidden md:inline size-3.5 text-slate-300" />
            <span className="font-medium text-slate-700">{label}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        <div className="text-right hidden sm:block">
          <p className="text-xs font-semibold text-slate-700 leading-none">{userName}</p>
          <p className="text-[11px] text-slate-400 leading-none mt-0.5">{ROLE_LABELS[userRole] ?? userRole}</p>
        </div>
        <div className="size-8 rounded-full bg-primary flex items-center justify-center shrink-0">
          <span className="text-xs font-bold text-white">{initial}</span>
        </div>
      </div>
    </header>
  )
}
