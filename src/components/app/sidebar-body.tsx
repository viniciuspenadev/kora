"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname, useSearchParams } from "next/navigation"
import { signOut } from "next-auth/react"
import { useState, useEffect, useMemo, useRef, useLayoutEffect, useCallback } from "react"
import {
  LogOut, Inbox, Workflow, Contact, Settings, ChevronDown, ChevronRight, ChevronLeft, Briefcase,
  Bot, Bell, MessageSquare, Layers, CalendarDays, Columns3,
  Tag as TagIcon, Users, CreditCard, Wand2, Gauge, BarChart3, Mail, Sparkles, Blocks, FileText, Headset, BookMarked, IdCard,
  Plug, PanelLeftClose, PanelLeftOpen, Package, SlidersHorizontal, ClipboardList, ListChecks, Megaphone, Send, Funnel, Plus,
} from "lucide-react"
import { SidebarSelfPause } from "@/components/app/sidebar-self-pause"
import { useAppShell } from "@/components/app/app-shell-context"

export interface PipelineMini { id: string; name: string; color: string; is_default: boolean }

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
  /** Sobrescreve a detecção de ativo (ex: itens com querystring que o pathname não pega). */
  activeOverride?: boolean
  /** "Funil de Vendas": link ao board + botão dedicado que expande os funis de venda ativos. */
  dealSwitcher?: boolean
}

interface NavGroup {
  key:        string
  label:      string
  icon:       React.ReactNode
  adminOnly?: boolean
  module?:    string
  /** Só aparece se o tenant tem instância WhatsApp API Oficial (meta_cloud). */
  officialOnly?: boolean
  /** Abre painel FLYOUT ao lado do menu em vez do accordion (só no rail desktop). */
  flyout?:    boolean
  /** Filhos: leaves OU sub-grupos (accordion aninhado, ex: Templates dentro de Configurações). */
  children:   NavItem[]
}

type NavItem = NavLeaf | NavGroup

function isGroup(item: NavItem): item is NavGroup {
  return "children" in item
}

const subIcon = "w-4 h-4 shrink-0"

const NAV: NavItem[] = [
  { href: "/inbox",      label: "Inbox",      icon: <Inbox     className="w-5 h-5 shrink-0" strokeWidth={1.75} />, module: "inbox"    },
  {
    key:   "atendimento",
    label: "Atendimento",
    icon:  <Headset className="w-5 h-5 shrink-0" strokeWidth={1.75} />,
    children: [
      { href: "/kanban",       label: "Pipelines",     icon: <Workflow className={subIcon} strokeWidth={1.75} />, module: "kanban"   },
      { href: "/atendimentos", label: "Departamentos", icon: <Columns3 className={subIcon} strokeWidth={1.75} />, module: "inbox"    },
    ],
  },
  { href: "/contatos", label: "Contatos", icon: <Contact className="w-5 h-5 shrink-0" strokeWidth={1.75} />, module: "contacts" },
  {
    key:       "negocios",
    label:     "Negócios",
    icon:      <Briefcase className="w-5 h-5 shrink-0" strokeWidth={1.75} />,
    module:    "crm",
    adminOnly: true,
    children: [
      { href: "/negocios/painel", label: "Painel",          icon: <BarChart3 className={subIcon} strokeWidth={1.75} /> },
      // "Funil de Vendas" = link ao board + botão dedicado que expande os funis ativos.
      { href: "/negocios",        label: "Funil de Vendas", icon: <Funnel   className={subIcon} strokeWidth={1.75} />, dealSwitcher: true },
      { href: "/configuracoes/catalogo", label: "Catálogo", icon: <Package   className={subIcon} strokeWidth={1.75} /> },
    ],
  },
  {
    key:       "marketing",
    label:     "Marketing",
    icon:      <Megaphone className="w-5 h-5 shrink-0" strokeWidth={1.75} />,
    module:    "broadcasts",
    adminOnly: true,
    children: [
      { href: "/campanhas",            label: "Campanhas", icon: <Send       className={subIcon} strokeWidth={1.75} /> },
      { href: "/configuracoes/listas", label: "Listas",    icon: <ListChecks className={subIcon} strokeWidth={1.75} /> },
    ],
  },
  { href: "/agenda",     label: "Agenda",     icon: <CalendarDays className="w-5 h-5 shrink-0" strokeWidth={1.75} />, module: "agenda"  },
  { href: "/relatorios", label: "Relatórios", icon: <BarChart3    className="w-5 h-5 shrink-0" strokeWidth={1.75} /> },
  { href: "/automacao/ia", label: "Kora IA",  icon: <Sparkles     className="w-5 h-5 shrink-0" strokeWidth={1.75} />, module: "ai_atendente" },
  {
    key:   "automacao",
    label: "Automação",
    icon:  <Bot className="w-5 h-5 shrink-0" strokeWidth={1.75} />,
    children: [
      { href: "/studio",                   label: "Kora Studio",           icon: <Blocks       className={subIcon} strokeWidth={1.75} />, module: "ai_studio"       },
      { href: "/automacao/mensagens",      label: "Mensagens automáticas", icon: <Bell         className={subIcon} strokeWidth={1.75} />, module: "welcome_message"  },
      { href: "/automacao/palavras-chave", label: "Palavras-chave",        icon: <Wand2        className={subIcon} strokeWidth={1.75} />, module: "keyword_triggers" },
      { href: "/configuracoes/respostas",  label: "Respostas rápidas",     icon: <MessageSquare className={subIcon} strokeWidth={1.75} />, module: "quick_replies"   },
      { href: "/automacao/funil",          label: "Fluxos de funil",       icon: <Layers       className={subIcon} strokeWidth={1.75} />, soon: true, module: "sequences" },
    ],
  },
  {
    key:       "config",
    label:     "Configurações",
    icon:      <Settings className="w-5 h-5 shrink-0" strokeWidth={1.75} />,
    adminOnly: true,
    flyout:    true,
    children: [
      { href: "/configuracoes/atendimento",    label: "Atendimento",       icon: <Headset          className={subIcon} strokeWidth={1.75} /> },
      { href: "/negocios/funis",               label: "Config. Funis",     icon: <SlidersHorizontal className={subIcon} strokeWidth={1.75} />, module: "crm" },
      { href: "/configuracoes/motivos",        label: "Motivos de perda",  icon: <ClipboardList    className={subIcon} strokeWidth={1.75} />, module: "crm" },
      { href: "/configuracoes/tags",           label: "Tags",              icon: <TagIcon          className={subIcon} strokeWidth={1.75} /> },
      { href: "/configuracoes/cadastro",       label: "Campos do cadastro", icon: <IdCard       className={subIcon} strokeWidth={1.75} /> },
      { href: "/configuracoes/equipe",         label: "Equipe",            icon: <Users        className={subIcon} strokeWidth={1.75} /> },
      { href: "/configuracoes/relatorios",     label: "Relatórios automáticos", icon: <Mail    className={subIcon} strokeWidth={1.75} /> },
      { href: "/configuracoes/uso",            label: "Uso e limites",     icon: <Gauge        className={subIcon} strokeWidth={1.75} /> },
      { href: "/configuracoes/cobranca",       label: "Cobrança",          icon: <CreditCard   className={subIcon} strokeWidth={1.75} />, soon: true, module: "billing_panel" },
      { href: "/integracoes",                  label: "Integrações",       icon: <Plug         className={subIcon} strokeWidth={1.75} /> },
      {
        key:          "templates",
        label:        "Templates",
        icon:         <FileText className={subIcon} strokeWidth={1.75} />,
        officialOnly: true,
        children: [
          { href: "/templates",            label: "Meus templates", icon: <FileText   className={subIcon} strokeWidth={1.75} /> },
          { href: "/templates/biblioteca", label: "Biblioteca",     icon: <BookMarked className={subIcon} strokeWidth={1.75} /> },
        ],
      },
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
  /** Drawer mobile / sidebar destravado aberto: labels sempre visíveis. */
  expanded?:       boolean
  /** Pipelines ativos → "Pipelines" vira sub-menu (switcher) quando há 2+. */
  pipelines?:      PipelineMini[]
  /** Funis de VENDA ativos → "Funil de Vendas" (Negócios) ganha expander (1+). */
  dealPipelines?:  PipelineMini[]
  /** Sidebar desktop recolhido (só ícones). Undefined = não é o rail desktop (drawer). */
  collapsed?:      boolean
  /** Alterna recolher/expandir (só desktop). */
  onToggleCollapse?: () => void
  /** Força expandir (ex: clicar num grupo estando recolhido). */
  onExpand?:       () => void
  /** Chamado ao navegar (fecha o drawer mobile). */
  onNavigate?:    () => void
}

/**
 * Corpo da navegação — compartilhado entre a Sidebar desktop (travável) e o
 * drawer mobile. Único lugar com a árvore de NAV, filtros de módulo/role,
 * active-state e badge de não-lidas. Suporta grupos aninhados (accordion dentro
 * de accordion — ex: Templates dentro de Configurações).
 */
export function SidebarBody({
  userName, userEmail, tenantName, userRole, enabledModules, selfPause, hasOfficial,
  pipelines, dealPipelines, expanded = false, collapsed = false, onToggleCollapse, onExpand, onNavigate,
}: Props) {
  const pathname              = usePathname()
  const searchParams          = useSearchParams()
  const [signing, setSigning] = useState(false)
  const { unread }            = useAppShell()
  const isAdminOrOwner        = ["owner", "admin"].includes(userRole)
  const modulesSet            = useMemo(() => new Set(enabledModules), [enabledModules])

  // Labels: aparecem quando expandido; somem (opacity-0) quando recolhido. A
  // largura do rail (w-14, overflow-hidden) recorta o texto. Sem :hover.
  const reveal = expanded
    ? "opacity-100 transition-opacity duration-150"
    : "opacity-0"

  // Filtro recursivo: role (adminOnly) · canal oficial (officialOnly) · módulo.
  // Grupo sem filhos visíveis some junto.
  const filteredNav = useMemo(() => {
    const walk = (items: NavItem[]): NavItem[] =>
      items.flatMap<NavItem>((item) => {
        if (item.adminOnly && !isAdminOrOwner) return []
        if (item.officialOnly && !hasOfficial) return []
        if (isGroup(item)) {
          if (item.module && !modulesSet.has(item.module)) return []
          const kids = walk(item.children)
          return kids.length ? [{ ...item, children: kids }] : []
        }
        if (item.module && !modulesSet.has(item.module)) return []
        return [item]
      })
    return walk(NAV)
  }, [modulesSet, hasOfficial, isAdminOrOwner])

  // Pipeline atual (pra destacar no sub-menu): SÓ quando se está no board (/kanban).
  // Fora dele (contatos, departamentos, etc.) nenhum pipeline fica ativo.
  const currentPipelineId = useMemo(() => {
    if (pathname !== "/kanban") return null
    if (!pipelines?.length) return null
    const q = searchParams.get("pipeline")
    if (q && pipelines.some((p) => p.id === q)) return q
    return (pipelines.find((p) => p.is_default) ?? pipelines[0]).id
  }, [pathname, pipelines, searchParams])

  // Funil de VENDA atual (destaque no sub-menu de Negócios): só no board /negocios.
  const currentDealPipelineId = useMemo(() => {
    if (pathname !== "/negocios") return null
    if (!dealPipelines?.length) return null
    const q = searchParams.get("pipeline")
    if (q && dealPipelines.some((p) => p.id === q)) return q
    return (dealPipelines.find((p) => p.is_default) ?? dealPipelines[0]).id
  }, [pathname, dealPipelines, searchParams])

  // Injeta pipelines como switcher (só com 2+ → vale a pena; 1 continua link direto).
  // Vale pros dois boards: atendimento (/kanban) e vendas (/negocios).
  const nav = useMemo(() => {
    // /negocios NÃO entra aqui: "Funil de Vendas" é link + expander dedicado (dealSwitcher).
    const switchers = [
      { targetHref: "/kanban", key: "pipelines", list: pipelines, currentId: currentPipelineId, toHref: (p: PipelineMini) => `/kanban?pipeline=${p.id}` },
    ].filter((s) => (s.list?.length ?? 0) > 1)
    if (!switchers.length) return filteredNav

    const inject = (items: NavItem[]): NavItem[] =>
      items.map((it) => {
        if (isGroup(it)) return { ...it, children: inject(it.children) }
        const sw = switchers.find((s) => s.targetHref === it.href)
        if (!sw) return it
        return {
          key:   sw.key,
          label: it.label,
          icon:  it.icon,
          children: (sw.list as PipelineMini[]).map((p) => ({
            href:  sw.toHref(p),
            label: p.name,
            icon:  (
              <span className="flex size-4 items-center justify-center">
                <span className="size-2 rounded-full" style={{ backgroundColor: p.color }} />
              </span>
            ),
            activeOverride: p.id === sw.currentId,
          })),
        } as NavGroup
      })
    return inject(filteredNav)
  }, [filteredNav, pipelines, currentPipelineId])

  const allHrefs = useMemo(() => {
    const out: string[] = []
    const walk = (items: NavItem[]) =>
      items.forEach((it) => (isGroup(it) ? walk(it.children) : out.push(it.href)))
    walk(NAV)
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
    return group.children.some((c) => (isGroup(c) ? isGroupActive(c) : (c.activeOverride ?? isLeafActive(c.href))))
  }

  // Keys de todos os grupos (qualquer profundidade) que contêm o item ativo.
  function activeKeys(items: NavItem[]): string[] {
    const keys: string[] = []
    for (const it of items) {
      if (isGroup(it) && isGroupActive(it)) keys.push(it.key, ...activeKeys(it.children))
    }
    return keys
  }

  const [open, setOpen] = useState<Set<string>>(() => new Set(activeKeys(nav)))

  useEffect(() => {
    // Auto-abre o grupo do item ativo ao navegar (client nav não remonta o
    // SidebarBody, então o initializer do useState não roda de novo). Effect
    // intencional: deriva open-state do pathname mantendo o toggle manual.
    const ks = activeKeys(nav)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (ks.length) setOpen((prev) => {
      const next = new Set(prev)
      ks.forEach((k) => next.add(k))
      return next
    })
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

  // ── Flyout (grupos com `flyout`, ex: Configurações) ─────────────────────
  // Abre um MENU DO MENU: segunda coluna de altura total, colada no rail — não
  // um popover (decisão do owner 2026-07-03). Só no rail desktop; no drawer
  // mobile cai pro accordion. No rail recolhido abre direto, sem expandir.
  const isDesktopRail = onToggleCollapse !== undefined
  const [flyoutKey, setFlyoutKey] = useState<string | null>(null)
  const flyoutRef = useRef<HTMLDivElement>(null)
  const [flyoutX, setFlyoutX] = useState(0)

  function openFlyout(key: string) {
    // Colado na borda direita do rail (flush) — parece extensão do próprio menu.
    setFlyoutX(navRef.current?.getBoundingClientRect().right ?? 56)
    setFlyoutKey(key)
  }

  useEffect(() => {
    if (!flyoutKey) return
    function onDown(e: MouseEvent) {
      const t = e.target as Element
      if (flyoutRef.current?.contains(t)) return
      if (t.closest?.("[data-flyout-trigger]")) return   // o toggle do botão cuida
      setFlyoutKey(null)
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setFlyoutKey(null) }
    function onResize() { setFlyoutKey(null) }   // âncora (borda do rail) muda de lugar
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    window.addEventListener("resize", onResize)
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); window.removeEventListener("resize", onResize) }
  }, [flyoutKey])

  // Fecha ao recolher/expandir o rail (a âncora muda de lugar) e ao trocar de rota.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFlyoutKey(null)
  }, [collapsed, pathname])

  // Clique num grupo top-level: flyout → painel lateral; senão, recolhido →
  // expande e abre; expandido → toggle accordion.
  function onGroupClick(key: string, flyout?: boolean) {
    if (flyout && isDesktopRail) {
      if (flyoutKey === key) setFlyoutKey(null)
      else openFlyout(key)
      return
    }
    if (!expanded) {
      onExpand?.()
      setOpen((prev) => new Set(prev).add(key))
    } else {
      toggleGroup(key)
    }
  }

  async function handleSignOut() {
    setSigning(true)
    await signOut({ redirectTo: "/auth/signin" })
  }

  // ── Indicador ativo deslizante ──────────────────────────────────────────
  // Um único realce que ESCORREGA (transform + transition) do item antigo até o
  // novo. Rastreia só o item TOP-LEVEL ativo (grupo ou leaf); itens aninhados
  // usam realce estático (bg-primary-50).
  const navRef     = useRef<HTMLElement>(null)
  const chipRefs   = useRef<Map<string, HTMLElement>>(new Map())
  const setChipRef = useCallback((key: string, el: HTMLElement | null) => {
    if (el) chipRefs.current.set(key, el); else chipRefs.current.delete(key)
  }, [])
  const [pill, setPill] = useState<{ x: number; y: number; show: boolean }>({ x: 0, y: 0, show: false })
  // Borda direita do rail (x) — âncora da aba fixa "expandir funis" (segue collapse/expand).
  const [railRight, setRailRight] = useState(0)
  // Y do item "Funil de Vendas" — a aba fixa fica na MESMA altura dele (não no topo).
  const dealItemRef = useRef<HTMLAnchorElement | null>(null)
  const [dealItemY, setDealItemY] = useState<number | null>(null)
  const setDealItemEl = useCallback((el: HTMLAnchorElement | null) => { dealItemRef.current = el }, [])

  const activeKey = useMemo(() => {
    for (const item of nav) {
      if (isGroup(item)) { if (isGroupActive(item)) return item.key }
      else if (isLeafActive(item.href)) return item.href
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, pathname])

  const measurePill = useCallback(() => {
    const navEl = navRef.current
    if (navEl) setRailRight(navEl.getBoundingClientRect().right)
    const de = dealItemRef.current?.getBoundingClientRect()
    setDealItemY(de && de.height > 0 ? de.top + de.height / 2 : null)
    const chip  = activeKey ? chipRefs.current.get(activeKey) : null
    if (!navEl || !chip) { setPill((p) => ({ ...p, show: false })); return }
    const n = navEl.getBoundingClientRect(), c = chip.getBoundingClientRect()
    setPill({ x: c.left - n.left + navEl.scrollLeft, y: c.top - n.top + navEl.scrollTop, show: true })
  }, [activeKey])

  // rAF loop (~280ms): re-mede a cada frame durante uma transição (largura do
  // sidebar / max-height do submenu) pra a bola SEGUIR o item que desliza.
  const rafRef = useRef(0)
  const loopMeasure = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    const start = performance.now()
    const tick = () => {
      measurePill()
      if (performance.now() - start < 280) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [measurePill])

  // Medição imediata: mount · troca de página · expandir/recolher (drawer).
  useLayoutEffect(() => { measurePill() }, [measurePill, expanded])
  // Abrir/fechar grupo → segue a animação do submenu.
  useEffect(() => { loopMeasure() }, [open, loopMeasure])
  // Recolher/expandir o rail agora é ESTADO (não :hover) → segue a animação de largura.
  useEffect(() => { loopMeasure() }, [collapsed, loopMeasure])
  useEffect(() => {
    window.addEventListener("resize", measurePill)
    return () => { window.removeEventListener("resize", measurePill); cancelAnimationFrame(rafRef.current) }
  }, [measurePill])

  // ── Renderers de sub-nível (recursivos) ─────────────────────────────────
  function renderSubLeaf(sub: NavLeaf) {
    const active = sub.activeOverride ?? isLeafActive(sub.href)
    return (
      <Link
        key={sub.href}
        href={sub.soon ? "#" : sub.href}
        onClick={() => { if (!sub.soon) onNavigate?.() }}
        title={sub.label}
        className={`
          group/sub flex items-center gap-2.5 rounded-lg pl-2 pr-3 py-1.5 text-[13px] transition-colors overflow-hidden
          ${active
            ? "bg-primary-100 text-primary-700 font-semibold"
            : sub.soon
            ? "text-slate-300 cursor-default"
            : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          }
        `}
      >
        <span className={`shrink-0 ${active ? "text-primary-600" : sub.soon ? "text-slate-300" : "text-slate-400 group-hover/sub:text-slate-600"}`}>
          {sub.icon}
        </span>
        <span className={`whitespace-nowrap flex-1 ${reveal}`}>{sub.label}</span>
        {sub.soon && (
          <span className={`whitespace-nowrap rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400 uppercase tracking-wider ${reveal}`}>
            breve
          </span>
        )}
      </Link>
    )
  }

  // Link de um funil (na lista do flyout ou no accordion mobile) — ícone de funil.
  function renderPipeLink(p: PipelineMini, inFlyout: boolean) {
    const pActive = p.id === currentDealPipelineId
    return (
      <Link key={p.id} href={`/negocios?pipeline=${p.id}`}
        onClick={() => { if (inFlyout) setFlyoutKey(null); onNavigate?.() }} title={p.name}
        className={`group/sub flex items-center gap-2.5 rounded-lg ${inFlyout ? "px-2.5 py-2" : "pl-2 pr-3 py-1.5"} text-[13px] transition-colors overflow-hidden ${
          pActive ? "bg-primary-100 text-primary-700 font-semibold" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}>
        <Funnel className="size-4 shrink-0" strokeWidth={1.75} style={pActive ? undefined : { color: p.color }} />
        <span className={`whitespace-nowrap flex-1 ${inFlyout ? "" : reveal}`}>{p.name}</span>
      </Link>
    )
  }

  // "Funil de Vendas" = link pro board. No DESKTOP o menu dedicado dos funis é aberto
  // pela ABA FIXA na borda do rail (renderizada abaixo) — não por seta dentro do item.
  // No drawer MOBILE (sem flyout) fica o accordion inline com chevron. 0 funis = link.
  function renderDealSwitch(leaf: NavLeaf) {
    const list = dealPipelines ?? []
    if (list.length < 1) return renderSubLeaf(leaf)
    const active = isLeafActive(leaf.href)
    // Desktop: link simples (mesma cara dos outros), MAS com ref pra a aba fixa
    // se ancorar na altura dele. O toggle do menu dedicado é a aba na borda do rail.
    if (isDesktopRail) {
      return (
        <Link key={leaf.href} ref={setDealItemEl} href={leaf.href} onClick={() => onNavigate?.()} title={leaf.label}
          className={`group/sub flex items-center gap-2.5 rounded-lg pl-2 pr-3 py-1.5 text-[13px] transition-colors overflow-hidden ${
            active ? "bg-primary-100 text-primary-700 font-semibold" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}>
          <span className={`shrink-0 ${active ? "text-primary-600" : "text-slate-400 group-hover/sub:text-slate-600"}`}>{leaf.icon}</span>
          <span className={`whitespace-nowrap flex-1 ${reveal}`}>{leaf.label}</span>
        </Link>
      )
    }
    const isOpen = open.has("deal-pipes")
    return (
      <div key={leaf.href}>
        <div className={`group/sub flex items-center gap-1 rounded-lg pl-2 pr-1 py-0.5 transition-colors ${active ? "bg-primary-100" : "hover:bg-slate-50"}`}>
          <Link href={leaf.href} onClick={() => onNavigate?.()} title={leaf.label}
            className="flex items-center gap-2.5 flex-1 min-w-0 py-1 text-[13px] overflow-hidden">
            <span className={`shrink-0 ${active ? "text-primary-600" : "text-slate-400 group-hover/sub:text-slate-600"}`}>{leaf.icon}</span>
            <span className={`whitespace-nowrap flex-1 ${reveal} ${active ? "text-primary-700 font-semibold" : "text-slate-500"}`}>{leaf.label}</span>
          </Link>
          <button type="button" onClick={() => toggleGroup("deal-pipes")} aria-expanded={isOpen} title="Funis de venda"
            className={`shrink-0 size-6 grid place-items-center rounded-md text-slate-400 hover:bg-slate-200/60 hover:text-slate-600 transition-colors ${reveal}`}>
            <ChevronDown className={`size-3.5 transition-transform duration-200 ${isOpen ? "rotate-180 text-primary-600" : ""}`} strokeWidth={2.5} />
          </button>
        </div>
        <div className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-in-out ${isOpen && expanded ? "max-h-72 opacity-100" : "max-h-0 opacity-0"}`}>
          <div className="mt-0.5 mb-1 ml-4 pl-2.5 border-l border-slate-200 space-y-0.5">
            {list.map((p) => renderPipeLink(p, false))}
          </div>
        </div>
      </div>
    )
  }

  // Leaf dentro do painel flyout — labels sempre visíveis (independe do rail).
  function renderFlyoutLeaf(sub: NavLeaf) {
    const active = sub.activeOverride ?? isLeafActive(sub.href)
    return (
      <Link
        key={sub.href}
        href={sub.soon ? "#" : sub.href}
        onClick={() => { if (!sub.soon) { setFlyoutKey(null); onNavigate?.() } }}
        className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
          active
            ? "bg-primary-100 text-primary-700 font-semibold"
            : sub.soon
            ? "text-slate-300 cursor-default"
            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
        }`}
      >
        <span className={`shrink-0 ${active ? "text-primary-600" : sub.soon ? "text-slate-300" : "text-slate-400"}`}>{sub.icon}</span>
        <span className="flex-1 whitespace-nowrap">{sub.label}</span>
        {sub.soon && (
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400 uppercase tracking-wider">breve</span>
        )}
      </Link>
    )
  }

  function renderSubGroup(group: NavGroup) {
    const groupActive = isGroupActive(group)
    const isOpen      = open.has(group.key)
    return (
      <div key={group.key}>
        <button
          type="button"
          onClick={() => toggleGroup(group.key)}
          aria-expanded={isOpen}
          title={group.label}
          className="group/sub w-full flex items-center gap-2.5 rounded-lg pl-2 pr-3 py-1.5 text-[13px] transition-colors"
        >
          <span className={`shrink-0 ${groupActive ? "text-primary-600" : "text-slate-400 group-hover/sub:text-slate-600"}`}>
            {group.icon}
          </span>
          <span className={`whitespace-nowrap flex-1 text-left ${reveal} ${groupActive ? "text-primary-700 font-semibold" : "text-slate-500"}`}>
            {group.label}
          </span>
          <ChevronDown
            className={`size-3 text-slate-400 shrink-0 transition-transform duration-200 ${reveal} ${isOpen ? "rotate-180" : ""}`}
            strokeWidth={2.5}
          />
        </button>
        <div className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-in-out ${isOpen && expanded ? "max-h-60 opacity-100" : "max-h-0 opacity-0"}`}>
          <div className="mt-0.5 mb-1 ml-4 pl-2.5 border-l border-slate-200 space-y-0.5">
            {group.children.map((c) => (isGroup(c) ? renderSubGroup(c) : c.dealSwitcher ? renderDealSwitch(c) : renderSubLeaf(c)))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center h-14 border-b border-slate-200 px-2.5 shrink-0 overflow-hidden">
        {collapsed && onToggleCollapse ? (
          // Recolhido: o logo curto GIRA em 3D no hover, revelando o botão de
          // expandir. Clicar em qualquer parte expande (não depende de notar o flip).
          <button
            type="button"
            onClick={onToggleCollapse}
            title="Expandir menu"
            className="group/logo flex size-9 items-center justify-center shrink-0 [perspective:600px]"
          >
            <div className="relative size-8 transition-transform duration-500 ease-out [transform-style:preserve-3d] group-hover/logo:[transform:rotateY(180deg)]">
              <span className="absolute inset-0 flex items-center justify-center [backface-visibility:hidden]">
                <Image
                  src="/logo_kora_curto.png"
                  alt="Kora"
                  width={32}
                  height={32}
                  priority
                  className="size-8 rounded-lg shadow-sm shadow-primary/20"
                />
              </span>
              <span className="absolute inset-0 flex items-center justify-center [backface-visibility:hidden] [transform:rotateY(180deg)]">
                <PanelLeftOpen className="size-5 text-primary-600" strokeWidth={2} />
              </span>
            </div>
          </button>
        ) : (
          <div className="flex size-9 items-center justify-center shrink-0">
            <Image
              src="/logo_kora_curto.png"
              alt="Kora"
              width={32}
              height={32}
              priority
              className="size-8 rounded-lg shadow-sm shadow-primary/20"
            />
          </div>
        )}

        <div className={`ml-3 flex flex-col min-w-0 flex-1 overflow-hidden ${reveal}`}>
          <span className="text-sm font-bold text-slate-900 whitespace-nowrap leading-tight">Kora</span>
          <span className="text-[11px] text-slate-400 whitespace-nowrap truncate leading-tight mt-0.5">{tenantName}</span>
        </div>

        {expanded && onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            title="Recolher menu"
            className={`shrink-0 flex size-7 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors ${reveal}`}
          >
            <PanelLeftClose className="size-4" strokeWidth={2} />
          </button>
        )}
      </div>

      <nav ref={navRef} className="relative flex flex-col gap-1 flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-3">
        {/* Realce deslizante — escorrega até o item ativo. Fica atrás dos ícones. */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 size-9 rounded-xl bg-primary-100 transition-transform duration-300 ease-out"
          style={{ transform: `translate(${pill.x}px, ${pill.y}px)`, opacity: pill.show ? 1 : 0 }}
        />
        {nav.map((item) => {
          if (!isGroup(item)) {
            const active    = isLeafActive(item.href)
            // Bolinha de "tem mensagem" — só sinaliza presença, sem contador (decisão do owner).
            const showBadge = item.href === "/inbox" && unread > 0

            return (
              <Link
                key={item.href}
                href={item.soon ? "#" : item.href}
                onClick={() => { if (!item.soon) onNavigate?.() }}
                title={showBadge ? `${item.label} · mensagens não lidas` : item.label}
                className={`group/item relative flex items-center gap-3 rounded-xl py-1.5 pr-3 ${item.soon ? "cursor-default" : ""}`}
              >
                <span ref={(el) => setChipRef(item.href, el)} className={`
                  relative flex size-9 items-center justify-center rounded-xl shrink-0 transition-colors duration-150
                  ${active
                    ? "text-primary-700"
                    : item.soon
                    ? "text-slate-300"
                    : "text-slate-500 group-hover/item:bg-slate-100 group-hover/item:text-slate-900"
                  }
                `}>
                  {item.icon}
                  {showBadge && (
                    <span className="absolute top-1 right-1 size-2.5 rounded-full bg-red-500 ring-2 ring-white" aria-label="Mensagens não lidas" />
                  )}
                </span>
                <span className={`
                  whitespace-nowrap text-sm font-medium flex-1 ${reveal}
                  ${active ? "text-primary-700" : item.soon ? "text-slate-300" : "text-slate-700"}
                `}>
                  {item.label}
                </span>
                {showBadge && (
                  <span className={`size-2 rounded-full bg-red-500 shrink-0 ${reveal}`} aria-hidden />
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
          const asFlyout    = !!item.flyout && isDesktopRail
          const isOpen      = asFlyout ? flyoutKey === item.key : open.has(item.key)

          const groupButton = (
            <button
              type="button"
              onClick={() => onGroupClick(item.key, item.flyout)}
              aria-expanded={isOpen}
              title={item.label}
              data-flyout-trigger={asFlyout ? item.key : undefined}
              className={`group/item relative w-full flex items-center gap-3 rounded-xl py-1.5 pr-3 ${asFlyout && isOpen ? "bg-slate-100" : ""}`}
            >
              <span ref={(el) => setChipRef(item.key, el)} className={`
                flex size-9 items-center justify-center rounded-xl shrink-0 transition-colors duration-150
                ${groupActive
                  ? "text-primary-700"
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
              {asFlyout ? (
                <ChevronRight
                  className={`size-3.5 shrink-0 transition-transform duration-200 ${reveal} ${isOpen ? "translate-x-0.5 text-primary-600" : "text-slate-400"}`}
                  strokeWidth={2.5}
                />
              ) : (
                <ChevronDown
                  className={`size-3.5 text-slate-400 shrink-0 transition-transform duration-200 ${reveal} ${isOpen ? "rotate-180" : ""}`}
                  strokeWidth={2.5}
                />
              )}
            </button>
          )

          const groupSubmenu = asFlyout ? null : (
            <div className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-in-out ${isOpen && expanded ? "max-h-[34rem] opacity-100" : "max-h-0 opacity-0"}`}>
              <div className="my-1 ml-5 pl-3 border-l border-slate-200 space-y-0.5">
                {item.children.map((c) => (isGroup(c) ? renderSubGroup(c) : c.dealSwitcher ? renderDealSwitch(c) : renderSubLeaf(c)))}
              </div>
            </div>
          )

          return (
            <div key={item.key}>
              {groupButton}
              {groupSubmenu}
            </div>
          )
        })}
      </nav>

      {/* MENU DO MENU — segunda coluna de altura total, colada no rail. `fixed`
          escapa o overflow-hidden do <aside> (sem transform no ancestral). */}
      {flyoutKey && isDesktopRail && (() => {
        // Menu DEDICADO dos funis de venda (2ª coluna) — botão "Novo funil" + lista.
        if (flyoutKey === "deal-pipes") {
          const list = dealPipelines ?? []
          return (
            <div
              ref={flyoutRef}
              style={{ left: flyoutX }}
              className="fixed inset-y-0 z-40 w-64 flex flex-col bg-white border-r border-slate-200 shadow-[12px_0_32px_-18px_rgba(15,23,42,0.25)] animate-in slide-in-from-left-4 fade-in-0 duration-150"
            >
              {/* setinha na borda EXTERNA — recolhe o menu dedicado (mesma altura do item) */}
              <button
                type="button"
                onClick={() => setFlyoutKey(null)}
                title="Recolher"
                style={{ top: dealItemY ?? 96 }}
                className="absolute -right-3 -translate-y-1/2 z-10 size-6 grid place-items-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm hover:text-slate-700 hover:border-slate-300 transition-colors"
              >
                <ChevronLeft className="size-3.5" strokeWidth={2.5} />
              </button>
              <div className="flex items-center gap-2.5 h-14 px-4 border-b border-slate-200 shrink-0">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary-50 text-primary-600 shrink-0"><Funnel className="size-4" strokeWidth={1.75} /></span>
                <span className="text-sm font-bold text-slate-900 flex-1 truncate">Funis de Vendas</span>
              </div>
              <div className="p-2.5 border-b border-slate-100 shrink-0">
                <Link
                  href="/negocios/funis"
                  onClick={() => { setFlyoutKey(null); onNavigate?.() }}
                  className="flex items-center justify-center gap-1.5 h-9 rounded-lg bg-primary hover:bg-primary-700 text-white text-xs font-semibold transition-colors"
                >
                  <Plus className="size-3.5" strokeWidth={2.5} /> Novo funil
                </Link>
              </div>
              <div className="flex-1 overflow-y-auto px-2.5 py-2 space-y-0.5">
                {list.length === 0
                  ? <p className="px-2.5 py-6 text-xs text-slate-400 text-center">Nenhum funil ativo.</p>
                  : list.map((p) => renderPipeLink(p, true))}
              </div>
            </div>
          )
        }
        const g = nav.find((i): i is NavGroup => isGroup(i) && i.key === flyoutKey)
        if (!g) return null
        return (
          <div
            ref={flyoutRef}
            style={{ left: flyoutX }}
            className="fixed inset-y-0 z-40 w-64 flex flex-col bg-white border-r border-slate-200 shadow-[12px_0_32px_-18px_rgba(15,23,42,0.25)] animate-in slide-in-from-left-4 fade-in-0 duration-150"
          >
            {/* cabeçalho — espelha o do menu principal (h-14 + divisor) */}
            <div className="flex items-center gap-2.5 h-14 px-4 border-b border-slate-200 shrink-0">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary-50 text-primary-600 shrink-0">{g.icon}</span>
              <span className="text-sm font-bold text-slate-900 flex-1 truncate">{g.label}</span>
              <button
                type="button"
                onClick={() => setFlyoutKey(null)}
                title="Fechar"
                className="size-7 grid place-items-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
              >
                <PanelLeftClose className="size-4" strokeWidth={2} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-0.5">
              {g.children.map((c) =>
                isGroup(c) ? (
                  <div key={c.key} className="pt-2 mt-2 border-t border-slate-100">
                    <p className="px-2.5 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">{c.label}</p>
                    <div className="space-y-0.5">
                      {c.children.map((l) => (isGroup(l) ? null : renderFlyoutLeaf(l)))}
                    </div>
                  </div>
                ) : (
                  renderFlyoutLeaf(c)
                )
              )}
            </div>
          </div>
        )
      })()}

      {/* ABA FIXA na borda do rail — abre o menu dedicado dos funis. Sempre visível
          no contexto de Negócios (desktop) com o painel recolhido; "›" pra expandir. */}
      {isDesktopRail && (dealPipelines?.length ?? 0) > 0 && pathname === "/negocios" && flyoutKey !== "deal-pipes" && (
        <button
          type="button"
          data-flyout-trigger="deal-pipes"
          onClick={() => openFlyout("deal-pipes")}
          title="Funis de venda"
          style={{ left: railRight, top: dealItemY ?? 96 }}
          className="fixed z-30 -translate-x-1/2 -translate-y-1/2 flex size-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:text-primary-600 hover:border-primary-200 transition-colors animate-in fade-in-0 zoom-in-75 duration-150"
        >
          <ChevronRight className="size-3.5" strokeWidth={2.5} />
        </button>
      )}

      <SidebarSelfPause
        initialPaused={selfPause.paused}
        initialPausedUntil={selfPause.paused_until}
        expanded={expanded}
      />

      <div className="px-2.5 pb-3 pt-2 border-t border-slate-200 shrink-0 overflow-hidden">
        <div className="flex items-center gap-1 py-1 overflow-hidden">
          <Link
            href="/configuracoes/perfil"
            onClick={() => onNavigate?.()}
            title="Meu perfil"
            className="group/profile flex items-center gap-2 min-w-0 flex-1 overflow-hidden rounded-lg hover:bg-slate-50 transition-colors"
          >
            <div className="flex size-9 items-center justify-center shrink-0">
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
            className={`shrink-0 size-7 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-30 ${expanded ? "flex" : "hidden"}`}
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
