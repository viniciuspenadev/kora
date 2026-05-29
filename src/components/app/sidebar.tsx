"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { useState, useEffect, useMemo } from "react"
import {
  LogOut, Inbox, Workflow, Contact, Settings, ChevronDown,
  Bot, Bell, Filter, MessageSquare, Layers, Server,
  Tag as TagIcon, Users, CreditCard, Wand2, Globe, Gauge, BarChart3, Mail, Sparkles,
} from "lucide-react"
import { getUnreadTotal } from "@/lib/actions/chat"
import { SidebarSelfPause } from "@/components/app/sidebar-self-pause"

interface NavLeaf {
  href:      string
  label:     string
  icon:      React.ReactNode
  soon?:     boolean
  adminOnly?: boolean
  /** Slug do módulo. Se setado e tenant não tem habilitado, item é escondido. Omitir = sempre visível (core). */
  module?:   string
}

interface NavGroup {
  key:        string
  label:      string
  icon:       React.ReactNode
  adminOnly?: boolean
  children:   NavLeaf[]
}

type NavItem = NavLeaf | NavGroup

function isGroup(item: NavItem): item is NavGroup {
  return "children" in item
}

const subIcon = "w-4 h-4 shrink-0"

const NAV: NavItem[] = [
  { href: "/inbox",      label: "Inbox",      icon: <Inbox     className="w-5 h-5 shrink-0" strokeWidth={1.75} />, module: "inbox"    },
  { href: "/kanban",     label: "Kanban",     icon: <Workflow  className="w-5 h-5 shrink-0" strokeWidth={1.75} />, module: "kanban"   },
  { href: "/contatos",   label: "Contatos",   icon: <Contact   className="w-5 h-5 shrink-0" strokeWidth={1.75} />, module: "contacts" },
  { href: "/relatorios", label: "Relatórios", icon: <BarChart3 className="w-5 h-5 shrink-0" strokeWidth={1.75} /> },
  {
    key:   "automacao",
    label: "Automação",
    icon:  <Bot className="w-5 h-5 shrink-0" strokeWidth={1.75} />,
    children: [
      { href: "/automacao/ia",             label: "Atendente IA",          icon: <Sparkles  className={subIcon} strokeWidth={1.75} />, module: "ai_atendente"     },
      { href: "/automacao/mensagens",      label: "Mensagens automáticas", icon: <Bell      className={subIcon} strokeWidth={1.75} />, module: "welcome_message"  },
      { href: "/automacao/palavras-chave", label: "Palavras-chave",        icon: <Wand2     className={subIcon} strokeWidth={1.75} />, module: "keyword_triggers" },
      { href: "/automacao/distribuicao",   label: "Distribuição",          icon: <Filter    className={subIcon} strokeWidth={1.75} />, module: "auto_assign" },
      { href: "/automacao/funil",          label: "Fluxos de funil",       icon: <Layers    className={subIcon} strokeWidth={1.75} />, soon: true, module: "sequences" },
    ],
  },
  {
    key:       "config",
    label:     "Configurações",
    icon:      <Settings className="w-5 h-5 shrink-0" strokeWidth={1.75} />,
    adminOnly: true,
    children: [
      { href: "/configuracoes/whatsapp",       label: "WhatsApp",          icon: <Server       className={subIcon} strokeWidth={1.75} /> },
      { href: "/configuracoes/site",           label: "Widget do site",    icon: <Globe        className={subIcon} strokeWidth={1.75} />, module: "widget_site" },
      { href: "/configuracoes/tags",           label: "Tags",              icon: <TagIcon      className={subIcon} strokeWidth={1.75} /> },
      { href: "/configuracoes/respostas",      label: "Respostas rápidas", icon: <MessageSquare className={subIcon} strokeWidth={1.75} />, module: "quick_replies" },
      { href: "/configuracoes/equipe",         label: "Equipe",            icon: <Users        className={subIcon} strokeWidth={1.75} /> },
      { href: "/configuracoes/relatorios",     label: "Relatórios automáticos", icon: <Mail        className={subIcon} strokeWidth={1.75} /> },
      { href: "/configuracoes/uso",            label: "Uso e limites",     icon: <Gauge        className={subIcon} strokeWidth={1.75} /> },
      { href: "/configuracoes/cobranca",       label: "Cobrança",          icon: <CreditCard   className={subIcon} strokeWidth={1.75} />, soon: true, module: "billing_panel" },
    ],
  },
]

interface Props {
  userName:        string
  userEmail:       string
  tenantName:      string
  userRole:        string
  enabledModules:  string[]   // slugs habilitados (vem do server layout)
  selfPause:      { paused: boolean; paused_until: string | null }
}

export function Sidebar({ userName, userEmail, tenantName, userRole, enabledModules, selfPause }: Props) {
  const pathname              = usePathname()
  const [signing, setSigning] = useState(false)
  const [unread, setUnread]   = useState(0)
  const isAdminOrOwner        = ["owner", "admin"].includes(userRole)
  const modulesSet            = useMemo(() => new Set(enabledModules), [enabledModules])

  // Filtra NAV por módulos habilitados.
  // Item sem `module` = sempre visível. Item com `module` = só se tenant tem.
  // Group sem nenhum child visível = group inteiro escondido.
  const filteredNav = useMemo(() => {
    return NAV.flatMap<NavItem>((item) => {
      if (isGroup(item)) {
        const visibleChildren = item.children.filter((c) => !c.module || modulesSet.has(c.module))
        if (visibleChildren.length === 0) return []
        return [{ ...item, children: visibleChildren }]
      }
      if (item.module && !modulesSet.has(item.module)) return []
      return [item]
    })
  }, [modulesSet])

  // Polling global de mensagens não-lidas. Atualiza o badge do Inbox a cada 10s
  // em qualquer página do app, não só /inbox. Reduz pra 5s quando a aba volta a ficar visível.
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

  const visibleNav = useMemo(
    () => filteredNav.filter((n) => !n.adminOnly || isAdminOrOwner),
    [filteredNav, isAdminOrOwner],
  )

  // Coleta todos os hrefs visíveis pra longest-prefix match
  const allHrefs = useMemo(() => {
    const out: string[] = []
    for (const item of NAV) {
      if (isGroup(item)) for (const c of item.children) out.push(c.href)
      else out.push(item.href)
    }
    return out
  }, [])

  /**
   * Longest-prefix match: um item só fica ativo se nenhum href mais específico
   * também casa com pathname atual.
   */
  function isLeafActive(href: string): boolean {
    if (!href) return false
    if (href === "/") return pathname === "/"
    if (pathname === href) return true
    if (!pathname.startsWith(href + "/")) return false
    const moreSpecific = allHrefs.find((h) =>
      h !== href && h.startsWith(href + "/") &&
      (pathname === h || pathname.startsWith(h + "/"))
    )
    return !moreSpecific
  }

  function isGroupActive(group: NavGroup): boolean {
    return group.children.some((c) => isLeafActive(c.href))
  }

  // Expand state com auto-open do grupo ativo
  const [open, setOpen] = useState<Set<string>>(() => {
    const found = visibleNav.find((n) => isGroup(n) && isGroupActive(n)) as NavGroup | undefined
    return found ? new Set([found.key]) : new Set()
  })

  useEffect(() => {
    const active = visibleNav.find((n) => isGroup(n) && isGroupActive(n)) as NavGroup | undefined
    if (active) {
      setOpen((prev) => (prev.has(active.key) ? prev : new Set([...prev, active.key])))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  function toggleGroup(key: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function handleSignOut() {
    setSigning(true)
    await signOut({ redirectTo: "/auth/signin" })
  }

  return (
    <aside className="group/sb flex flex-col bg-white border-r border-slate-200 shrink-0 h-screen overflow-hidden z-20
      w-16 hover:w-64 transition-[width] duration-200 ease-in-out">

      <div className="flex items-center h-14 border-b border-slate-200 px-2.5 shrink-0 overflow-hidden">
        <div className="flex size-11 items-center justify-center shrink-0">
          <Image
            src="/logo_kora_curto.png"
            alt="Kora"
            width={32}
            height={32}
            priority
            className="size-8 rounded-lg shadow-sm shadow-primary/20"
          />
        </div>
        <div className="ml-3 flex flex-col min-w-0 overflow-hidden opacity-0 group-hover/sb:opacity-100 transition-opacity duration-150 delay-75">
          <span className="text-sm font-bold text-slate-900 whitespace-nowrap leading-tight">Kora</span>
          <span className="text-[11px] text-slate-400 whitespace-nowrap truncate leading-tight mt-0.5">{tenantName}</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-3 space-y-1">
        {visibleNav.map((item) => {
          // ── Leaf (item simples) ────────────────────────────────
          if (!isGroup(item)) {
            const active   = isLeafActive(item.href)
            const showBadge = item.href === "/inbox" && unread > 0
            const badgeText = unread > 99 ? "99+" : String(unread)

            return (
              <Link
                key={item.href}
                href={item.soon ? "#" : item.href}
                title={showBadge ? `${item.label} · ${unread} não lidas` : item.label}
                className={`group/item relative flex items-center gap-3 rounded-xl py-1.5 pr-3 ${item.soon ? "cursor-default" : ""}`}
              >
                <span className={`
                  relative flex size-11 items-center justify-center rounded-xl shrink-0 transition-all duration-150
                  ${active
                    ? "bg-primary-50 text-primary-700"
                    : item.soon
                    ? "text-slate-300"
                    : "text-slate-500 group-hover/item:bg-slate-100 group-hover/item:text-slate-900"
                  }
                `}>
                  {item.icon}
                  {showBadge && (
                    /* Badge no estado colapsado (16px) — dot compacto com contador */
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-white tabular-nums">
                      {badgeText}
                    </span>
                  )}
                </span>
                <span className={`
                  whitespace-nowrap text-sm font-medium flex-1 opacity-0 group-hover/sb:opacity-100 transition-opacity duration-150 delay-75
                  ${active ? "text-primary-700" : item.soon ? "text-slate-300" : "text-slate-700"}
                `}>
                  {item.label}
                </span>
                {showBadge && (
                  /* Badge no estado expandido — pill com contador maior */
                  <span className="whitespace-nowrap rounded-full bg-red-500 text-white px-2 py-0.5 text-[10px] font-bold tabular-nums opacity-0 group-hover/sb:opacity-100 transition-opacity duration-150 delay-75">
                    {badgeText}
                  </span>
                )}
                {item.soon && (
                  <span className="whitespace-nowrap rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400 uppercase tracking-wider opacity-0 group-hover/sb:opacity-100 transition-opacity duration-150 delay-75">
                    breve
                  </span>
                )}
              </Link>
            )
          }

          // ── Group (parent com filhos) ──────────────────────────
          const groupActive = isGroupActive(item)
          const isOpen      = open.has(item.key)

          return (
            <div key={item.key}>
              <button
                type="button"
                onClick={() => toggleGroup(item.key)}
                aria-expanded={isOpen}
                title={item.label}
                className="group/item relative w-full flex items-center gap-3 rounded-xl py-1.5 pr-3"
              >
                <span className={`
                  flex size-11 items-center justify-center rounded-xl shrink-0 transition-all duration-150
                  ${groupActive
                    ? "bg-primary-50 text-primary-600 ring-1 ring-primary-100"
                    : "text-slate-500 group-hover/item:bg-slate-100 group-hover/item:text-slate-900"
                  }
                `}>
                  {item.icon}
                </span>
                <span className={`
                  whitespace-nowrap text-sm font-medium flex-1 text-left opacity-0 group-hover/sb:opacity-100 transition-opacity duration-150 delay-75
                  ${groupActive ? "text-primary-700" : "text-slate-700"}
                `}>
                  {item.label}
                </span>
                <ChevronDown
                  className={`size-3.5 text-slate-400 shrink-0 transition-transform duration-200 opacity-0 group-hover/sb:opacity-100 delay-75 ${isOpen ? "rotate-180" : ""}`}
                  strokeWidth={2.5}
                />
              </button>

              {/* Subitens — só visíveis quando sidebar expandida E grupo aberto */}
              <div
                className={`
                  overflow-hidden transition-[max-height,opacity] duration-200 ease-in-out max-h-0 opacity-0
                  ${isOpen ? "group-hover/sb:max-h-96 group-hover/sb:opacity-100" : ""}
                `}
              >
                <div className="mt-1 mb-1 ml-5 pl-3 border-l border-slate-200 space-y-0.5">
                  {item.children.map((sub) => {
                    const active = isLeafActive(sub.href)
                    return (
                      <Link
                        key={sub.href}
                        href={sub.soon ? "#" : sub.href}
                        title={sub.label}
                        className={`
                          group/sub flex items-center gap-2.5 rounded-lg pl-2 pr-3 py-1.5 text-[13px] transition-colors overflow-hidden
                          ${active
                            ? "bg-primary-50 text-primary-700 font-semibold"
                            : sub.soon
                            ? "text-slate-300 cursor-default"
                            : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                          }
                        `}
                      >
                        <span className={`shrink-0 ${active ? "text-primary-600" : sub.soon ? "text-slate-300" : "text-slate-400 group-hover/sub:text-slate-600"}`}>
                          {sub.icon}
                        </span>
                        <span className="whitespace-nowrap flex-1 opacity-0 group-hover/sb:opacity-100 transition-opacity duration-150 delay-75">
                          {sub.label}
                        </span>
                        {sub.soon && (
                          <span className="whitespace-nowrap rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400 uppercase tracking-wider opacity-0 group-hover/sb:opacity-100 transition-opacity duration-150 delay-75">
                            breve
                          </span>
                        )}
                      </Link>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </nav>

      {/* Self-pause toggle (entre nav e profile) */}
      <SidebarSelfPause
        initialPaused={selfPause.paused}
        initialPausedUntil={selfPause.paused_until}
      />

      <div className="px-2.5 pb-3 pt-2 border-t border-slate-200 shrink-0 overflow-hidden">
        <div className="flex items-center gap-3 py-1 overflow-hidden">
          <div className="flex size-11 items-center justify-center shrink-0">
            <div className="size-8 rounded-full bg-primary flex items-center justify-center ring-2 ring-white shadow-sm shadow-primary/20">
              <span className="text-xs font-bold text-white">{userName?.[0]?.toUpperCase() ?? "U"}</span>
            </div>
          </div>
          <div className="min-w-0 flex-1 overflow-hidden opacity-0 group-hover/sb:opacity-100 transition-opacity duration-150 delay-75">
            <p className="text-xs font-semibold text-slate-700 truncate whitespace-nowrap">{userName}</p>
            <p className="text-[11px] text-slate-400 truncate whitespace-nowrap leading-none mt-0.5">{userEmail}</p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signing}
            title="Sair"
            className="shrink-0 size-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-30 opacity-0 group-hover/sb:opacity-100 duration-150 delay-75"
          >
            <LogOut className="size-3.5" />
          </button>
        </div>
      </div>
    </aside>
  )
}
