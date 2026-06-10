"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { useState, useEffect, useMemo } from "react"
import {
  LogOut, Inbox, Workflow, Contact, Settings, ChevronDown,
  Bot, Bell, MessageSquare, Layers,
  Tag as TagIcon, Users, CreditCard, Wand2, Gauge, BarChart3, Mail, Sparkles, Blocks, FileText, Headset,
} from "lucide-react"
import { SidebarSelfPause } from "@/components/app/sidebar-self-pause"
import { useAppShell } from "@/components/app/app-shell-context"

interface NavLeaf {
  href:      string
  label:     string
  icon:      React.ReactNode
  soon?:     boolean
  adminOnly?: boolean
  /** Slug do módulo. Se setado e tenant não tem habilitado, item é escondido. Omitir = sempre visível (core). */
  module?:   string
  /** Só aparece se o tenant tem instância WhatsApp API Oficial (meta_cloud). */
  officialOnly?: boolean
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
  { href: "/automacao/ia", label: "Kora IA", icon: <Sparkles className="w-5 h-5 shrink-0" strokeWidth={1.75} />, module: "ai_atendente" },
  { href: "/studio",       label: "Kora Studio", icon: <Blocks className="w-5 h-5 shrink-0" strokeWidth={1.75} />, module: "ai_studio" },
  {
    key:   "automacao",
    label: "Automação",
    icon:  <Bot className="w-5 h-5 shrink-0" strokeWidth={1.75} />,
    children: [
      { href: "/automacao/mensagens",      label: "Mensagens automáticas", icon: <Bell      className={subIcon} strokeWidth={1.75} />, module: "welcome_message"  },
      { href: "/automacao/palavras-chave", label: "Palavras-chave",        icon: <Wand2     className={subIcon} strokeWidth={1.75} />, module: "keyword_triggers" },
      { href: "/automacao/funil",          label: "Fluxos de funil",       icon: <Layers    className={subIcon} strokeWidth={1.75} />, soon: true, module: "sequences" },
    ],
  },
  { href: "/integracoes", label: "Integrações", icon: <Blocks className="w-5 h-5 shrink-0" strokeWidth={1.75} />, adminOnly: true },
  { href: "/templates", label: "Templates", icon: <FileText className="w-5 h-5 shrink-0" strokeWidth={1.75} />, adminOnly: true, officialOnly: true },
  {
    key:       "config",
    label:     "Configurações",
    icon:      <Settings className="w-5 h-5 shrink-0" strokeWidth={1.75} />,
    adminOnly: true,
    children: [
      { href: "/configuracoes/atendimento",    label: "Atendimento",       icon: <Headset      className={subIcon} strokeWidth={1.75} /> },
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
  enabledModules:  string[]
  selfPause:      { paused: boolean; paused_until: string | null }
  hasOfficial?:   boolean
  /** Drawer mobile: labels sempre visíveis. Desktop: revela no hover do `group/sb`. */
  expanded?:       boolean
  /** Chamado ao navegar (fecha o drawer mobile). */
  onNavigate?:    () => void
}

/**
 * Corpo da navegação — compartilhado entre a Sidebar desktop (hover-expand) e o
 * drawer mobile. Único lugar com a árvore de NAV, filtros de módulo/role,
 * active-state e badge de não-lidas.
 */
export function SidebarBody({
  userName, userEmail, tenantName, userRole, enabledModules, selfPause, hasOfficial,
  expanded = false, onNavigate,
}: Props) {
  const pathname              = usePathname()
  const [signing, setSigning] = useState(false)
  const { unread }            = useAppShell()
  const isAdminOrOwner        = ["owner", "admin"].includes(userRole)
  const modulesSet            = useMemo(() => new Set(enabledModules), [enabledModules])

  // Em drawer (expanded) os labels aparecem sempre; no desktop revelam no hover.
  const reveal = expanded
    ? "opacity-100"
    : "opacity-0 group-hover/sb:opacity-100 transition-opacity duration-150 delay-75"

  const filteredNav = useMemo(() => {
    return NAV.flatMap<NavItem>((item) => {
      if (isGroup(item)) {
        const visibleChildren = item.children.filter((c) => !c.module || modulesSet.has(c.module))
        if (visibleChildren.length === 0) return []
        return [{ ...item, children: visibleChildren }]
      }
      if (item.module && !modulesSet.has(item.module)) return []
      if (item.officialOnly && !hasOfficial) return []
      return [item]
    })
  }, [modulesSet, hasOfficial])

  const visibleNav = useMemo(
    () => filteredNav.filter((n) => !n.adminOnly || isAdminOrOwner),
    [filteredNav, isAdminOrOwner],
  )

  const allHrefs = useMemo(() => {
    const out: string[] = []
    for (const item of NAV) {
      if (isGroup(item)) for (const c of item.children) out.push(c.href)
      else out.push(item.href)
    }
    return out
  }, [])

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
    <>
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
        <div className={`ml-3 flex flex-col min-w-0 overflow-hidden ${reveal}`}>
          <span className="text-sm font-bold text-slate-900 whitespace-nowrap leading-tight">Kora</span>
          <span className="text-[11px] text-slate-400 whitespace-nowrap truncate leading-tight mt-0.5">{tenantName}</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-3 space-y-1">
        {visibleNav.map((item) => {
          if (!isGroup(item)) {
            const active   = isLeafActive(item.href)
            const showBadge = item.href === "/inbox" && unread > 0
            const badgeText = unread > 99 ? "99+" : String(unread)

            return (
              <Link
                key={item.href}
                href={item.soon ? "#" : item.href}
                onClick={() => { if (!item.soon) onNavigate?.() }}
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
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-white tabular-nums">
                      {badgeText}
                    </span>
                  )}
                </span>
                <span className={`
                  whitespace-nowrap text-sm font-medium flex-1 ${reveal}
                  ${active ? "text-primary-700" : item.soon ? "text-slate-300" : "text-slate-700"}
                `}>
                  {item.label}
                </span>
                {showBadge && (
                  <span className={`whitespace-nowrap rounded-full bg-red-500 text-white px-2 py-0.5 text-[10px] font-bold tabular-nums ${reveal}`}>
                    {badgeText}
                  </span>
                )}
                {item.soon && (
                  <span className={`whitespace-nowrap rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400 uppercase tracking-wider ${reveal}`}>
                    breve
                  </span>
                )}
              </Link>
            )
          }

          const groupActive = isGroupActive(item)
          const isOpen      = open.has(item.key)
          const submenu = expanded
            ? (isOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0")
            : (isOpen ? "group-hover/sb:max-h-96 group-hover/sb:opacity-100" : "")

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
                  whitespace-nowrap text-sm font-medium flex-1 text-left ${reveal}
                  ${groupActive ? "text-primary-700" : "text-slate-700"}
                `}>
                  {item.label}
                </span>
                <ChevronDown
                  className={`size-3.5 text-slate-400 shrink-0 transition-transform duration-200 ${reveal} ${isOpen ? "rotate-180" : ""}`}
                  strokeWidth={2.5}
                />
              </button>

              <div className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-in-out max-h-0 opacity-0 ${submenu}`}>
                <div className="mt-1 mb-1 ml-5 pl-3 border-l border-slate-200 space-y-0.5">
                  {item.children.map((sub) => {
                    const active = isLeafActive(sub.href)
                    return (
                      <Link
                        key={sub.href}
                        href={sub.soon ? "#" : sub.href}
                        onClick={() => { if (!sub.soon) onNavigate?.() }}
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
                        <span className={`whitespace-nowrap flex-1 ${reveal}`}>
                          {sub.label}
                        </span>
                        {sub.soon && (
                          <span className={`whitespace-nowrap rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400 uppercase tracking-wider ${reveal}`}>
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

      <SidebarSelfPause
        initialPaused={selfPause.paused}
        initialPausedUntil={selfPause.paused_until}
      />

      <div className="px-2.5 pb-3 pt-2 border-t border-slate-200 shrink-0 overflow-hidden">
        <div className="flex items-center gap-1 py-1 overflow-hidden">
          <Link
            href="/configuracoes/perfil"
            onClick={() => onNavigate?.()}
            title="Meu perfil"
            className="group/profile flex items-center gap-2 min-w-0 flex-1 overflow-hidden rounded-lg hover:bg-slate-50 transition-colors"
          >
            <div className="flex size-11 items-center justify-center shrink-0">
              <ProfileAvatar name={userName} />
            </div>
            <div className={`min-w-0 flex-1 overflow-hidden ${reveal}`}>
              <p className="text-xs font-semibold text-slate-700 truncate whitespace-nowrap group-hover/profile:text-primary-700">{userName}</p>
              <p className="text-[11px] text-slate-400 truncate whitespace-nowrap leading-none mt-0.5">{userEmail}</p>
            </div>
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signing}
            title="Sair"
            className={`shrink-0 size-7 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-30 ${expanded ? "flex" : "hidden group-hover/sb:flex"}`}
          >
            <LogOut className="size-3.5" />
          </button>
        </div>
      </div>
    </>
  )
}

/** Avatar do usuário na sidebar: tenta a foto (/api/me/avatar), cai pra inicial. */
function ProfileAvatar({ name }: { name: string }) {
  const [err, setErr] = useState(false)
  if (err) {
    return (
      <div className="size-8 rounded-full bg-primary flex items-center justify-center ring-2 ring-white shadow-sm shadow-primary/20">
        <span className="text-xs font-bold text-white">{name?.[0]?.toUpperCase() ?? "U"}</span>
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/api/me/avatar"
      alt=""
      onError={() => setErr(true)}
      className="size-8 rounded-full object-cover ring-2 ring-white shadow-sm"
    />
  )
}
