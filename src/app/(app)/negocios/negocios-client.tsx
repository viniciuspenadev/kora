"use client"

import { SimpleSelect } from "@/components/ui/select"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { LayoutGrid, List, SlidersHorizontal, BarChart3, Funnel } from "lucide-react"
import type { DealsPageData, DealPipeline } from "@/lib/actions/deals"
import { DealsBoard } from "@/components/crm/deals-board"
import { DealsList } from "@/components/crm/deals-list"

export function NegociosClient({ data, pipelines }: { data: DealsPageData; pipelines: DealPipeline[] }) {
  const params = useSearchParams()
  const view = params.get("view") === "list" ? "list" : "board"
  const urlPipeline = params.get("pipeline")
  const pipeId = pipelines.find((p) => p.id === urlPipeline)?.id
    ?? (pipelines.find((p) => p.is_default) ?? pipelines[0])?.id ?? ""

  // Native history preserves filters on detail → back, without another server fetch.
  function changeView(next: "board" | "list") {
    const query = new URLSearchParams(window.location.search)
    query.set("view", next)
    window.history.replaceState(null, "", `/negocios?${query.toString()}`)
  }
  function selectPipe(id: string) {
    const query = new URLSearchParams(window.location.search)
    query.set("pipeline", id)
    query.delete("stage")
    query.delete("page")
    window.history.replaceState(null, "", `/negocios?${query.toString()}`)
  }

  return (
    <div className="h-[calc(100dvh-3.5rem)] bg-canvas flex flex-col overflow-hidden">
      <div className="shrink-0 bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center gap-2 flex-wrap">
        <div className="min-w-0 mr-1">
          <h1 className="text-base font-bold text-slate-900 leading-tight tracking-tight">Negócios</h1>
          <p className="hidden text-[11px] text-slate-400 leading-tight sm:block">Pipeline de vendas</p>
        </div>
        <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-lg shrink-0" aria-label="Visualização de negócios">
          <ViewBtn active={view === "board"} onClick={() => changeView("board")} icon={LayoutGrid} label="Quadro" />
          <ViewBtn active={view === "list"} onClick={() => changeView("list")} icon={List} label="Lista" />
        </div>
        {view === "board" && pipelines.length > 1 && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Funnel className="size-3.5 text-slate-400 hidden sm:block" />
            <div className="w-48"><SimpleSelect value={pipeId} onChange={selectPipe} ariaLabel="Funil do quadro"
              options={pipelines.map((p) => ({ value: p.id, label: p.name + (p.is_default ? " · padrão" : "") }))} /></div>
          </div>
        )}
        <div className="ml-auto flex items-center gap-1 shrink-0 sm:gap-2">
          <Link href="/negocios/painel" aria-label="Painel de negócios" className="inline-flex items-center gap-1.5 h-9 px-2 sm:px-3 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <BarChart3 className="size-3.5" /><span className="hidden sm:inline">Painel</span>
          </Link>
          <Link href="/negocios/funis" aria-label="Configurar funis" className="inline-flex items-center gap-1.5 h-9 px-2 sm:px-3 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <SlidersHorizontal className="size-3.5" /><span className="hidden sm:inline">Funis</span>
          </Link>
        </div>
      </div>
      {view === "board"
        ? <DealsBoard pipelines={pipelines} deals={data.deals} allTags={data.allTags} pipeId={pipeId} />
        : <DealsList data={data} onShowBoard={() => changeView("board")} />}
    </div>
  )
}

function ViewBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof List; label: string }) {
  return <button type="button" onClick={onClick} aria-pressed={active}
    className={`inline-flex items-center gap-1.5 h-8 px-2 sm:px-3 text-xs font-semibold rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
    <Icon className="size-3.5" />{label}
  </button>
}
