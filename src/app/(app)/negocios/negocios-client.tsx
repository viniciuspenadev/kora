"use client"

import { useState } from "react"
import { SimpleSelect } from "@/components/ui/select"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Plus, SlidersHorizontal, Funnel } from "lucide-react"
import type { DealsPageData, DealPipeline } from "@/lib/actions/deals"
import { DealsBoard } from "@/components/crm/deals-board"
import { DealsList } from "@/components/crm/deals-list"
import { NovaPropostaWizard } from "@/components/crm/nova-proposta-wizard"
import { QUOTE_TERM } from "@/lib/commercial/quote-terms"

// Uma rota, duas páginas do menu Vendas (dono, 29/09/2026):
//   • "Negócios" (padrão, ?view=list) — a Lista: todos os negócios, de todos os funis.
//   • "Funil"    (?view=board)        — o Quadro de UM funil, com o seletor de funis.
// Quem troca de visão é o menu; a chave Quadro/Lista do topo saiu (dois caminhos confundiam).
export function NegociosClient({ data, pipelines }: { data: DealsPageData; pipelines: DealPipeline[] }) {
  const params = useSearchParams()
  const router = useRouter()
  const view = params.get("view") === "board" ? "board" : "list"
  const urlPipeline = params.get("pipeline")
  const pipeId = pipelines.find((p) => p.id === urlPipeline)?.id
    ?? (pipelines.find((p) => p.is_default) ?? pipelines[0])?.id ?? ""
  const pipe = pipelines.find((p) => p.id === pipeId)
  const [novoOpen, setNovoOpen] = useState(false)

  // Native history preserves filters on detail → back, without another server fetch.
  function selectPipe(id: string) {
    const query = new URLSearchParams(window.location.search)
    query.set("view", "board")
    query.set("pipeline", id)
    query.delete("stage")
    query.delete("page")
    window.history.replaceState(null, "", `/negocios?${query.toString()}`)
  }

  const action = "inline-flex items-center gap-1.5 h-9 px-2 sm:px-3 text-xs font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
  return (
    <div className="h-[calc(100dvh-3.5rem)] bg-canvas flex flex-col overflow-hidden">
      <div className="shrink-0 bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center gap-2 flex-wrap">
        <div className="min-w-0 mr-1">
          <h1 className="text-base font-bold text-slate-900 leading-tight tracking-tight">{view === "board" ? "Funil" : "Negócios"}</h1>
          <p className="hidden text-[11px] text-slate-400 leading-tight sm:block">
            {view === "board" ? (pipelines.length > 1 ? "Negócios por etapa do funil escolhido" : `Negócios por etapa · ${pipe?.name ?? "funil"}`) : "Todos os negócios, de todos os funis"}
          </p>
        </div>
        {view === "board" && pipelines.length > 1 && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Funnel className="size-3.5 text-slate-400 hidden sm:block" />
            <div className="w-48"><SimpleSelect value={pipeId} onChange={selectPipe} ariaLabel="Funil do quadro"
              options={pipelines.map((p) => ({ value: p.id, label: p.name + (p.is_default ? " · padrão" : "") }))} /></div>
          </div>
        )}
        <div className="ml-auto flex items-center gap-1 shrink-0 sm:gap-2">
          <button type="button" onClick={() => setNovoOpen(true)} className={`${action} bg-primary text-white hover:bg-primary-700`}>
            <Plus className="size-3.5" /><span className="hidden sm:inline">{QUOTE_TERM.new}</span>
          </button>
          {view === "board" && (
            <Link href="/negocios/funis" aria-label="Configurar funis" title="Configurar funis" className={`${action} text-slate-600 border border-slate-200 bg-white hover:bg-slate-50`}>
              <SlidersHorizontal className="size-3.5" /><span className="hidden sm:inline">Configurar funis</span>
            </Link>
          )}
        </div>
      </div>
      {view === "board"
        ? <DealsBoard pipelines={pipelines} deals={data.deals} allTags={data.allTags} pipeId={pipeId} />
        : <DealsList data={data} onShowBoard={() => router.push("/negocios?view=board")} />}
      {novoOpen && <NovaPropostaWizard onClose={() => setNovoOpen(false)} />}
    </div>
  )
}
