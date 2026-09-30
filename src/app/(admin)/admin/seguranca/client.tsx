"use client"

import { useRouter } from "next/navigation"
import {
  ShieldAlert, KeyRound, Smartphone, MonitorSmartphone, RefreshCw,
  Ban, ScrollText, Monitor, AlertTriangle,
} from "lucide-react"
import type { SecurityOverview } from "@/lib/actions/admin-security"

// Limiar de alerta: ≥ este nº de falhas de um mesmo IP = provável brute-force.
const BRUTE_ALERT = 10

export function SecurityClient({ data }: { data: SecurityOverview }) {
  const router = useRouter()
  const { kpis, bruteForce, newDevices, audit } = data

  return (
    <div className="min-h-screen bg-canvas">
      <div className="px-6 py-6">
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <ShieldAlert className="size-6 text-primary-600" /> Segurança
            </h1>
            <p className="text-sm text-slate-500 mt-0.5 max-w-2xl">
              Sinais de ataque na camada de aplicação — brute-force, logins de dispositivo novo e
              ações sensíveis. Ataque direto ao banco/rede aparece nos logs do Supabase, não aqui.
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

        {/* KPIs (24h) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="Falhas de login" value={kpis.loginFailures24h} sub="últimas 24h" icon={Ban} tone={kpis.loginFailures24h >= BRUTE_ALERT ? "red" : "slate"} />
          <StatCard label="Dispositivos novos" value={kpis.newDevices24h} sub="últimas 24h" icon={Smartphone} tone={kpis.newDevices24h > 0 ? "amber" : "slate"} />
          <StatCard label="Ações sensíveis" value={kpis.sensitiveActions24h} sub="últimas 24h" icon={ScrollText} tone={kpis.sensitiveActions24h > 0 ? "amber" : "slate"} />
          <StatCard label="Sessões ativas" value={kpis.activeSessions} sub="últimos 10 min" icon={MonitorSmartphone} tone="green" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Brute-force */}
          <Panel title="Brute-force por IP" icon={Ban} note="Falhas de login agrupadas por origem (7 dias). Muitas de um IP = ataque.">
            {bruteForce.length === 0 ? (
              <Empty icon={KeyRound} title="Nenhuma falha de login" sub="Sem tentativas suspeitas nos últimos 7 dias." />
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-y border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr className="text-left">
                    <th className="px-4 py-2">IP</th>
                    <th className="px-4 py-2 text-right">Falhas</th>
                    <th className="px-4 py-2 text-right">E-mails</th>
                    <th className="px-4 py-2 text-right">Última</th>
                  </tr>
                </thead>
                <tbody>
                  {bruteForce.map((b) => {
                    const alert = b.attempts >= BRUTE_ALERT
                    return (
                      <tr key={b.ip} className={`border-b border-slate-100 ${alert ? "bg-red-50/50" : "hover:bg-slate-50"}`}>
                        <td className="px-4 py-2 tabular-nums text-slate-700 flex items-center gap-1.5">
                          {alert && <AlertTriangle className="size-3.5 text-red-500 shrink-0" />}
                          {b.ip}
                        </td>
                        <td className={`px-4 py-2 text-right tabular-nums font-semibold ${alert ? "text-red-600" : "text-slate-700"}`}>{b.attempts}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-500">{b.emails}</td>
                        <td className="px-4 py-2 text-right text-xs text-slate-400 tabular-nums whitespace-nowrap">{timeAgo(b.lastAt)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </Panel>

          {/* Dispositivos novos */}
          <Panel title="Logins de dispositivo novo" icon={Smartphone} note="Cada um exigiu código por e-mail (device-trust). Um você não reconhece = investigar.">
            {newDevices.length === 0 ? (
              <Empty icon={Smartphone} title="Nenhum login de device novo" sub="Nos últimos 7 dias." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {newDevices.map((d, i) => (
                  <li key={i} className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50">
                    <DeviceIcon ua={d.userAgent} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-800 font-medium truncate">{d.name} <span className="text-[11px] text-slate-400 font-normal">{d.email}</span></p>
                      <p className="text-[11px] text-slate-400 tabular-nums">{d.ip ?? "IP —"} · {deviceLabel(d.userAgent)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[11px] text-slate-400 tabular-nums whitespace-nowrap">{timeAgo(d.at)}</p>
                      {!d.consumed && <span className="text-[9px] font-semibold text-amber-700 bg-amber-50 px-1 py-0.5 rounded">não concluído</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* Trilha sensível */}
        <div className="mt-6">
          <Panel title="Ações sensíveis (trilha de auditoria)" icon={ScrollText} note="Mudança de role, LGPD (export/delete), módulo, revogação — quem fez o quê, de onde.">
            {audit.length === 0 ? (
              <Empty icon={ScrollText} title="Nenhuma ação sensível registrada" sub="A trilha aparece conforme operações sensíveis acontecem." />
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-y border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr className="text-left">
                    <th className="px-4 py-2">Ação</th>
                    <th className="px-4 py-2">Ator</th>
                    <th className="px-4 py-2">Tenant</th>
                    <th className="px-4 py-2">IP</th>
                    <th className="px-4 py-2 text-right">Quando</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a, i) => (
                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2"><code className="text-[11px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">{a.action}</code></td>
                      <td className="px-4 py-2 text-xs text-slate-600 truncate max-w-[180px]">{a.actor}</td>
                      <td className="px-4 py-2 text-xs text-slate-500">{a.tenant ?? <span className="text-slate-300">platform</span>}</td>
                      <td className="px-4 py-2 text-xs text-slate-400 tabular-nums">{a.ip ?? "—"}</td>
                      <td className="px-4 py-2 text-right text-xs text-slate-400 tabular-nums whitespace-nowrap">{timeAgo(a.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        <p className="text-[11px] text-slate-400 mt-5 flex items-center gap-1.5">
          <AlertTriangle className="size-3" />
          Em incidente, siga <code className="bg-slate-100 px-1 rounded">docs/incident-response.md</code>. Ataque ao banco/rede: Supabase → Logs.
        </p>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, icon: Icon, tone }: {
  label: string; value: number; sub?: string
  icon: React.ComponentType<{ className?: string }>
  tone: "slate" | "green" | "amber" | "red"
}) {
  const TONES = {
    slate: "bg-slate-50 text-slate-600", green: "bg-green-50 text-green-700",
    amber: "bg-amber-50 text-amber-700", red: "bg-red-50 text-red-700",
  }
  return (
    <div className={`bg-white border rounded-xl p-4 flex items-start gap-3 ${tone === "red" ? "border-red-200" : "border-slate-200"}`}>
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

function Panel({ title, icon: Icon, note, children }: {
  title: string; icon: React.ComponentType<{ className?: string }>; note: string; children: React.ReactNode
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Icon className="size-4 text-slate-400" /> {title}</h2>
        <p className="text-[11px] text-slate-400 mt-0.5">{note}</p>
      </div>
      {children}
    </div>
  )
}

function Empty({ icon: Icon, title, sub }: { icon: React.ComponentType<{ className?: string }>; title: string; sub: string }) {
  return (
    <div className="py-12 text-center">
      <Icon className="size-8 text-slate-300 mx-auto mb-2" />
      <p className="text-sm font-medium text-slate-600">{title}</p>
      <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
    </div>
  )
}

function DeviceIcon({ ua }: { ua: string | null }) {
  const mobile = ua ? /iphone|ipad|ipod|android|mobile/i.test(ua) : false
  const Icon = mobile ? Smartphone : Monitor
  return <Icon className="size-4 text-slate-400 shrink-0" />
}

function deviceLabel(ua: string | null): string {
  if (!ua) return "dispositivo —"
  const os = /iphone|ipad|ipod/i.test(ua) ? "iOS" : /android/i.test(ua) ? "Android" : /windows/i.test(ua) ? "Windows" : /mac os|macintosh/i.test(ua) ? "macOS" : /linux/i.test(ua) ? "Linux" : "?"
  const br = /edg/i.test(ua) ? "Edge" : /chrome|crios/i.test(ua) ? "Chrome" : /firefox|fxios/i.test(ua) ? "Firefox" : /safari/i.test(ua) ? "Safari" : "?"
  return `${br} · ${os}`
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return "agora"
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  return `há ${Math.floor(h / 24)}d`
}
