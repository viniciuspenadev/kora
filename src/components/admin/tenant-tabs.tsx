"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, Users, Smartphone, Boxes, Gauge, FileText, CreditCard, Building } from "lucide-react"

const TABS = [
  { seg: "",          label: "Visão geral",      icon: LayoutDashboard },
  { seg: "cobranca",  label: "Plano & cobrança", icon: CreditCard },
  { seg: "empresa",   label: "Dados da empresa", icon: Building },
  { seg: "usuarios",  label: "Usuários",         icon: Users },
  { seg: "canais",    label: "Canais",           icon: Smartphone },
  { seg: "modulos",   label: "Módulos",          icon: Boxes },
  { seg: "limites",   label: "Limites",          icon: Gauge },
  { seg: "atividade", label: "Atividade",        icon: FileText },
] as const

export function TenantTabs({ tenantId }: { tenantId: string }) {
  const pathname = usePathname()
  const base = `/admin/tenants/${tenantId}`

  return (
    <nav className="flex items-center gap-1 -mb-px overflow-x-auto">
      {TABS.map((t) => {
        const href   = t.seg ? `${base}/${t.seg}` : base
        const active = t.seg ? pathname.startsWith(`${base}/${t.seg}`) : pathname === base
        return (
          <Link
            key={t.seg || "overview"}
            href={href}
            className={`inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
              active
                ? "border-primary text-primary-700"
                : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-200"
            }`}
          >
            <t.icon className="size-3.5" />
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
