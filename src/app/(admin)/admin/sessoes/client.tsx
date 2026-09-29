"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  MonitorSmartphone, Users, Wifi, RefreshCw, LogOut, X, AlertTriangle,
  Smartphone, Monitor, ShieldX,
} from "lucide-react"
import type { AdminSession } from "@/lib/actions/admin-sessions"
import { revokeSession, revokeAllForUser } from "@/lib/actions/admin-sessions"

interface Props {
  sessions: AdminSession[]
  active:   number
  total:    number
}

const ROLE_LABEL: Record<string, string> = { owner: "Dono", admin: "Admin", agent: "Atendente" }

export function SessionsClient({ sessions, active, total }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirm, setConfirm] = useState<{ kind: "one" | "all"; s: AdminSession } | null>(null)
  const [error, setError] = useState<string | null>(null)

  function doRevoke() {
    if (!confirm) return
    const target = confirm
    setError(null)
    startTransition(async () => {
      const res = target.kind === "all"
        ? await revokeAllForUser(target.s.userId)
        : await revokeSession(target.s.id)
      if (res.error) { setError(res.error); return }
      setConfirm(null)
      router.refresh()
    })
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="px-6 py-6">
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Sessões ativas</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Quem está logado, em qual dispositivo e de onde. Revogue qualquer sessão suspeita —
              o device cai em até ~5 min, sem afetar os outros aparelhos da pessoa.
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="h-9 px-3 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 inline-flex items-center gap-1.5"
          >
            <RefreshCw className="size-3.5" /> Atualizar
          </button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <StatCard label="Ativos agora" value={active} sub="últimos 10 min" icon={Wifi} tone="green" />
          <StatCard label="Sessões totais" value={total} sub="todos os devices" icon={MonitorSmartphone} tone="slate" />
          <StatCard label="Usuários" value={new Set(sessions.map((s) => s.userId)).size} sub="com sessão ativa" icon={Users} tone="primary" />
        </div>

        {/* Tabela */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {sessions.length === 0 ? (
            <div className="py-16 text-center">
              <MonitorSmartphone className="size-10 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-600 mb-1">Nenhuma sessão registrada ainda</p>
              <p className="text-xs text-slate-400">
                Sessões aparecem aqui conforme os usuários logam (após o deploy do gerenciador).
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5">Usuário</th>
                  <th className="px-4 py-2.5">Tenant</th>
                  <th className="px-4 py-2.5">Dispositivo</th>
                  <th className="px-4 py-2.5">IP</th>
                  <th className="px-4 py-2.5">Visto por último</th>
                  <th className="px-4 py-2.5 text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`size-2 rounded-full shrink-0 ${s.active ? "bg-green-500" : "bg-slate-300"}`} title={s.active ? "Ativo" : "Inativo"} />
                        <div className="min-w-0">
                          <p className="text-slate-900 font-medium truncate max-w-[200px]">{s.name}</p>
                          <p className="text-[11px] text-slate-400 truncate max-w-[200px]">{s.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {s.tenantName ?? <span className="text-slate-400">platform</span>}
                      {s.role && <span className="ml-1.5 text-[10px] text-slate-400">· {ROLE_LABEL[s.role] ?? s.role}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      <span className="inline-flex items-center gap-1.5">
                        <DeviceIcon ua={s.userAgent} />
                        {/* Identidade real do dispositivo (device trust) quando existe;
                            sessão legada (pré-F1) cai no palpite por user-agent. */}
                        {s.deviceLabel ?? deviceLabel(s.userAgent)}
                        {s.deviceId && (
                          <span className="text-[9px] font-semibold text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded" title="Dispositivo identificado por cookie de dispositivo">
                            ID
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500 tabular-nums">{s.lastIp ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500 tabular-nums whitespace-nowrap">{timeAgo(s.lastSeenAt)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => { setError(null); setConfirm({ kind: "one", s }) }}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded-md transition-colors"
                      >
                        <LogOut className="size-3" /> Revogar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Confirmação de revogação */}
      {confirm && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => !pending && setConfirm(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-5">
              <div className="flex items-start gap-3">
                <span className="size-9 shrink-0 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
                  {confirm.kind === "all" ? <ShieldX className="size-5" /> : <AlertTriangle className="size-5" />}
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-slate-900">
                    {confirm.kind === "all" ? "Revogar TODAS as sessões?" : "Revogar esta sessão?"}
                  </h2>
                  <p className="text-xs text-slate-500 mt-1 leading-snug">
                    {confirm.kind === "all"
                      ? <>Todos os dispositivos de <strong>{confirm.s.name}</strong> serão desconectados em até ~5 min. A pessoa terá que logar de novo.</>
                      : <>O dispositivo <strong>{confirm.s.deviceLabel ?? deviceLabel(confirm.s.userAgent)}</strong> de <strong>{confirm.s.name}</strong> cai em até ~5 min. Outros aparelhos dela seguem ativos.</>}
                  </p>
                </div>
                <button onClick={() => !pending && setConfirm(null)} className="size-7 shrink-0 rounded-lg hover:bg-slate-100 flex items-center justify-center">
                  <X className="size-4 text-slate-400" />
                </button>
              </div>

              {error && <p className="mt-3 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg p-2">{error}</p>}

              <div className="flex items-center justify-between gap-2 mt-5">
                {confirm.kind === "one" ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setConfirm({ kind: "all", s: confirm.s })}
                    className="text-[11px] font-semibold text-slate-500 hover:text-red-600 disabled:opacity-50"
                  >
                    Revogar todos os devices
                  </button>
                ) : <span />}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setConfirm(null)}
                    className="h-9 px-4 text-xs font-semibold rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={doRevoke}
                    className="h-9 px-4 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    {pending ? <RefreshCw className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />}
                    Revogar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({
  label, value, sub, icon: Icon, tone,
}: {
  label: string
  value: string | number
  sub?: string
  icon: React.ComponentType<{ className?: string }>
  tone: "slate" | "green" | "primary"
}) {
  const TONES = {
    slate:   "bg-slate-50 text-slate-600",
    green:   "bg-green-50 text-green-700",
    primary: "bg-primary-50 text-primary-700",
  }
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3">
      <div className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${TONES[tone]}`}>
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">{label}</p>
        <p className="text-2xl font-bold text-slate-900 tabular-nums leading-tight">{value}</p>
        {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
      </div>
    </div>
  )
}

function DeviceIcon({ ua }: { ua: string | null }) {
  const mobile = ua ? /iphone|ipad|ipod|android|mobile/i.test(ua) : false
  const Icon = mobile ? Smartphone : Monitor
  return <Icon className="size-3.5 text-slate-400 shrink-0" />
}

function deviceLabel(ua: string | null): string {
  if (!ua) return "—"
  const os =
    /iphone|ipad|ipod/i.test(ua) ? "iOS" :
    /android/i.test(ua)          ? "Android" :
    /windows/i.test(ua)          ? "Windows" :
    /mac os|macintosh/i.test(ua) ? "macOS" :
    /linux/i.test(ua)            ? "Linux" : "?"
  const br =
    /edg/i.test(ua)              ? "Edge" :
    /chrome|crios/i.test(ua)     ? "Chrome" :
    /firefox|fxios/i.test(ua)    ? "Firefox" :
    /safari/i.test(ua)           ? "Safari" : "?"
  return `${br} · ${os}`
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return "agora"
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  return `há ${d}d`
}
