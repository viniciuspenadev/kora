"use client"

import Link from "next/link"
import { useEffect, useRef, useState, useCallback } from "react"
import { signOut } from "next-auth/react"
import { Copy, Check, Settings, RefreshCw, LogOut, UserRound } from "lucide-react"
import { MyAvatar } from "@/components/app/my-avatar"
import { UserAvatar } from "@/components/ui/user-avatar"
import { ContactPic } from "@/components/chat/contact-pic"
import { getAccountMenuData, type AccountMenuData } from "@/lib/actions/account-menu"

const ROLE_LABELS: Record<string, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  agent: "Atendente",
}

const brl = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v)

/**
 * Menu da Conta — "Cockpit do vendedor". Hierarquia invertida: a PESSOA é a
 * protagonista no topo, "Meu mês" é um mini-dashboard, e a conta do tenant vira
 * rodapé compacto. Dados buscados LAZY no primeiro OPEN (getAccountMenuData) e
 * cacheados em state; o refresh do KPI re-chama.
 */
export function AccountMenu({
  userName, userRole, userId,
}: {
  userName: string; userRole: string; userId: string
}) {
  const [open, setOpen]             = useState(false)
  const [data, setData]             = useState<AccountMenuData | null>(null)
  const [loading, setLoading]       = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [copied, setCopied]         = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const isManager = ["owner", "admin"].includes(userRole)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await getAccountMenuData()
      setData(d)
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch lazy: só no primeiro open (data ainda null).
  useEffect(() => {
    if (open && data === null && !loading) void load()
  }, [open, data, loading, load])

  // Fecha em click-fora + Esc.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey) }
  }, [open])

  async function refreshKpi() {
    setRefreshing(true)
    try {
      const d = await getAccountMenuData()
      if (d) setData(d)
    } finally {
      setRefreshing(false)
    }
  }

  async function copySlug() {
    if (!data?.tenantSlug) return
    try {
      await navigator.clipboard.writeText(data.tenantSlug)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard indisponível — silencioso */ }
  }

  const tenantInitial = (data?.tenantName?.trim()?.[0] ?? "C").toUpperCase()

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Minha conta"
        className={`group/me flex items-center gap-2.5 rounded-lg px-1.5 py-1 -mr-1 transition-colors ${open ? "bg-nav-hover" : "hover:bg-nav-hover"}`}
      >
        <div className="text-right hidden sm:block">
          <p className="text-xs font-semibold text-nav-text leading-none group-hover/me:text-nav-strong">{userName}</p>
          <p className="text-[11px] text-nav-dim leading-none mt-0.5">{ROLE_LABELS[userRole] ?? userRole}</p>
        </div>
        <MyAvatar name={userName} className="size-8" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
        >
          {/* ── Bloco pessoal (protagonista) ───────────────────────── */}
          <div className="px-3 pt-3 pb-3">
            <div className="flex items-center gap-3">
              <UserAvatar userId={userId} name={userName} size={44} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-900 truncate">{data?.userName ?? userName}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[11px] text-slate-500">{ROLE_LABELS[userRole] ?? userRole}</span>
                  {data?.unit && (
                    <>
                      <span className="text-slate-300 text-[11px]">·</span>
                      <span
                        className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none"
                        style={{ backgroundColor: data.unit.color + "20", color: data.unit.color }}
                      >
                        {data.unit.name}
                      </span>
                    </>
                  )}
                </div>
                {data?.userEmail && <p className="text-[11px] text-slate-400 truncate mt-0.5">{data.userEmail}</p>}
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100" />

          {/* ── Meu mês (mini-dashboard) ───────────────────────────── */}
          <div className="px-3 pt-3 pb-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Meu mês</span>
              <button
                type="button"
                onClick={refreshKpi}
                disabled={refreshing || loading}
                title="Atualizar"
                className="shrink-0 size-6 grid place-items-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
              >
                <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </div>

            {/* Linha principal — logo da unidade + valor vendido + tendência */}
            <div className="mt-2 flex items-center gap-3">
              {data?.unit && (
                <UnitLogo unit={data.unit} />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-2xl font-bold tabular-nums text-slate-900 leading-none">
                    {data ? brl(data.soldThisMonth) : loading ? "…" : "R$ 0"}
                  </span>
                  {data && <TrendChip data={data} />}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">vendido no mês</p>
              </div>
            </div>

            {/* Linha secundária — ganhos + em aberto */}
            {data && (
              <p className="mt-3 text-xs text-slate-500">
                <span className="font-bold tabular-nums text-slate-800">{data.wonCountThisMonth}</span>
                {" "}{data.wonCountThisMonth === 1 ? "negócio ganho" : "negócios ganhos"}
                <span className="mx-1.5 text-slate-300">·</span>
                <span className="font-bold tabular-nums text-slate-800">{brl(data.openValue)}</span>
                {" "}em aberto no funil
              </p>
            )}
          </div>

          <div className="border-t border-slate-100" />

          {/* ── Itens de menu ──────────────────────────────────────── */}
          <div className="px-1.5 py-1.5">
            {isManager && (
              <MenuLink href="/configuracoes" icon={Settings} label="Configurações" onClick={() => setOpen(false)} />
            )}
            <MenuLink href="/configuracoes/perfil" icon={UserRound} label="Meu perfil" onClick={() => setOpen(false)} />
          </div>

          <div className="border-t border-slate-100" />

          {/* ── Rodapé da conta (compacto) ─────────────────────────── */}
          <div className="px-3 pt-2.5 pb-1.5">
            <div className="flex items-center gap-2">
              <div className="size-7 shrink-0 rounded-md bg-primary-50 text-primary-700 flex items-center justify-center text-xs font-bold">
                {tenantInitial}
              </div>
              <span className="text-xs font-semibold text-slate-700 truncate">
                {loading && !data ? "Carregando…" : data?.tenantName ?? "Conta"}
              </span>
              {data?.tenantSlug && (
                <>
                  <span className="font-mono text-[11px] text-slate-400 truncate">· {data.tenantSlug}</span>
                  <button
                    type="button"
                    onClick={copySlug}
                    title="Copiar identificador"
                    className="ml-auto shrink-0 size-6 grid place-items-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    {copied
                      ? <Check className="size-3.5 text-emerald-600" />
                      : <Copy className="size-3.5" />}
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="px-1.5 pb-1.5">
            <button
              type="button"
              onClick={() => { setOpen(false); void signOut({ redirectTo: "/auth/signin" }) }}
              className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut className="size-4 shrink-0" />
              Sair
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Logo da unidade à esquerda do valor. Fallback → quadradinho da cor da unidade com inicial. */
function UnitLogo({ unit }: { unit: NonNullable<AccountMenuData["unit"]> }) {
  const initial = (unit.name?.trim()?.[0] ?? "?").toUpperCase()
  const fallback = (
    <span
      className="size-full grid place-items-center text-sm font-bold"
      style={{ backgroundColor: unit.color + "20", color: unit.color }}
    >
      {initial}
    </span>
  )
  return (
    <span className="size-10 shrink-0 rounded-lg overflow-hidden bg-slate-50 ring-1 ring-slate-200 grid place-items-center">
      <ContactPic
        pic={unit.has_logo ? `/api/unit-logo/${unit.id}` : null}
        imgClass="size-full object-contain"
        fallback={fallback}
      />
    </span>
  )
}

/** Chip de tendência do valor vendido vs mês anterior. */
function TrendChip({ data }: { data: AccountMenuData }) {
  const { soldThisMonth: cur, soldLastMonth: prev, prevMonthLabel } = data

  // Ambos zero → sem chip.
  if (cur === 0 && prev === 0) return null

  // Mês passado 0 e este > 0 → "novo".
  if (prev === 0) {
    return (
      <span className="inline-flex items-center rounded-full bg-primary-50 text-primary-700 px-1.5 py-0.5 text-[10px] font-semibold leading-none">
        novo
      </span>
    )
  }

  const pct = Math.round(((cur - prev) / prev) * 100)
  const up = pct >= 0
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
        up ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
      }`}
    >
      {up ? "↑" : "↓"} {Math.abs(pct)}% vs {prevMonthLabel}
    </span>
  )
}

function MenuLink({
  href, icon: Icon, label, onClick,
}: {
  href: string; icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      role="menuitem"
      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
    >
      <Icon className="size-4 shrink-0 text-slate-400" />
      {label}
    </Link>
  )
}
