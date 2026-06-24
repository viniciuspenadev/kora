"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Search, X } from "lucide-react"
import type { DealsPageData, DealRow } from "@/lib/actions/deals"

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })

function aging(d: DealRow): number | null {
  if (d.status !== "open" || !d.stage_entered_at) return null
  const days = Math.floor((Date.now() - new Date(d.stage_entered_at).getTime()) / 86_400_000)
  return days >= 3 ? days : null
}

function dueChip(iso: string): { label: string; overdue: boolean } {
  const d = new Date(iso), now = new Date()
  const diff = d.getTime() - now.getTime()
  if (diff < 0) { const days = Math.ceil(-diff / 86_400_000); return { label: days <= 1 ? "atrasada" : `${days}d atrás`, overdue: true } }
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  if (d.toDateString() === now.toDateString()) return { label: `hoje ${time}`, overdue: false }
  if (new Date(now.getTime() + 86_400_000).toDateString() === d.toDateString()) return { label: "amanhã", overdue: false }
  return { label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }), overdue: false }
}

const selCls = "h-9 px-3 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"

export function NegociosClient({ data }: { data: DealsPageData }) {
  const [search, setSearch] = useState("")
  const [pipe, setPipe]     = useState("")
  const [status, setStatus] = useState("")
  const [agent, setAgent]   = useState("")
  const router = useRouter()

  const deals = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.deals.filter((d) => {
      if (pipe && d.pipeline_id !== pipe) return false
      if (status && d.status !== status) return false
      if (agent && d.created_by !== agent) return false
      if (q && !(d.name ?? "").toLowerCase().includes(q) && !(d.contact_name ?? "").toLowerCase().includes(q)) return false
      return true
    })
  }, [data.deals, search, pipe, status, agent])

  const k = data.kpis
  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Em aberto"         value={brl(k.openValue)} sub={`${k.openCount} negócio${k.openCount !== 1 ? "s" : ""}`} accent />
        <Kpi label="Ganho no período"  value={brl(k.wonValue)}  sub={`${k.wonCount} ganho${k.wonCount !== 1 ? "s" : ""}`} />
        <Kpi label="Conversão"         value={`${k.conversionPct}%`} sub="ganhos / fechados" />
        <Kpi label="Ticket médio"      value={brl(k.avgTicket)} sub="por negócio ganho" />
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="size-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar negócio ou cliente…"
            className="w-full h-9 pl-9 pr-9 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
          {search && <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 size-5 grid place-items-center rounded text-slate-400 hover:bg-slate-100"><X className="size-3" /></button>}
        </div>
        {data.pipelines.length > 1 && (
          <select value={pipe} onChange={(e) => setPipe(e.target.value)} className={selCls}>
            <option value="">Todas as trilhas</option>
            {data.pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selCls}>
          <option value="">Todos os status</option>
          <option value="open">Aberto</option>
          <option value="won">Ganho</option>
          <option value="lost">Perdido</option>
        </select>
        {data.agents.length > 0 && (
          <select value={agent} onChange={(e) => setAgent(e.target.value)} className={selCls}>
            <option value="">Todos responsáveis</option>
            {data.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <span className="text-[11px] text-slate-400 ml-auto tabular-nums shrink-0">{deals.length} de {data.deals.length}</span>
      </div>

      {/* Tabela */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] text-slate-500 bg-slate-50/60">
                <th className="text-left font-medium py-2.5 px-3">Negócio</th>
                <th className="text-left font-medium py-2.5 px-3">Cliente</th>
                <th className="text-left font-medium py-2.5 px-3 hidden md:table-cell">Trilha</th>
                <th className="text-left font-medium py-2.5 px-3">Etapa / status</th>
                <th className="text-left font-medium py-2.5 px-3 hidden md:table-cell">Próxima ação</th>
                <th className="text-right font-medium py-2.5 px-3">Valor</th>
                <th className="text-left font-medium py-2.5 px-3 hidden lg:table-cell">Responsável</th>
                <th className="text-left font-medium py-2.5 px-3 hidden sm:table-cell">Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {deals.length === 0 ? (
                <tr><td colSpan={8} className="text-center text-xs text-slate-400 py-12">Nenhum negócio encontrado.</td></tr>
              ) : deals.map((d) => <DealTableRow key={d.id} d={d} onOpen={() => router.push(`/negocios/${d.id}`)} />)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${accent ? "border-primary-200 bg-primary-50/30" : "border-slate-200 bg-white"}`}>
      <p className="text-[11px] font-medium text-slate-400">{label}</p>
      <p className={`text-xl font-bold tabular-nums mt-0.5 ${accent ? "text-primary-700" : "text-slate-900"}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function DealTableRow({ d, onOpen }: { d: DealRow; onOpen: () => void }) {
  const ag    = aging(d)
  const color = d.stage?.color ?? "#64748b"
  const value = d.estimated_value && d.estimated_value > 0 ? brl(Number(d.estimated_value)) : "—"
  return (
    <tr onClick={onOpen} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors cursor-pointer">
      <td className="py-2.5 px-3"><span className="font-medium text-slate-900">{d.name?.trim() || "Negócio sem nome"}</span></td>
      <td className="py-2.5 px-3 text-slate-600"><span className="block truncate max-w-[160px]">{d.contact_name ?? "—"}</span></td>
      <td className="py-2.5 px-3 text-slate-500 text-xs hidden md:table-cell">{d.pipeline_name ?? "—"}</td>
      <td className="py-2.5 px-3">
        {d.status === "won" ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">🏆 Ganho</span>
        ) : d.status === "lost" ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">✕ Perdido</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
            <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />{d.stage?.name ?? "—"}
          </span>
        )}
        {ag && <span className="ml-1.5 text-[10px] font-medium text-amber-700">{ag}d parado</span>}
      </td>
      <td className="py-2.5 px-3 hidden md:table-cell">
        {d.next_task ? (
          <span className="inline-flex items-center gap-1.5 max-w-[180px]">
            <span className="size-1.5 rounded-full bg-primary shrink-0" />
            <span className="text-xs text-slate-600 truncate">{d.next_task.title}</span>
            {d.next_task.due_at && (() => { const c = dueChip(d.next_task.due_at); return <span className={`text-[10px] shrink-0 ${c.overdue ? "text-red-600 font-semibold" : "text-slate-400"}`}>{c.label}</span> })()}
          </span>
        ) : d.status === "open" ? (
          <span className="text-[11px] text-amber-600">sem próxima ação</span>
        ) : <span className="text-slate-300">—</span>}
      </td>
      <td className="py-2.5 px-3 text-right font-semibold text-slate-800 tabular-nums">{value}</td>
      <td className="py-2.5 px-3 text-slate-500 text-xs hidden lg:table-cell"><span className="block truncate max-w-[120px]">{d.responsible ?? "—"}</span></td>
      <td className="py-2.5 px-3 text-slate-400 text-xs hidden sm:table-cell">{new Date(d.updated_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}</td>
    </tr>
  )
}
