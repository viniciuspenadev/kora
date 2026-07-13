"use client"

import Link from "next/link"
import { useEffect, useRef, useState, useCallback } from "react"
import { signOut } from "next-auth/react"
import { Copy, Check, Settings, Gauge, RefreshCw, LogOut, UserRound } from "lucide-react"
import { MyAvatar } from "@/components/app/my-avatar"
import { UserAvatar } from "@/components/ui/user-avatar"
import { getAccountMenuData, type AccountMenuData } from "@/lib/actions/account-menu"

const ROLE_LABELS: Record<string, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  agent: "Atendente",
}

const brl = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v)

/**
 * Menu da Conta — dropdown ancorado à direita no topbar. Dois blocos (conta do
 * tenant + pessoal) separados por dividers. Dados buscados LAZY no primeiro OPEN
 * (getAccountMenuData) e cacheados em state; o refresh do KPI re-chama.
 */
export function AccountMenu({
  userName, userRole, userId,
}: {
  userName: string; userRole: string; userId: string
}) {
  const [open, setOpen]           = useState(false)
  const [data, setData]           = useState<AccountMenuData | null>(null)
  const [loading, setLoading]     = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [copied, setCopied]       = useState(false)
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
          {/* ── Bloco 1 — A CONTA (tenant) ─────────────────────────── */}
          <div className="px-3 pt-3 pb-2">
            <div className="flex items-center gap-2.5">
              <div className="size-9 shrink-0 rounded-lg bg-primary-50 text-primary-700 flex items-center justify-center text-sm font-bold">
                {tenantInitial}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 truncate">
                  {loading && !data ? "Carregando…" : data?.tenantName ?? "Conta"}
                </p>
                {data?.tenantSlug && (
                  <button
                    type="button"
                    onClick={copySlug}
                    title="Copiar identificador"
                    className="group/slug flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <span className="font-mono truncate">{data.tenantSlug}</span>
                    {copied
                      ? <Check className="size-3 text-emerald-600 shrink-0" />
                      : <Copy className="size-3 shrink-0 opacity-0 group-hover/slug:opacity-100 transition-opacity" />}
                    {copied && <span className="text-emerald-600">Copiado</span>}
                  </button>
                )}
              </div>
            </div>
          </div>

          {isManager && (
            <div className="px-1.5 pb-1.5">
              <MenuLink href="/configuracoes" icon={Settings} label="Configurações" onClick={() => setOpen(false)} />
              <MenuLink href="/configuracoes/uso" icon={Gauge} label="Uso e limites" onClick={() => setOpen(false)} />
            </div>
          )}

          <div className="border-t border-slate-100" />

          {/* ── Bloco 2 — PESSOAL ──────────────────────────────────── */}
          <div className="px-3 pt-3 pb-2">
            <div className="flex items-center gap-2.5">
              <UserAvatar userId={userId} name={userName} size={36} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 truncate">{data?.userName ?? userName}</p>
                {data?.userEmail && <p className="text-[11px] text-slate-400 truncate">{data.userEmail}</p>}
              </div>
            </div>

            {data?.unit && (
              <div className="mt-2">
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{ backgroundColor: data.unit.color + "20", color: data.unit.color }}
                >
                  {data.unit.name}
                </span>
              </div>
            )}

            {/* Mini-KPI — vendi neste mês */}
            <div className="mt-3 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-slate-400 leading-none">Eu vendi neste mês</p>
                <p className="text-lg font-bold text-slate-900 leading-tight mt-0.5">
                  {data ? brl(data.soldThisMonth) : loading ? "…" : "R$ 0"}
                </p>
              </div>
              <button
                type="button"
                onClick={refreshKpi}
                disabled={refreshing || loading}
                title="Atualizar"
                className="shrink-0 size-7 grid place-items-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
              >
                <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          <div className="px-1.5 pb-1.5">
            <MenuLink href="/configuracoes/perfil" icon={UserRound} label="Perfil" onClick={() => setOpen(false)} />
          </div>

          <div className="border-t border-slate-100" />

          {/* ── Rodapé — Sair ──────────────────────────────────────── */}
          <div className="px-1.5 py-1.5">
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
