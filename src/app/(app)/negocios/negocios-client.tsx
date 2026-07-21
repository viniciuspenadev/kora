"use client"

import { useState, useMemo, useEffect } from "react"
import { SimpleSelect } from "@/components/ui/select"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Search, X, LayoutGrid, List, SlidersHorizontal, BarChart3, Funnel } from "lucide-react"
import type { DealsPageData, DealRow, DealPipeline } from "@/lib/actions/deals"
import { DealsBoard } from "@/components/crm/deals-board"

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

export function NegociosClient({ data, pipelines }: { data: DealsPageData; pipelines: DealPipeline[] }) {
  const [view, setView]     = useState<"board" | "list">("board")
  const [search, setSearch] = useState("")
  const [pipe, setPipe]     = useState("")
  const [status, setStatus] = useState("")
  const [agent, setAgent]   = useState("")
  const [unit, setUnit]     = useState("")   // ""=todas · "none"=sem unidade · id
  const router = useRouter()
  // Deep-link do menu (switcher de funis): /negocios?pipeline=<id>
  const urlPipelineId = useSearchParams().get("pipeline")

  // Funil ATIVO do board — seletor mora no header (movido de dentro do kanban).
  const [pipeId, setPipeId] = useState(() => {
    if (urlPipelineId && pipelines.some((p) => p.id === urlPipelineId)) return urlPipelineId
    return (pipelines.find((p) => p.is_default) ?? pipelines[0])?.id ?? ""
  })
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (urlPipelineId && urlPipelineId !== pipeId && pipelines.some((p) => p.id === urlPipelineId)) setPipeId(urlPipelineId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlPipelineId])
  function selectPipe(id: string) {
    setPipeId(id)
    window.history.replaceState(null, "", `/negocios?pipeline=${id}`)
  }

  const deals = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.deals.filter((d) => {
      if (pipe && d.pipeline_id !== pipe) return false
      if (status && d.status !== status) return false
      if (agent && d.created_by !== agent) return false
      if (unit === "none" ? d.unit_id != null : unit && d.unit_id !== unit) return false
      if (q && !(d.name ?? "").toLowerCase().includes(q) && !(d.contact_name ?? "").toLowerCase().includes(q)) return false
      return true
    })
  }, [data.deals, search, pipe, status, agent, unit])

  return (
    <div className="h-[calc(100dvh-3.5rem)] bg-canvas flex flex-col overflow-hidden">
      {/* header + toolbar (fixo) */}
      <div className="shrink-0 bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center gap-2 flex-wrap">
        <div className="min-w-0 mr-1">
          <h1 className="text-base font-bold text-slate-900 leading-tight tracking-tight">Negócios</h1>
          <p className="text-[11px] text-slate-400 leading-tight">Pipeline de vendas</p>
        </div>

        <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-lg shrink-0">
          <ViewBtn active={view === "board"} onClick={() => setView("board")} icon={LayoutGrid} label="Quadro" />
          <ViewBtn active={view === "list"}  onClick={() => setView("list")}  icon={List}       label="Lista" />
        </div>

        {/* Seletor de FUNIL — só no Quadro e com 2+ funis (a Lista tem o próprio filtro). */}
        {view === "board" && pipelines.length > 1 && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Funnel className="size-3.5 text-slate-400 hidden sm:block" />
            <div className="w-48">
              <SimpleSelect value={pipeId} onChange={selectPipe}
                options={pipelines.map((p) => ({ value: p.id, label: p.name + (p.is_default ? " · padrão" : "") }))} />
            </div>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <Link href="/negocios/painel" className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors">
            <BarChart3 className="size-3.5" /> <span className="hidden sm:inline">Painel</span>
          </Link>
          <Link href="/negocios/funis" className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors">
            <SlidersHorizontal className="size-3.5" /> <span className="hidden sm:inline">Funis</span>
          </Link>
        </div>

        {/* filtros só na Lista — ocupam a linha inteira abaixo */}
        {view === "list" && (
          <div className="w-full flex items-center gap-2 flex-wrap pt-1">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="size-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar negócio ou cliente…"
                className="w-full h-9 pl-9 pr-9 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40" />
              {search && <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 size-5 grid place-items-center rounded text-slate-400 hover:bg-slate-100"><X className="size-3" /></button>}
            </div>
            {data.pipelines.length > 1 && (
              <SimpleSelect value={pipe} onChange={setPipe}
                options={[{ value: "", label: "Todas as trilhas" }, ...data.pipelines.map((p) => ({ value: p.id, label: p.name }))]} />
            )}
            <SimpleSelect value={status} onChange={setStatus} options={[
              { value: "",     label: "Todos os status" },
              { value: "open", label: "Aberto" },
              { value: "won",  label: "Ganho" },
              { value: "lost", label: "Perdido" },
            ]} />
            {data.agents.length > 0 && (
              <SimpleSelect value={agent} onChange={setAgent}
                options={[{ value: "", label: "Todos responsáveis" }, ...data.agents.map((a) => ({ value: a.id, label: a.name }))]} />
            )}
            <SimpleSelect value={unit} onChange={setUnit}
              options={[
                { value: "", label: "Todas as unidades" },
                ...data.units.map((u) => ({ value: u.id, label: u.name })),
                { value: "none", label: "Sem unidade" },
              ]} />
            <span className="text-[11px] text-slate-400 ml-auto tabular-nums shrink-0">{deals.length} de {data.deals.length}</span>
          </div>
        )}
      </div>

      {view === "board" ? (
        <DealsBoard pipelines={pipelines} deals={data.deals} allTags={data.allTags} pipeId={pipeId} />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4">
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
      )}
    </div>
  )
}

function ViewBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof List; label: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-md transition-colors ${active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
      <Icon className="size-3.5" /> {label}
    </button>
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
