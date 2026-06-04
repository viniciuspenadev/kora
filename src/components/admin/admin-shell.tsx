"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Building2, Mail, LogOut, Smartphone, MailOpen, Package, Wallet, MonitorSmartphone } from "lucide-react"
import { signOut } from "next-auth/react"

const nav = [
  { href: "/admin",          label: "Visão geral", icon: LayoutDashboard },
  { href: "/admin/tenants",    label: "Tenants",     icon: Building2 },
  { href: "/admin/planos",     label: "Planos",      icon: Package },
  { href: "/admin/financeiro", label: "Financeiro",  icon: Wallet },
  { href: "/admin/whatsapp",   label: "WhatsApp",    icon: Smartphone },
  { href: "/admin/sessoes",    label: "Sessões",     icon: MonitorSmartphone },
  { href: "/admin/invites",  label: "Convites",    icon: Mail },
  { href: "/admin/emails",   label: "Emails",      icon: MailOpen },
]

export function AdminShell({
  children,
  userName,
  userEmail,
}: {
  children: React.ReactNode
  userName: string
  userEmail: string
}) {
  const pathname = usePathname()

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <aside className="w-60 bg-slate-950 text-slate-100 flex flex-col shrink-0">
        <div className="h-16 flex items-center px-5 border-b border-slate-800">
          <Image
            src="/logo_kora.png"
            alt="Kora"
            width={1238}
            height={620}
            priority
            className="h-8 w-auto brightness-0 invert"
          />
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map((n) => {
            const active = n.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(n.href)
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-2.5 h-9 px-3 rounded-lg text-sm transition-colors ${
                  active
                    ? "bg-primary/15 text-white ring-1 ring-primary/30"
                    : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
                }`}
              >
                <n.icon className="size-4" strokeWidth={1.75} />
                {n.label}
              </Link>
            )
          })}
        </nav>
        <div className="p-3 border-t border-slate-800">
          <div className="px-3 py-2 mb-1">
            <p className="text-xs font-medium text-slate-200 truncate">{userName}</p>
            <p className="text-[10px] text-slate-500 truncate">{userEmail}</p>
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/auth/signin" })}
            className="w-full flex items-center gap-2.5 h-9 px-3 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <LogOut className="size-4" />
            Sair
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
